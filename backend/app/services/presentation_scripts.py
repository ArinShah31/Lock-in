"""Turn extracted slide bullets into spoken teaching narration."""

from __future__ import annotations

import json
import re
from pathlib import Path

from openai import OpenAI

from app.core.config import settings
from app.services.presentation_parse import (
    content_text,
    is_content_visual,
    shape_role,
    slide_looks_like_diagram,
)

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


_BAD_SCRIPT_MARKERS = (
    "this slide has a diagram",
    "start at the first box and follow the arrows",
    "hold on to these points as we move forward",
    "let's look at slide",
    "this is slide ",
    "keep that flow in mind as we continue",
    "as they appear on screen",
    "i'll walk through the important points",
    "let's move on to the next slide",
)


def is_low_quality_script(script: str) -> bool:
    spoken = (script or "").strip().lower()
    if not spoken:
        return True
    if re.fullmatch(r"slide\s+\d+\.?", spoken):
        return True
    return any(marker in spoken for marker in _BAD_SCRIPT_MARKERS)


def needs_script_expansion(script: str, extracted_text: str) -> bool:
    spoken = (script or "").strip()
    source = content_text(extracted_text or "") or (extracted_text or "").strip()
    if is_low_quality_script(spoken):
        return True
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
    if len(source) > 400 and len(spoken) < 220:
        return True
    branding = re.compile(
        r"(university|institute|academic year|ay\s*20\d{2}|school of computing|\bprof\.|\bprofessor\b)",
        re.I,
    )
    if branding.search(spoken) and not branding.search(source):
        return True
    return False


def _local_expand(extracted: str, index: int, shapes: list[dict] | None = None) -> str:
    body = content_text(extracted)
    bullets = [ln.strip(" \t-•*") for ln in body.splitlines() if ln.strip()]
    if not bullets and shapes:
        for shape in shapes:
            if shape_role(shape) != "content":
                continue
            cleaned = content_text(str(shape.get("text") or ""))
            if cleaned:
                bullets.extend(ln.strip(" \t-•*") for ln in cleaned.splitlines() if ln.strip())
    compact = " ".join(bullets).strip()
    if len(compact) < 12:
        return "We'll move into the next part of this lecture."
    if slide_looks_like_diagram(shapes, body) and len(compact) < 80:
        extra = f" {compact.rstrip('.')}." if compact else ""
        return (
            f"Look at the figure on this slide and follow it from the starting point "
            f"through each labeled part.{extra} We'll use this visual as we continue."
        )
    parts = [f"{bullets[0].rstrip('.')}."]
    for bullet in bullets[1:7]:
        parts.append(f"{bullet.rstrip('.')}.")
    if len(bullets) > 1:
        parts.append("These ideas connect, so keep them in mind as we go further.")
    return " ".join(parts)


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
        shapes = slide.get("shapes") or []
        extracted = content_text(slide.get("extracted_text") or "") or (
            slide.get("extracted_text") or ""
        )
        points = []
        for shape in shapes:
            if shape_role(shape) != "content":
                continue
            text = content_text(str(shape.get("text") or ""))
            if text:
                points.append(text[:500])
        payload.append(
            {
                "index": int(slide["index"]),
                "extracted_text": extracted,
                "points": points[:12],
                "is_diagram": slide_looks_like_diagram(shapes, extracted),
                "is_sparse": len(extracted) < 28,
                "visuals": [
                    str(shape.get("kind") or "")
                    for shape in shapes
                    if is_content_visual(shape)
                ][:6],
            }
        )
    return payload


def _script_prompt(title: str, payload: list[dict]) -> str:
    return (
        "You write spoken lecture narration for a classroom video.\n"
        f"Presentation title: {title or 'Lecture'}\n\n"
        "Rules:\n"
        "- Teach like a clear professor. Use the slide points as the outline, not a script to recite.\n"
        "- Content-heavy slides: 5 to 9 spoken sentences. Define terms, say why they matter, "
        "and add one short example when it helps.\n"
        "- Title, section, or lecture-number slides (is_sparse true, or text like L1): "
        "write 1 or 2 short sentences only. Do not pad.\n"
        "- IGNORE university names, institute logos, academic year, class/division placeholders, "
        "and professor names. Never mention them.\n"
        "- Do not invent a diagram walkthrough unless is_diagram is true or the text clearly "
        "describes a figure, flowchart, tree drawing, or chart.\n"
        "- Naturally mention the real on-screen terms in the same order they appear, "
        "so the video can highlight them.\n"
        "- Do not say 'this slide shows', 'welcome back', 'this slide has a diagram', "
        "or 'let's look at slide N'. No markdown.\n\n"
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
        "Look at the slide image. "
        "If it is a title slide, logo, heading, or mostly text, teach the actual content in 1 to 3 sentences. "
        "Do not treat university names or header logos as diagrams. "
        "Only walk through a figure if you can see a flowchart, chart, tree drawing, or labeled diagram. "
        "Then use a natural teaching order: start, each labeled part, result. "
        "Do not say 'this slide shows' or 'this slide has a diagram'. No markdown."
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


def expand_slide_scripts(
    slides: list[dict],
    title: str = "",
    on_progress=None,
) -> list[str]:
    """Return a spoken script for each slide, aligned to input order."""
    scripts = [""] * len(slides)
    pending: list[dict] = []
    pending_pos: list[int] = []
    total = len(slides)
    done = 0

    def _tick() -> None:
        nonlocal done
        done += 1
        if on_progress:
            on_progress(done, total)

    for i, slide in enumerate(slides):
        extracted = slide.get("extracted_text") or ""
        existing = slide.get("script") or ""
        if not needs_script_expansion(existing, extracted):
            scripts[i] = existing.strip()
            _tick()
            continue
        if on_progress:
            on_progress(done, total)
        image_path = str(slide.get("image_path") or "")
        body = content_text(extracted)
        if (
            image_path
            and slide_looks_like_diagram(slide.get("shapes") or [], extracted)
            and len(body) < 90
        ):
            vision = _generate_diagram_script({**slide, "index": i}, image_path, title)
            if vision and not is_low_quality_script(vision):
                scripts[i] = vision
                _tick()
                continue
        pending.append({**slide, "index": i})
        pending_pos.append(i)

    for start in range(0, len(pending), _BATCH):
        batch = pending[start : start + _BATCH]
        if on_progress:
            on_progress(done, total)
        generated = _generate_batch(batch, title)
        for offset, slide in enumerate(batch):
            pos = pending_pos[start + offset]
            local_index = int(slide["index"])
            candidate = generated.get(local_index) or generated.get(offset)
            if candidate and is_low_quality_script(candidate):
                candidate = None
            scripts[pos] = candidate or _local_expand(
                slide.get("extracted_text") or "",
                pos,
                slide.get("shapes") or [],
            )
            _tick()

    for i, slide in enumerate(slides):
        if not scripts[i]:
            scripts[i] = _local_expand(
                slide.get("extracted_text") or "",
                i,
                slide.get("shapes") or [],
            )
    return scripts
