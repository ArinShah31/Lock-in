"""Lesson/subtopic content schema normalization (new + legacy shapes)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

SOURCE_TYPES = frozenset(
    {
        "official_documentation",
        "academic_paper",
        "textbook",
        "government_source",
        "reputable_website",
        "technical_article",
        "other",
    }
)
HTTP_URL = re.compile(r"^https?://", re.IGNORECASE)


def _as_str_list(values: list | None) -> list[str]:
    result: list[str] = []
    for item in values or []:
        if isinstance(item, str):
            text = item.strip()
            if text:
                result.append(text)
        elif isinstance(item, dict):
            text = str(
                item.get("title")
                or item.get("name")
                or item.get("text")
                or item.get("description")
                or item.get("term")
                or ""
            ).strip()
            if text:
                result.append(text)
        elif item is not None:
            text = str(item).strip()
            if text:
                result.append(text)
    return result


def _clean_url(url: Any) -> str | None:
    text = str(url or "").strip()
    if not text or not HTTP_URL.match(text):
        return None
    try:
        parsed = urlparse(text)
        if not parsed.netloc:
            return None
    except Exception:  # noqa: BLE001
        return None
    return text


def _source_type(value: Any) -> str:
    text = str(value or "other").strip().lower().replace(" ", "_").replace("-", "_")
    return text if text in SOURCE_TYPES else "other"


def _normalize_source(item: Any) -> dict[str, str] | None:
    if isinstance(item, str):
        url = _clean_url(item)
        if not url:
            return None
        return {"title": url, "url": url, "source_type": "other"}
    if not isinstance(item, dict):
        return None
    title = str(item.get("title") or item.get("name") or "").strip()
    url = _clean_url(item.get("url"))
    if not title and not url:
        return None
    if not title and url:
        title = url
    return {
        "title": title,
        "url": url or "",
        "source_type": _source_type(item.get("source_type")),
    }


def _normalize_sources(values: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for item in values or []:
        src = _normalize_source(item)
        if src:
            out.append(src)
    return out


def _dedupe_sources(sources: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    result: list[dict[str, str]] = []
    for src in sources:
        key = (src.get("url") or src.get("title") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(src)
    return result


def _normalize_sections(values: Any) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    for item in values or []:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        content = str(item.get("content_markdown") or item.get("content") or "").strip()
        if not title and not content:
            continue
        sections.append(
            {
                "title": title or "Section",
                "content_markdown": content,
                "key_points": _as_str_list(item.get("key_points")),
                "sources": _normalize_sources(item.get("sources")),
            }
        )
    return sections


def _normalize_examples(values: Any) -> list[dict[str, str]]:
    examples: list[dict[str, str]] = []
    for item in values or []:
        if isinstance(item, str):
            text = item.strip()
            if text:
                examples.append(
                    {
                        "title": "Example",
                        "context": "",
                        "content_markdown": text,
                        "takeaway": "",
                    }
                )
            continue
        if not isinstance(item, dict):
            continue
        content = str(
            item.get("content_markdown") or item.get("content") or item.get("example") or ""
        ).strip()
        title = str(item.get("title") or "").strip() or "Example"
        if not content and not title:
            continue
        examples.append(
            {
                "title": title,
                "context": str(item.get("context") or "").strip(),
                "content_markdown": content,
                "takeaway": str(item.get("takeaway") or "").strip(),
            }
        )
    return examples


def _normalize_applications(values: Any) -> list[dict[str, str]]:
    apps: list[dict[str, str]] = []
    for item in values or []:
        if isinstance(item, str):
            text = item.strip()
            if text:
                apps.append({"title": "Application", "description": text})
            continue
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip() or "Application"
        description = str(item.get("description") or item.get("text") or "").strip()
        if not description:
            continue
        apps.append({"title": title, "description": description})
    return apps


def _normalize_misconceptions(values: Any) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for item in values or []:
        if not isinstance(item, dict):
            continue
        misconception = str(item.get("misconception") or item.get("wrong") or "").strip()
        correction = str(item.get("correction") or item.get("right") or "").strip()
        if not misconception or not correction:
            continue
        items.append({"misconception": misconception, "correction": correction})
    return items


def _normalize_key_terms(values: Any) -> list[dict[str, str]]:
    terms: list[dict[str, str]] = []
    for item in values or []:
        if isinstance(item, str):
            text = item.strip()
            if text:
                terms.append({"term": text, "definition": ""})
            continue
        if not isinstance(item, dict):
            continue
        term = str(item.get("term") or item.get("name") or item.get("title") or "").strip()
        definition = str(item.get("definition") or item.get("meaning") or "").strip()
        if not term:
            continue
        terms.append({"term": term, "definition": definition})
    return terms


def _is_legacy_lesson(raw: dict[str, Any]) -> bool:
    if raw.get("sections") or raw.get("overview") or raw.get("learning_objectives"):
        return False
    return bool(
        raw.get("notes_markdown")
        or raw.get("learning_outcomes")
        or raw.get("practice_prompts")
        or isinstance((raw.get("examples") or [None])[0] if raw.get("examples") else None, str)
        or isinstance((raw.get("key_terms") or [None])[0] if raw.get("key_terms") else None, str)
    )


def _from_legacy(raw: dict[str, Any]) -> dict[str, Any]:
    title = str(raw.get("title") or "Lesson").strip()
    old_summary = str(raw.get("summary") or "").strip()
    notes = str(raw.get("notes_markdown") or "").strip()
    objectives = _as_str_list(raw.get("learning_outcomes") or raw.get("learning_objectives"))
    sections = _normalize_sections(raw.get("sections"))
    if not sections and notes:
        sections = [
            {
                "title": title,
                "content_markdown": notes,
                "key_points": [],
                "sources": [],
            }
        ]
    overview = str(raw.get("overview") or "").strip() or old_summary
    summary = str(raw.get("summary") or "").strip()
    if overview and summary == overview:
        # Prefer overview for intro; keep a short recap only if distinct later generations set it.
        summary = old_summary if old_summary and old_summary != overview else ""
        if not summary and old_summary:
            summary = old_summary
    return {
        "overview": overview,
        "learning_objectives": objectives,
        "prerequisites": _as_str_list(raw.get("prerequisites")),
        "sections": sections,
        "examples": _normalize_examples(raw.get("examples")),
        "real_world_applications": _normalize_applications(raw.get("real_world_applications")),
        "common_misconceptions": _normalize_misconceptions(raw.get("common_misconceptions")),
        "key_terms": _normalize_key_terms(raw.get("key_terms")),
        "summary": summary or (old_summary if overview != old_summary else ""),
        "references": _normalize_sources(raw.get("references")),
    }


def lesson_has_content(lesson: dict[str, Any]) -> bool:
    for section in lesson.get("sections") or []:
        if isinstance(section, dict) and str(section.get("content_markdown") or "").strip():
            return True
    return bool(str(lesson.get("notes_markdown") or "").strip())


def normalize_lesson(raw: dict[str, Any] | None, *, index: int = 1) -> dict[str, Any]:
    """Normalize new or legacy lesson dicts into the canonical structured schema."""
    data = dict(raw or {})
    title = str(data.get("title") or f"Lesson {index}").strip()

    if _is_legacy_lesson(data):
        body = _from_legacy(data)
    else:
        body = {
            "overview": str(data.get("overview") or data.get("summary") or "").strip(),
            "learning_objectives": _as_str_list(
                data.get("learning_objectives") or data.get("learning_outcomes")
            ),
            "prerequisites": _as_str_list(data.get("prerequisites")),
            "sections": _normalize_sections(data.get("sections")),
            "examples": _normalize_examples(data.get("examples")),
            "real_world_applications": _normalize_applications(data.get("real_world_applications")),
            "common_misconceptions": _normalize_misconceptions(data.get("common_misconceptions")),
            "key_terms": _normalize_key_terms(data.get("key_terms")),
            "summary": str(data.get("summary") or "").strip(),
            "references": _normalize_sources(data.get("references")),
        }
        # Legacy notes sitting alongside new fields
        notes = str(data.get("notes_markdown") or "").strip()
        if notes and not body["sections"]:
            body["sections"] = [
                {
                    "title": title,
                    "content_markdown": notes,
                    "key_points": [],
                    "sources": [],
                }
            ]

    section_sources: list[dict[str, str]] = []
    for section in body["sections"]:
        section_sources.extend(section.get("sources") or [])
    body["references"] = _dedupe_sources([*body["references"], *section_sources])

    needs = data.get("needs_video")
    if not isinstance(needs, bool):
        needs = None

    return {
        "lesson": int(data.get("lesson") or index),
        "title": title,
        "overview": body["overview"],
        "learning_objectives": body["learning_objectives"],
        "prerequisites": body["prerequisites"],
        "sections": body["sections"],
        "examples": body["examples"],
        "real_world_applications": body["real_world_applications"],
        "common_misconceptions": body["common_misconceptions"],
        "key_terms": body["key_terms"],
        "summary": body["summary"],
        "references": body["references"],
        # Compatibility aliases for older UI paths
        "learning_outcomes": body["learning_objectives"],
        "notes_markdown": "",
        "practice_prompts": [],
        "needs_video": needs,
        "youtube_video_id": data.get("youtube_video_id"),
        "youtube_title": data.get("youtube_title"),
        "youtube_url": data.get("youtube_url"),
    }
