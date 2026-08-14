"""Assemble an MP4: original slides, then glass highlight when narration starts."""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.services.presentation_parse import slide_looks_like_diagram
from app.services.presentation_tts import probe_audio_duration_ms

TAIL_PAD_SEC = 0.45
INTRO_HOLD_SEC = 1.05


def clip_duration_ms(duration_ms: float) -> float:
    """Length of one encoded slide clip, including the short tail pad."""
    audio_ms = max(float(duration_ms or 0), 1200.0)
    return audio_ms + TAIL_PAD_SEC * 1000.0


def flatten_caption_cues(slides: list[dict]) -> list[dict]:
    """Cue times on the concatenated video timeline (not burned into frames)."""
    out: list[dict] = []
    offset = 0.0
    for slide in slides:
        clip_ms = clip_duration_ms(float(slide.get("duration_ms") or 0))
        for cue in slide.get("cues") or []:
            if not isinstance(cue, dict):
                continue
            text = str(cue.get("text") or "").strip()
            if not text:
                continue
            start = offset + float(cue.get("start_ms") or 0)
            end = min(offset + float(cue.get("end_ms") or 0), offset + clip_ms)
            if end <= start:
                continue
            out.append({"start_ms": start, "end_ms": end, "text": text})
        offset += clip_ms
    return out


CANVAS_W = 1920
CANVAS_H = 1080
FPS = 25


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


def _fit_slide(src):
    from PIL import Image

    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), (8, 12, 22))
    src_w, src_h = src.size
    if src_w < 8 or src_h < 8:
        return canvas, 0, 0, 1.0
    scale = min(CANVAS_W / src_w, CANVAS_H / src_h)
    new_w = max(1, int(src_w * scale))
    new_h = max(1, int(src_h * scale))
    fitted = src.resize((new_w, new_h), Image.Resampling.LANCZOS)
    off_x = (CANVAS_W - new_w) // 2
    off_y = (CANVAS_H - new_h) // 2
    canvas.paste(fitted, (off_x, off_y))
    return canvas, off_x, off_y, scale


def _shape_pixels(
    shape: dict, off_x: int, off_y: int, scale: float, src_size: tuple[int, int]
) -> tuple[int, int, int, int] | None:
    src_w, src_h = src_size
    try:
        x = float(shape.get("x") or 0)
        y = float(shape.get("y") or 0)
        box_w = float(shape.get("w") or 0)
        box_h = float(shape.get("h") or 0)
    except (TypeError, ValueError):
        return None
    if box_w <= 0.02 or box_h <= 0.02:
        return None
    left = max(0, int(off_x + x * src_w * scale) - 8)
    top = max(0, int(off_y + y * src_h * scale) - 6)
    right = min(CANVAS_W, int(off_x + (x + box_w) * src_w * scale) + 8)
    bottom = min(CANVAS_H, int(off_y + (y + box_h) * src_h * scale) + 6)
    if right - left < 28 or bottom - top < 22:
        return None
    return left, top, right, bottom


def _tight_content_box(
    canvas, box: tuple[int, int, int, int], pad: int = 16
) -> tuple[int, int, int, int]:
    """Shrink a PPT text-frame box to the actual ink, ignoring empty placeholder space."""
    import numpy as np

    left, top, right, bottom = box
    crop = canvas.crop((left, top, right, bottom))
    arr = np.asarray(crop.convert("RGB")).astype(np.int16)
    height, width = arr.shape[:2]
    if height < 8 or width < 8:
        return box

    corner = 8
    samples = np.concatenate(
        [
            arr[:corner, :corner].reshape(-1, 3),
            arr[:corner, -corner:].reshape(-1, 3),
            arr[-corner:, :corner].reshape(-1, 3),
            arr[-corner:, -corner:].reshape(-1, 3),
        ]
    )
    background = np.median(samples, axis=0)
    delta = np.max(np.abs(arr - background), axis=2)
    ink = delta > 18
    if int(ink.sum()) < 40:
        return box

    rows = np.where(np.any(ink, axis=1))[0]
    cols = np.where(np.any(ink, axis=0))[0]
    y0, y1 = int(rows[0]), int(rows[-1])
    x0, x1 = int(cols[0]), int(cols[-1])
    content_h = y1 - y0 + 1
    content_w = x1 - x0 + 1
    if content_h < 16 or content_w < 16:
        return box

    tight = (
        max(0, left + x0 - pad),
        max(0, top + y0 - pad),
        min(CANVAS_W, left + x1 + 1 + pad),
        min(CANVAS_H, top + y1 + 1 + pad),
    )
    # Keep the original box if content already fills it (second screenshot case).
    orig_area = max((right - left) * (bottom - top), 1)
    tight_area = max((tight[2] - tight[0]) * (tight[3] - tight[1]), 1)
    if tight_area / orig_area > 0.82:
        return box
    return tight


