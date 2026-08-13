"""Turn extracted slide bullets into spoken teaching narration."""

from __future__ import annotations

import json
import re

from app.core.config import settings

_BATCH = 8


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


def _generate_batch(slides: list[dict], title: str) -> dict[int, str]:
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        return {}

    from google import genai

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
    prompt = (
        "You write spoken lecture narration for a classroom video.\n"
        f"Presentation title: {title or 'Lecture'}\n\n"
        "For each slide, write 4 to 8 spoken sentences that EXPLAIN the content. "
        "Do not just read the bullets. Add brief context, why it matters, and a simple example when useful. "
        "Naturally mention the on-screen phrases in the same order they appear, so the video can highlight them. "
        "Do not say 'this slide shows' or 'welcome back'. No markdown.\n\n"
        "Return JSON: {\"slides\": [{\"index\": 0, \"script\": \"...\"}]}\n\n"
        f"Slides:\n{json.dumps(payload, ensure_ascii=False)}"
    )
    client = genai.Client(api_key=api_key)
    models = [
        (settings.gemini_chat_model or "").strip(),
        (settings.gemini_model or "").strip(),
        "gemini-3.6-flash",
        "gemini-2.0-flash",
    ]
    seen: set[str] = set()
    last_error: Exception | None = None
    for model in models:
        if not model or model in seen:
            continue
        seen.add(model)
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
            print(f"[presentations] script generation via {model} failed: {exc}")
    if last_error:
        print(f"[presentations] script generation unavailable: {last_error}")
    return {}


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
