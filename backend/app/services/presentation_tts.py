"""Slide narration audio: Gemini TTS with retries, then Edge neural fallback."""

from __future__ import annotations

import asyncio
import re
import subprocess
import wave
from pathlib import Path

from app.core.config import settings

_GEMINI_TTS_MODELS = (
    "gemini-2.5-flash-preview-tts",
    "gemini-2.5-pro-preview-tts",
    "gemini-2.5-flash-tts",
)


def _pcm_to_wav(pcm: bytes, dest: Path, sample_rate: int = 24000) -> float:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(dest), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    duration_ms = (len(pcm) / 2) / sample_rate * 1000
    return max(duration_ms, 400.0)


_DURATION_RE = re.compile(r"Duration: (\d+):(\d+):(\d+(?:\.\d+)?)")


def _estimate_duration_ms(text: str) -> float:
    words = max(len(text.split()), 1)
    return max(words / 2.15 * 1000, 1200.0)


def probe_audio_duration_ms(path: str) -> float:
    """Read the real audio length so video clips never cut off narration."""
    audio = Path(path)
    if not audio.exists():
        return 0.0
    if audio.suffix.lower() == ".wav":
        try:
            with wave.open(str(audio), "rb") as wf:
                frames = wf.getnframes()
                rate = wf.getframerate() or 1
                return max(frames / rate * 1000.0, 400.0)
        except Exception:
            pass
    try:
        import imageio_ffmpeg

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        result = subprocess.run([ffmpeg, "-i", str(audio)], capture_output=True, text=True)
        match = _DURATION_RE.search(result.stderr or "")
        if not match:
            return 0.0
        hours, minutes, seconds = match.groups()
        return max((int(hours) * 3600 + int(minutes) * 60 + float(seconds)) * 1000.0, 400.0)
    except Exception:
        return 0.0


def _extract_pcm(response) -> bytes | None:
    try:
        data = response.candidates[0].content.parts[0].inline_data.data
    except Exception:
        return None
    return bytes(data) if data else None


def _gemini_tts(text: str, wav_path: Path) -> float | None:
    keys: list[str] = []
    for key in (settings.gemini_api_key, *settings.gemini_keys_for_notes_pool()):
        cleaned = (key or "").strip()
        if cleaned and cleaned not in keys:
            keys.append(cleaned)
    if not keys:
        return None

    from google import genai
    from google.genai import types

    models: list[str] = []
    primary = (settings.gemini_tts_model or "").strip()
    if primary:
        models.append(primary)
    else:
        models.append(_GEMINI_TTS_MODELS[0])

    last_error: Exception | None = None
    for key in keys:
        client = genai.Client(api_key=key)
        for model in models:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=text,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=types.SpeechConfig(
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                    voice_name="Kore"
                                )
                            )
                        ),
                    ),
                )
                pcm = _extract_pcm(response)
                if not pcm:
                    raise RuntimeError("TTS returned empty audio")
                print(f"[presentations] Gemini TTS ok via {model}")
                return _pcm_to_wav(pcm, wav_path)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                print(f"[presentations] Gemini TTS {model} failed: {exc}")
                break
    if last_error:
        print(f"[presentations] Gemini TTS unavailable, using Edge fallback: {last_error}")
    return None


async def _edge_tts_async(text: str, dest: Path) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice="en-US-JennyNeural")
    await communicate.save(str(dest))


def _run_async(coro):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result: dict = {}
    error: dict = {}

    def runner():
        try:
            result["ok"] = asyncio.run(coro)
        except Exception as exc:  # noqa: BLE001
            error["err"] = exc

    thread = __import__("threading").Thread(target=runner)
    thread.start()
    thread.join()
    if "err" in error:
        raise error["err"]
    return result.get("ok")


def synthesize_slide(script: str, dest_path: str, *, prefer_edge: bool = False) -> tuple[float, str]:
    """Return (duration_ms, audio_file_path)."""
    text = (script or "").strip()
    if not text:
        raise ValueError("Slide script is empty")
    if len(text) > 4500:
        text = text[:4500].rsplit(" ", 1)[0]

    dest = Path(dest_path)
    wav_path = dest.with_suffix(".wav")
    if not prefer_edge:
        gemini_ms = _gemini_tts(text, wav_path)
        if gemini_ms is not None and wav_path.exists():
            return gemini_ms, str(wav_path)

    mp3_path = dest.with_suffix(".mp3")
    mp3_path.parent.mkdir(parents=True, exist_ok=True)
    _run_async(_edge_tts_async(text, mp3_path))
    if not mp3_path.exists() or mp3_path.stat().st_size < 100:
        raise RuntimeError("Could not generate slide audio (Gemini TTS failed and Edge fallback produced no file)")
    print("[presentations] Edge TTS ok")
    duration = probe_audio_duration_ms(str(mp3_path)) or _estimate_duration_ms(text)
    return duration, str(mp3_path)
