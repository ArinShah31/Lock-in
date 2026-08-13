"""Assemble an MP4: original slides + spotlight highlights + full narration."""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.services.presentation_tts import probe_audio_duration_ms

TAIL_PAD_SEC = 0.45


def _ffmpeg() -> str:
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError("ffmpeg is not available (install imageio-ffmpeg)") from exc


def _run(cmd: list[str], label: str) -> None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        err = (result.stderr or result.stdout or f"{label} failed")[-900:]
        raise RuntimeError(f"{label}: {err}")


def _shape_for_index(shapes: list[dict], shape_index) -> dict | None:
    if shape_index is None:
        return None
    try:
        wanted = int(shape_index)
    except (TypeError, ValueError):
        return None
    for shape in shapes or []:
        try:
            if int(shape.get("index", -1)) == wanted:
                return shape
        except (TypeError, ValueError):
            continue
    if 0 <= wanted < len(shapes or []):
        return shapes[wanted]
    return None


def render_spotlight_frame(image_path: str, shape: dict | None, dest_path: str) -> str:
    """Keep one region sharp and highlighted; blur and dim the rest of the slide."""
    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
    except Exception:
        from shutil import copyfile

        copyfile(image_path, dest)
        return str(dest)

    src = Image.open(image_path).convert("RGB")
    width, height = src.size
    if not shape or width < 8 or height < 8:
        src.save(dest, format="PNG")
        return str(dest)

    try:
        x = float(shape.get("x") or 0)
        y = float(shape.get("y") or 0)
        box_w = float(shape.get("w") or 0)
        box_h = float(shape.get("h") or 0)
    except (TypeError, ValueError):
        src.save(dest, format="PNG")
        return str(dest)

    if box_w <= 0.02 or box_h <= 0.02 or box_w * box_h > 0.72:
        src.save(dest, format="PNG")
        return str(dest)

    left = max(0, int(x * width) - 18)
    top = max(0, int(y * height) - 14)
    right = min(width, int((x + box_w) * width) + 18)
    bottom = min(height, int((y + box_h) * height) + 14)
    if right - left < 24 or bottom - top < 20:
        src.save(dest, format="PNG")
        return str(dest)

    blurred = src.filter(ImageFilter.GaussianBlur(radius=22))
    dimmed = ImageEnhance.Brightness(blurred).enhance(0.42)
    dimmed.paste(src.crop((left, top, right, bottom)), (left, top))
    draw = ImageDraw.Draw(dimmed)
    draw.rectangle((left, top, right - 1, bottom - 1), outline=(245, 200, 76), width=8)
    dimmed.save(dest, format="PNG")
    return str(dest)


def _cue_segments(cues: list[dict], audio_sec: float) -> list[tuple[float, object]]:
    """Return (duration_sec, shape_index) covering the full audio."""
    total = max(audio_sec, 1.0)
    if not cues:
        return [(total, None)]
    segments: list[tuple[float, object]] = []
    cursor = 0.0
    ordered = sorted(cues, key=lambda c: float(c.get("start_ms") or 0))
    for cue in ordered:
        start = max(0.0, float(cue.get("start_ms") or 0) / 1000.0)
        end = max(start, float(cue.get("end_ms") or 0) / 1000.0)
        if start > cursor + 0.05:
            segments.append((start - cursor, None))
        segments.append((max(end - max(start, cursor), 0.35), cue.get("shape_index")))
        cursor = max(cursor, end)
    if cursor < total:
        segments.append((total - cursor, segments[-1][1] if segments else None))
    if not segments:
        return [(total, None)]
    # Stretch or trim the last segment so the visual lasts as long as the voice.
    used = sum(d for d, _ in segments[:-1])
    last_shape = segments[-1][1]
    segments[-1] = (max(total - used, 0.35), last_shape)
    return [(d, idx) for d, idx in segments if d > 0.05]


def _write_concat_list(paths: list[Path], dest: Path) -> None:
    dest.write_text(
        "".join(f"file '{p.resolve().as_posix()}'\n" for p in paths),
        encoding="utf-8",
    )