def _rounded_mask(size: tuple[int, int], radius: int):
    from PIL import Image, ImageDraw

    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255
    )
    return mask


def _subtitle_font(size: int):
    from PIL import ImageFont

    for path in (
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibri.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _wrap_subtitle(text: str, draw, font, max_width: int) -> list[str]:
    words = (text or "").split()
    if not words:
        return []
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        width = draw.textlength(trial, font=font)
        if width <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
        if len(lines) == 2:
            break
    if current and len(lines) < 2:
        lines.append(current)
    elif current and len(lines) == 2:
        lines[1] = (lines[1][: max(1, len(lines[1]) - 1)] + "…") if len(lines[1]) > 8 else lines[1]
    return lines[:2]


def _draw_subtitle(canvas, text: str):
    from PIL import Image, ImageDraw

    overlay = canvas.convert("RGBA")
    draw = ImageDraw.Draw(overlay)
    font = _subtitle_font(36)
    max_width = CANVAS_W - 160
    lines = _wrap_subtitle(text, draw, font, max_width)
    if not lines:
        return canvas

    line_h = 44
    pad_x, pad_y = 28, 16
    text_w = max(int(draw.textlength(line, font=font)) for line in lines)
    box_w = min(CANVAS_W - 80, text_w + pad_x * 2)
    box_h = pad_y * 2 + line_h * len(lines)
    box_x = (CANVAS_W - box_w) // 2
    box_y = CANVAS_H - box_h - 42

    bar = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
    ImageDraw.Draw(bar).rounded_rectangle(
        (0, 0, box_w - 1, box_h - 1), radius=14, fill=(12, 16, 28, 175)
    )
    overlay.alpha_composite(bar, (box_x, box_y))

    draw = ImageDraw.Draw(overlay)
    y = box_y + pad_y
    for line in lines:
        w = int(draw.textlength(line, font=font))
        x = box_x + (box_w - w) // 2
        draw.text((x + 1, y + 1), line, font=font, fill=(0, 0, 0, 180))
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 245))
        y += line_h
    return overlay.convert("RGB")


