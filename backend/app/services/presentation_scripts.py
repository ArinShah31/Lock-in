"""Turn extracted slide bullets into spoken teaching narration."""

from __future__ import annotations

import json
import re
from pathlib import Path

from openai import OpenAI

from app.core.config import settings
from app.services.presentation_parse import slide_looks_like_diagram

_BATCH = 8
GROQ_BASE_URL = "https://api.groq.com/openai/v1"
_QUOTA_MARKERS = (
    "429",
    "resource_exhausted",
    "quota",
    "rate_limit",
    "rate limit",
    "insufficient_quota",
)


def _is_quota_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(marker in text for marker in _QUOTA_MARKERS)


def gemini_failover_keys() -> list[str]:
    keys: list[str] = []
    for key in (settings.gemini_api_key, *settings.gemini_keys_for_notes_pool()):
        cleaned = (key or "").strip()
        if cleaned and cleaned not in keys:
            keys.append(cleaned)
    return keys


def groq_failover_keys() -> list[str]:
    return settings.groq_keys_for_stage("CHAPTER_CONTENT")


def _chat_models() -> list[str]:
    models: list[str] = []
    for name in (
        (settings.gemini_chat_model or "").strip(),
        (settings.gemini_model or "").strip(),
        "gemini-3.6-flash",
        "gemini-2.0-flash",
    ):
        if name and name not in models:
            models.append(name)
    return models


def needs_script_expansion(script: str, extracted_text: str) -> bool:
    spoken = (script or "").strip()
    source = (extracted_text or "").strip()
    if not spoken:
        return True
    if not source:
        return False
    compact_spoken = re.sub(r"\s+", " ", spoken).lower()
    compact_source = re.sub(r"\s+", " ", source).lower()
    if compact_spoken == compact_source:
        return True
    extra = len(compact_spoken) - len(compact_source)
    if extra < 48 and compact_source in compact_spoken:
        return True
    return False


def _local_expand(extracted: str, index: int, shapes: list[dict] | None = None) -> str:
    if slide_looks_like_diagram(shapes, extracted):
        extra = (extracted or "").strip()
        body = f" {extra}" if extra else ""
        return (
            f"This slide has a diagram. Start at the first box and follow the arrows "
            f"through each step as they appear on screen.{body} "
            "Keep that flow in mind as we continue."
        )
    bullets = [ln.strip(" \t-•*") for ln in (extracted or "").splitlines() if ln.strip()]
    if not bullets and shapes:
        bullets = [str(s.get("text") or "").strip() for s in shapes if str(s.get("text") or "").strip()]
    if not bullets:
        return f"This is slide {index + 1}. Let's continue with the next idea."
    lines = [
        f"Let's look at slide {index + 1} more closely.",
        "I'll walk through the important points so they are easier to remember.",
    ]
    for bullet in bullets[:10]:
        lines.append(f"{bullet}.")
    lines.append("Hold on to these points as we move forward.")
    return " ".join(lines)


def _parse_scripts(raw: str) -> dict[int, str]:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    data = json.loads(text)
    items = data.get("slides") if isinstance(data, dict) else data
    out: dict[int, str] = {}
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        script = str(item.get("script") or "").strip()
        if script:
            out[index] = script[:8000]
    return out


def _batch_payload(slides: list[dict]) -> list[dict]:
    payload = []
    for slide in slides:
        payload.append(
            {
                "index": int(slide["index"]),
                "extracted_text": slide.get("extracted_text") or "",
                "shapes": [
                    str(shape.get("text") or "").strip()
                    for shape in (slide.get("shapes") or [])
                    if str(shape.get("text") or "").strip()
                ],
            }
        )
    return payload


def _script_prompt(title: str, payload: list[dict]) -> str:
    return (
        "You write spoken lecture narration for a classroom video.\n"
        f"Presentation title: {title or 'Lecture'}\n\n"
        "For each slide, write 4 to 8 spoken sentences that EXPLAIN the content. "
        "Do not just read the bullets. Add brief context, why it matters, and a simple example when useful. "
        "Naturally mention the on-screen phrases in the same order they appear, so the video can highlight them. "
        "Do not say 'this slide shows' or 'welcome back'. No markdown.\n\n"
        "Return JSON: {\"slides\": [{\"index\": 0, \"script\": \"...\"}]}\n\n"
        f"Slides:\n{json.dumps(payload, ensure_ascii=False)}"
    )