def _encode_still_clip(
    ffmpeg: str,
    image: str,
    audio: str,
    seconds: float,
    dest: Path,
) -> None:
    cmd = [
        ffmpeg,
        "-y",
        "-loop",
        "1",
        "-framerate",
        "25",
        "-t",
        f"{seconds:.3f}",
        "-i",
        image,
        "-i",
        audio,
        "-af",
        f"apad=pad_dur={TAIL_PAD_SEC}",
        "-c:v",
        "libx264",
        "-tune",
        "stillimage",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-t",
        f"{seconds:.3f}",
        str(dest),
    ]
    _run(cmd, f"Video encode failed ({dest.name})")


def _encode_spotlight_clip(
    ffmpeg: str,
    image: str,
    audio: str,
    seconds: float,
    shapes: list[dict],
    cues: list[dict],
    work: Path,
    dest: Path,
) -> None:
    segments = _cue_segments(cues, seconds - TAIL_PAD_SEC if seconds > 1 else seconds)
    if len(segments) <= 1:
        shape = _shape_for_index(shapes, segments[0][1] if segments else None)
        frame = work / "spotlight.png"
        render_spotlight_frame(image, shape, str(frame))
        _encode_still_clip(ffmpeg, str(frame), audio, seconds, dest)
        return

    frames_dir = work / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    concat_path = work / "frames.txt"
    lines: list[str] = []
    last_frame: Path | None = None
    cache: dict[object, Path] = {}
    for i, (duration, shape_index) in enumerate(segments):
        key = shape_index if shape_index is not None else "__full__"
        if key not in cache:
            frame = frames_dir / f"frame-{i:03d}.png"
            render_spotlight_frame(image, _shape_for_index(shapes, shape_index), str(frame))
            cache[key] = frame
        last_frame = cache[key]
        lines.append(f"file '{last_frame.resolve().as_posix()}'")
        lines.append(f"duration {duration:.3f}")
    if last_frame is not None:
        lines.append(f"file '{last_frame.resolve().as_posix()}'")
    concat_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    cmd = [
        ffmpeg,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_path),
        "-i",
        audio,
        "-af",
        f"apad=pad_dur={TAIL_PAD_SEC}",
        "-c:v",
        "libx264",
        "-tune",
        "stillimage",
        "-r",
        "25",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-pix_fmt",
        "yuv420p",
        "-vf",
        "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
        "-t",
        f"{seconds:.3f}",
        str(dest),
    ]
    _run(cmd, f"Spotlight encode failed ({dest.name})")


def build_narrated_video(
    slides: list[dict],
    dest_path: str,
) -> str:
    """slides: image_path, audio_path, duration_ms, shapes, cues."""
    if not slides:
        raise RuntimeError("No slides to encode")
    ffmpeg = _ffmpeg()
    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    work = dest.parent / "_clips"
    work.mkdir(parents=True, exist_ok=True)

    clip_files: list[Path] = []
    for i, slide in enumerate(slides):
        img = Path(slide.get("image_path") or "")
        aud = Path(slide.get("audio_path") or "")
        if not img.exists():
            raise RuntimeError(f"Missing slide image for slide {i + 1}")
        if not aud.exists():
            raise RuntimeError(f"Missing narration audio for slide {i + 1}")
        probed_ms = probe_audio_duration_ms(str(aud))
        stored_ms = float(slide.get("duration_ms") or 0)
        audio_sec = max((probed_ms or stored_ms) / 1000.0, 1.2)
        seconds = audio_sec + TAIL_PAD_SEC
        clip = work / f"clip-{i:04d}.mp4"
        slide_work = work / f"slide-{i:04d}"
        slide_work.mkdir(parents=True, exist_ok=True)
        _encode_spotlight_clip(
            ffmpeg,
            str(img),
            str(aud),
            seconds,
            list(slide.get("shapes") or []),
            list(slide.get("cues") or []),
            slide_work,
            clip,
        )
        if not clip.exists():
            raise RuntimeError(f"Video encode failed on slide {i + 1}")
        clip_files.append(clip)

    concat_list = work / "concat.txt"
    _write_concat_list(clip_files, concat_list)
    concat_cmd = [
        ffmpeg,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list),
        "-c",
        "copy",
        str(dest),
    ]
    try:
        _run(concat_cmd, "Could not join slide clips into a video")
    except RuntimeError:
        reencode = [
            ffmpeg,
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list),
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            str(dest),
        ]
        _run(reencode, "Could not join slide clips into a video")
    if not dest.exists():
        raise RuntimeError("Could not join slide clips into a video")
    print(f"[presentations] wrote narrated video {dest}")
    return str(dest)