def render_slide_frame(
    image_path: str, shape: dict | None, dest_path: str, subtitle: str = ""
) -> str:
    """Clean slide, or a glass-morphism card on the spoken region only."""
    dest = Path(dest_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        from PIL import Image, ImageDraw, ImageFilter
    except Exception:
        from shutil import copyfile

        copyfile(image_path, dest)
        return str(dest)

    src = Image.open(image_path).convert("RGB")
    canvas, off_x, off_y, scale = _fit_slide(src)
    pixels = _shape_pixels(shape, off_x, off_y, scale, src.size) if shape else None
    area = 0.0
    if shape:
        try:
            area = float(shape.get("w") or 0) * float(shape.get("h") or 0)
        except (TypeError, ValueError):
            area = 0.0

    if pixels:
        try:
            pixels = _tight_content_box(canvas, pixels)
        except Exception:
            pass
        area = ((pixels[2] - pixels[0]) * (pixels[3] - pixels[1])) / (CANVAS_W * CANVAS_H)

    if pixels and area <= 0.72:
        left, top, right, bottom = pixels
        pad = 14
        outer = (
            max(0, left - pad),
            max(0, top - pad),
            min(CANVAS_W, right + pad),
            min(CANVAS_H, bottom + pad),
        )
        ol, ot, oright, ob = outer
        width, height = oright - ol, ob - ot
        radius = max(12, min(22, min(width, height) // 8))

        from PIL import ImageEnhance

        dimmed = ImageEnhance.Brightness(canvas.filter(ImageFilter.GaussianBlur(radius=6))).enhance(0.9)
        layered = dimmed.convert("RGBA")

        backdrop = canvas.crop(outer).filter(ImageFilter.GaussianBlur(radius=10))
        white = Image.new("RGB", (width, height), (248, 250, 255))
        frosted = Image.blend(backdrop, white, 0.22)
        glass = frosted.convert("RGBA")
        glass.putalpha(_rounded_mask((width, height), radius))

        shadow = Image.new("RGBA", (width + 40, height + 40), (0, 0, 0, 0))
        shadow_blob = Image.new("RGBA", (width, height), (15, 22, 40, 90))
        shadow_blob.putalpha(
            _rounded_mask((width, height), radius).point(lambda p: int(p * 0.45))
        )
        shadow.paste(shadow_blob, (20, 22), shadow_blob)
        shadow = shadow.filter(ImageFilter.GaussianBlur(radius=12))

        layered.alpha_composite(shadow, (ol - 20, ot - 18))
        layered.alpha_composite(glass, (ol, ot))

        inner = canvas.crop((left, top, right, bottom)).convert("RGBA")
        inner_mask = _rounded_mask(inner.size, max(8, radius - 6))
        inner.putalpha(inner_mask)
        layered.alpha_composite(inner, (left, top))

        stroke = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(stroke)
        draw.rounded_rectangle(
            (1, 1, width - 2, height - 2),
            radius=radius,
            outline=(255, 255, 255, 110),
            width=2,
        )
        layered.alpha_composite(stroke, (ol, ot))
        canvas = layered.convert("RGB")

    if (subtitle or "").strip():
        canvas = _draw_subtitle(canvas, subtitle.strip())

    canvas.save(dest, format="PNG")
    return str(dest)


def _cue_segments(cues: list[dict], audio_sec: float) -> list[tuple[float, object]]:
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
    used = sum(d for d, _ in segments[:-1])
    segments[-1] = (max(total - used, 0.35), segments[-1][1])
    return [(d, idx) for d, idx in segments if d > 0.05]


def _diagram_segments(shapes: list[dict], audio_sec: float) -> list[tuple[float, object]]:
    visuals = [
        shape
        for shape in (shapes or [])
        if str(shape.get("kind") or "") in {"picture", "chart", "group"}
        and float(shape.get("w") or 0) * float(shape.get("h") or 0) >= 0.06
    ]
    visuals = sorted(visuals, key=lambda s: (float(s.get("y") or 0), float(s.get("x") or 0)))
    pruned: list[dict] = []
    for shape in visuals:
        contained = False
        for other in pruned:
            if (
                float(shape.get("x") or 0) >= float(other.get("x") or 0)
                and float(shape.get("y") or 0) >= float(other.get("y") or 0)
                and float(shape.get("x") or 0) + float(shape.get("w") or 0)
                <= float(other.get("x") or 0) + float(other.get("w") or 0) + 0.02
                and float(shape.get("y") or 0) + float(shape.get("h") or 0)
                <= float(other.get("y") or 0) + float(other.get("h") or 0) + 0.02
            ):
                contained = True
                break
        if not contained:
            pruned.append(shape)
    visuals = pruned[:6]
    if not visuals:
        return [(max(audio_sec, 1.0), None)]
    if len(visuals) == 1:
        return [(max(audio_sec, 1.0), visuals[0].get("index"))]
    each = max(audio_sec / len(visuals), 1.2)
    segs = [(each, v.get("index")) for v in visuals]
    used = each * (len(visuals) - 1)
    segs[-1] = (max(audio_sec - used, 1.2), visuals[-1].get("index"))
    return segs


def _ensure_clean_intro(
    segments: list[tuple[float, object]], audio_sec: float
) -> list[tuple[float, object]]:
    """Show the untouched slide first; glass starts after narration is underway."""
    total = max(audio_sec, 1.0)
    intro = min(INTRO_HOLD_SEC, max(0.7, total * 0.12))
    if total <= intro + 0.6:
        return [(total, None)]
    segs = list(segments or [(total, None)])
    if segs[0][1] is None:
        if segs[0][0] >= intro:
            return _fit_total(segs, total)
        extra = intro - segs[0][0]
        segs[0] = (intro, None)
        if len(segs) > 1:
            duration, idx = segs[1]
            segs[1] = (max(duration - extra, 0.3), idx)
        return _fit_total(segs, total)
    duration, idx = segs[0]
    segs[0] = (max(duration - intro, 0.3), idx)
    return _fit_total([(intro, None), *segs], total)


def _fit_total(
    segments: list[tuple[float, object]], total: float
) -> list[tuple[float, object]]:
    if not segments:
        return [(total, None)]
    used = sum(d for d, _ in segments)
    last_d, last_idx = segments[-1]
    segments[-1] = (max(last_d + (total - used), 0.3), last_idx)
    return [(d, idx) for d, idx in segments if d > 0.05]


def _subtitle_at(cues: list[dict], t_sec: float) -> str:
    ms = t_sec * 1000.0
    for cue in cues or []:
        start = float(cue.get("start_ms") or 0)
        end = float(cue.get("end_ms") or 0)
        if start <= ms < max(end, start + 1):
            return str(cue.get("text") or "").strip()
    return ""


def _merge_visual_and_subtitles(
    segments: list[tuple[float, object]],
    cues: list[dict],
    total: float,
) -> list[tuple[float, object, str]]:
    total = max(total, 1.0)
    visual: list[tuple[float, float, object]] = []
    cursor = 0.0
    for duration, idx in segments:
        visual.append((cursor, cursor + duration, idx))
        cursor += duration

    cuts = {0.0, total}
    for start, end, _idx in visual:
        cuts.add(round(start, 3))
        cuts.add(round(end, 3))
    for cue in cues or []:
        cuts.add(round(float(cue.get("start_ms") or 0) / 1000.0, 3))
        cuts.add(round(float(cue.get("end_ms") or 0) / 1000.0, 3))
    times = sorted(t for t in cuts if 0 <= t <= total + 0.001)

    out: list[tuple[float, object, str]] = []
    for start, end in zip(times, times[1:]):
        duration = end - start
        if duration < 0.05:
            continue
        mid = (start + end) / 2
        shape_idx: object = None
        for vis_start, vis_end, idx in visual:
            if vis_start - 0.001 <= mid < vis_end:
                shape_idx = idx
                break
        out.append((duration, shape_idx, _subtitle_at(cues, mid)))
    if not out:
        return [(total, None, _subtitle_at(cues, 0))]
    used = sum(d for d, _i, _t in out)
    last_d, last_idx, last_text = out[-1]
    out[-1] = (max(last_d + (total - used), 0.3), last_idx, last_text)
    return [(d, idx, text) for d, idx, text in out if d > 0.05]


def _write_concat_list(paths: list[Path], dest: Path) -> None:
    dest.write_text(
        "".join(f"file '{p.resolve().as_posix()}'\n" for p in paths),
        encoding="utf-8",
    )


def _encode_image_timeline(
    ffmpeg: str,
    frames: list[tuple[str, float]],
    audio: str,
    seconds: float,
    dest: Path,
    work: Path,
) -> None:
    concat_path = work / "frames.txt"
    lines: list[str] = []
    last: str | None = None
    for path, duration in frames:
        last = Path(path).resolve().as_posix()
        lines.append(f"file '{last}'")
        lines.append(f"duration {duration:.3f}")
    if last:
        lines.append(f"file '{last}'")
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
        "-pix_fmt",
        "yuv420p",
        "-r",
        str(FPS),
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "44100",
        "-t",
        f"{seconds:.3f}",
        str(dest),
    ]
    _run(cmd, f"Slide encode failed ({dest.name})")


def _encode_slide_clip(
    ffmpeg: str,
    image: str,
    audio: str,
    seconds: float,
    shapes: list[dict],
    cues: list[dict],
    work: Path,
    dest: Path,
) -> None:
    usable = seconds - TAIL_PAD_SEC if seconds > 1 else seconds
    if slide_looks_like_diagram(shapes):
        segments = _diagram_segments(shapes, usable)
    else:
        segments = _cue_segments(cues, usable)
    segments = _ensure_clean_intro(segments, usable)
    timed = [(duration, idx, "") for duration, idx in segments]

    frames: list[tuple[str, float]] = []
    cache: dict[object, str] = {}
    for i, (duration, shape_index, subtitle) in enumerate(timed):
        key = (shape_index if shape_index is not None else "__clean__", subtitle or "")
        if key not in cache:
            frame = work / f"frame-{i:03d}.png"
            cache[key] = render_slide_frame(
                image,
                _shape_for_index(shapes, shape_index),
                str(frame),
                subtitle,
            )
        frames.append((cache[key], duration))
    _encode_image_timeline(ffmpeg, frames, audio, seconds, dest, work)


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
        seconds = clip_duration_ms(probed_ms or stored_ms) / 1000.0
        clip = work / f"clip-{i:04d}.mp4"
        slide_work = work / f"slide-{i:04d}"
        slide_work.mkdir(parents=True, exist_ok=True)
        _encode_slide_clip(
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