def _generate_batch_gemini(slides: list[dict], title: str) -> dict[int, str]:
    from google import genai

    prompt = _script_prompt(title, _batch_payload(slides))
    last_error: Exception | None = None
    for key in gemini_failover_keys():
        client = genai.Client(api_key=key)
        for model in _chat_models():
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config={"response_mime_type": "application/json"},
                )
                raw = (getattr(response, "text", None) or "").strip()
                parsed = _parse_scripts(raw)
                if parsed:
                    print(f"[presentations] generated {len(parsed)} narration script(s) via {model}")
                    return parsed
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                print(f"[presentations] Gemini script {model} failed: {exc}")
                if _is_quota_error(exc):
                    break
    if last_error:
        print(f"[presentations] Gemini script generation unavailable: {last_error}")
    return {}


def _generate_batch_groq(slides: list[dict], title: str) -> dict[int, str]:
    prompt = _script_prompt(title, _batch_payload(slides))
    last_error: Exception | None = None
    for key in groq_failover_keys():
        try:
            client = OpenAI(api_key=key, base_url=GROQ_BASE_URL, timeout=90.0)
            response = client.chat.completions.create(
                model=settings.groq_model or "llama-3.1-8b-instant",
                temperature=0.4,
                messages=[
                    {
                        "role": "system",
                        "content": "Return only valid JSON for classroom narration scripts.",
                    },
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or ""
            parsed = _parse_scripts(raw)
            if parsed:
                print(f"[presentations] generated {len(parsed)} narration script(s) via Groq")
                return parsed
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            print(f"[presentations] Groq script generation failed: {exc}")
            if not _is_quota_error(exc):
                continue
    if last_error:
        print(f"[presentations] Groq script fallback unavailable: {last_error}")
    return {}


def _generate_batch(slides: list[dict], title: str) -> dict[int, str]:
    generated = _generate_batch_gemini(slides, title)
    if generated:
        return generated
    return _generate_batch_groq(slides, title)


def _generate_diagram_script(slide: dict, image_path: str, title: str) -> str | None:
    png = Path(image_path)
    if not png.exists():
        return None
    try:
        data = png.read_bytes()
    except Exception:
        return None
    if len(data) < 80:
        return None

    from google import genai
    from google.genai import types

    prompt = (
        "You write spoken lecture narration for a classroom video. "
        f"Presentation title: {title or 'Lecture'}. "
        "This slide contains a diagram, flowchart, or visual. "
        "Walk through it in a natural teaching order (start, each step, result). "
        "4 to 8 sentences. Do not say 'this slide shows'. No markdown."
    )
    last_error: Exception | None = None
    for key in gemini_failover_keys():
        client = genai.Client(api_key=key)
        for model in _chat_models()[:2]:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=[
                        types.Part.from_bytes(data=data, mime_type="image/png"),
                        prompt,
                    ],
                )
                text = (getattr(response, "text", None) or "").strip()
                if text:
                    print(f"[presentations] diagram narration via {model} for slide {slide.get('index')}")
                    return text[:8000]
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                print(f"[presentations] diagram vision {model} failed: {exc}")
                if _is_quota_error(exc):
                    break
    if last_error:
        print(f"[presentations] diagram vision skipped: {last_error}")
    return None


def expand_slide_scripts(slides: list[dict], title: str = "") -> list[str]:
    """Return a spoken script for each slide, aligned to input order."""
    scripts = [""] * len(slides)
    pending: list[dict] = []
    pending_pos: list[int] = []
    for i, slide in enumerate(slides):
        extracted = slide.get("extracted_text") or ""
        existing = slide.get("script") or ""
        if not needs_script_expansion(existing, extracted):
            scripts[i] = existing.strip()
            continue
        image_path = str(slide.get("image_path") or "")
        if image_path and slide_looks_like_diagram(slide.get("shapes") or [], extracted):
            vision = _generate_diagram_script({**slide, "index": i}, image_path, title)
            if vision:
                scripts[i] = vision
                continue
        pending.append({**slide, "index": i})
        pending_pos.append(i)

    for start in range(0, len(pending), _BATCH):
        batch = pending[start : start + _BATCH]
        generated = _generate_batch(batch, title)
        for offset, slide in enumerate(batch):
            pos = pending_pos[start + offset]
            local_index = int(slide["index"])
            scripts[pos] = (
                generated.get(local_index)
                or generated.get(offset)
                or _local_expand(
                    slide.get("extracted_text") or "",
                    pos,
                    slide.get("shapes") or [],
                )
            )

    for i, slide in enumerate(slides):
        if not scripts[i]:
            scripts[i] = _local_expand(
                slide.get("extracted_text") or "",
                i,
                slide.get("shapes") or [],
            )
    return scripts
