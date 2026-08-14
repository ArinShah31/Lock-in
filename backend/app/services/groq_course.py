"""Groq client with per-stage key pinning, notes parallelism, and 429 failover."""

from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Callable

from openai import OpenAI

from app.core.config import settings
from app.services.lesson_schema import lesson_has_content, normalize_lesson

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
TRANSIENT_MARKERS = (
    "429",
    "rate_limit",
    "rate limit",
    "503",
    "timeout",
    "overloaded",
    "resource_exhausted",
    "unavailable",
)
JSON_FAIL_MARKERS = ("json_validate_failed", "failed to generate json", "json_validate")
NOTES_MAX_TOKENS = 8192
INTRO_VIDEO_SKIP = re.compile(
    r"\b(introduction|intro\b|overview|getting started|welcome|course outline|syllabus review)\b",
    re.IGNORECASE,
)

TEACHING_SYSTEM = (
    "You are ASTRA's expert university instructor. Return ONLY valid JSON for ONE subtopic/lesson.\n\n"
    "Goals: learning quality AND complete JSON that finishes quickly. "
    "Teach progressively with university-level rigor. Do NOT summarize source materials — teach concepts.\n\n"
    "Speed/quality bounds:\n"
    "- 3 to 5 logical sections (choose titles suited to the topic)\n"
    "- 3 to 5 measurable learning_objectives (Explain/Differentiate/Apply — not vague Understand/Know)\n"
    "- 1 to 3 concrete examples\n"
    "- 4 to 8 key_terms with definitions\n"
    "- 0 to 3 real_world_applications (empty array if not meaningful)\n"
    "- 0 to 3 common_misconceptions (empty if none are realistic)\n"
    "- Prefer empty sources/references over fabricated citations or URLs\n"
    "- No filler, no repetition, no quizzes/flashcards/practice prompts\n"
    "- Return COMPLETE valid JSON (close all braces/quotes)\n"
)

TEACHING_MARKDOWN_SYSTEM = (
    "You are ASTRA's expert university instructor. Write focused markdown for ONE lesson. "
    "Do NOT wrap in JSON or code fences. Teach progressively with clear ## section headings "
    "(about 3–5 sections). Prefer clarity over length. Finish completely."
)

LESSON_JSON_SCHEMA = (
    '{"title":"","overview":"","learning_objectives":["Explain ..."],'
    '"prerequisites":[],'
    '"sections":[{"title":"","content_markdown":"","key_points":[],'
    '"sources":[{"title":"","url":"","source_type":"official_documentation"}]}],'
    '"examples":[{"title":"","context":"","content_markdown":"","takeaway":""}],'
    '"real_world_applications":[{"title":"","description":""}],'
    '"common_misconceptions":[{"misconception":"","correction":""}],'
    '"key_terms":[{"term":"","definition":""}],'
    '"summary":"",'
    '"references":[{"title":"","url":"","source_type":"official_documentation"}]}'
)


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
                or ""
            ).strip()
            if text:
                result.append(text)
        elif item is not None:
            text = str(item).strip()
            if text:
                result.append(text)
    return result


def infer_needs_video(title: str, explicit: bool | None = None) -> bool:
    if explicit is False:
        return False
    if explicit is True:
        return True
    return not bool(INTRO_VIDEO_SKIP.search(title or ""))


def _is_transient(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(m in text for m in TRANSIENT_MARKERS)


def _is_json_validate_failed(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(m in text for m in JSON_FAIL_MARKERS)


def _extract_json(text: str) -> Any:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            return json.loads(cleaned[start : end + 1])
        raise


class GroqStageClient:
    def __init__(self, stage: str, *, pinned_key: str | None = None):
        self.stage = stage
        self.model = settings.groq_model or "llama-3.1-8b-instant"
        if pinned_key:
            others = [k for k in settings.groq_keys_for_stage(stage) if k != pinned_key]
            self.keys = [pinned_key, *others]
        else:
            self.keys = settings.groq_keys_for_stage(stage)
        if not self.keys:
            raise RuntimeError(
                f"No Groq API keys configured for stage {stage}. "
                "Set GROQ_API_KEY_STRUCTURE / NOTES / QUIZ in backend/.env"
            )

    def _chat_json_loose(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        json_system = (
            f"{system}\n\nReturn ONLY one valid JSON object. "
            "No markdown fences, no prose before or after the JSON."
        )
        last_error: Exception | None = None
        for key in self.keys:
            client = OpenAI(api_key=key, base_url=GROQ_BASE_URL, timeout=180.0)
            for attempt in range(2):
                try:
                    response = client.chat.completions.create(
                        model=self.model,
                        temperature=0.2,
                        messages=[
                            {"role": "system", "content": json_system},
                            {"role": "user", "content": user},
                        ],
                        max_tokens=max_tokens or 4096,
                    )
                    content = response.choices[0].message.content or "{}"
                    data = _extract_json(content)
                    if not isinstance(data, dict):
                        raise ValueError("Model returned non-object JSON")
                    return data
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _is_transient(exc):
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
        raise RuntimeError(f"Groq {self.stage} loose JSON parse failed: {last_error}")

    def chat_json(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        last_error: Exception | None = None
        saw_json_validate = False
        for key in self.keys:
            client = OpenAI(api_key=key, base_url=GROQ_BASE_URL, timeout=180.0)
            for attempt in range(3):
                try:
                    kwargs: dict[str, Any] = {
                        "model": self.model,
                        "temperature": 0.35,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "response_format": {"type": "json_object"},
                    }
                    if max_tokens is not None:
                        kwargs["max_tokens"] = max_tokens
                    response = client.chat.completions.create(**kwargs)
                    content = response.choices[0].message.content or "{}"
                    data = _extract_json(content)
                    if not isinstance(data, dict):
                        raise ValueError("Model returned non-object JSON")
                    return data
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _is_json_validate_failed(exc):
                        saw_json_validate = True
                    if _is_transient(exc) or _is_json_validate_failed(exc):
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
        if saw_json_validate:
            try:
                return self._chat_json_loose(system=system, user=user, max_tokens=max_tokens)
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        raise RuntimeError(f"Groq {self.stage} failed after key failover: {last_error}")

    def chat_text(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> str:
        last_error: Exception | None = None
        for key in self.keys:
            client = OpenAI(api_key=key, base_url=GROQ_BASE_URL, timeout=180.0)
            for attempt in range(3):
                try:
                    kwargs: dict[str, Any] = {
                        "model": self.model,
                        "temperature": 0.35,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                    }
                    if max_tokens is not None:
                        kwargs["max_tokens"] = max_tokens
                    response = client.chat.completions.create(**kwargs)
                    return (response.choices[0].message.content or "").strip()
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _is_transient(exc):
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
        raise RuntimeError(f"Groq {self.stage} text failed after key failover: {last_error}")


class GeminiNotesClient:
    """Gemini 2.5 Flash client for lesson outline + full notes (OpenAI-compatible API)."""

    def __init__(self, *, pinned_key: str | None = None):
        self.model = settings.gemini_model or "gemini-3.6-flash"
        pool = settings.gemini_keys_for_notes_pool()
        if pinned_key:
            others = [k for k in pool if k != pinned_key]
            self.keys = [pinned_key, *others]
        else:
            self.keys = pool
        if not self.keys:
            raise RuntimeError(
                "No Gemini API keys configured for notes. "
                "Set GEMINI_API_KEY_NOTES_1 / _2 / _3 in backend/.env"
            )

    def chat_json(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
        last_error: Exception | None = None
        for key in self.keys:
            client = OpenAI(api_key=key, base_url=GEMINI_OPENAI_BASE_URL, timeout=180.0)
            for attempt in range(3):
                try:
                    kwargs: dict[str, Any] = {
                        "model": self.model,
                        "temperature": 0.35,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "response_format": {"type": "json_object"},
                    }
                    if max_tokens is not None:
                        kwargs["max_tokens"] = max_tokens
                    response = client.chat.completions.create(**kwargs)
                    content = response.choices[0].message.content or "{}"
                    data = _extract_json(content)
                    if not isinstance(data, dict):
                        raise ValueError("Model returned non-object JSON")
                    return data
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _is_transient(exc) or _is_json_validate_failed(exc):
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
        raise RuntimeError(f"Gemini notes failed after key failover: {last_error}")

    def chat_text(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> str:
        last_error: Exception | None = None
        for key in self.keys:
            client = OpenAI(api_key=key, base_url=GEMINI_OPENAI_BASE_URL, timeout=180.0)
            for attempt in range(3):
                try:
                    kwargs: dict[str, Any] = {
                        "model": self.model,
                        "temperature": 0.35,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                    }
                    if max_tokens is not None:
                        kwargs["max_tokens"] = max_tokens
                    response = client.chat.completions.create(**kwargs)
                    return (response.choices[0].message.content or "").strip()
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _is_transient(exc):
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    break
        raise RuntimeError(f"Gemini notes text failed after key failover: {last_error}")


def _structure_chapters_from_data(data: dict[str, Any]) -> list[dict[str, Any]]:
    chapters = data.get("chapters") or []
    if not chapters:
        raise ValueError("No chapters returned from structure generation")
    result = []
    for idx, ch in enumerate(chapters, start=1):
        result.append(
            {
                "chapter": int(ch.get("chapter") or idx),
                "title": str(ch.get("title") or f"Chapter {idx}"),
                "summary": str(ch.get("summary") or ""),
                "timeline": str(ch.get("timeline") or ""),
                "objectives": _as_str_list(ch.get("objectives")),
                "topics": _as_str_list(ch.get("topics")),
                "activities": [],
                "lessons": [],
                "subtopics": [],
                "flashcards": [],
                "quiz": [],
            }
        )
    return sorted(result, key=lambda c: c["chapter"])


def _generate_structure_gemini(*, classroom_name: str, source_text: str) -> dict[str, Any]:
    from google import genai
    from pydantic import BaseModel, Field

    class ChapterOutline(BaseModel):
        chapter: int
        title: str
        summary: str = ""
        timeline: str = ""
        objectives: list[str] = Field(default_factory=list)
        topics: list[str] = Field(default_factory=list)

    class StructurePayload(BaseModel):
        chapters: list[ChapterOutline] = Field(default_factory=list)

    api_key = settings.gemini_api_key.strip()
    if not api_key:
        raise RuntimeError("Gemini API key is not configured for structure fallback")

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=settings.gemini_chat_model,
        contents=(
            "You are ASTRA's AI course builder. Build a clear chapter outline from the materials.\n\n"
            f"Classroom: {classroom_name}\n\n"
            "Source materials (topic scope):\n"
            f"{source_text[:12000]}\n\n"
            "Create 3 to 10 ordered chapters. Each chapter needs title, summary, timeline, "
            "objectives, and topics."
        ),
        config={
            "response_mime_type": "application/json",
            "response_schema": StructurePayload,
        },
    )
    payload = response.parsed
    if payload is None:
        raise ValueError("Gemini structure generation returned empty payload")
    return payload.model_dump()


def generate_structure(*, classroom_name: str, source_text: str) -> list[dict[str, Any]]:
    prompt_user = (
        f"Classroom: {classroom_name}\n\n"
        "Source materials (topic scope):\n"
        f"{source_text[:10000]}\n\n"
        "Return JSON:\n"
        '{"chapters":[{"chapter":1,"title":"","summary":"","timeline":"",'
        '"objectives":[],"topics":[]}]}'
        "\nCreate 3 to 8 ordered chapters. Keep summaries short (1-2 sentences)."
    )
    prompt_system = (
        "You are ASTRA's AI course builder. Return ONLY valid JSON. "
        "Build a clear chapter outline from the provided materials. "
        "Order chapters so later chapters build on earlier prerequisites."
    )
    try:
        client = GroqStageClient("STRUCTURE")
        data = client.chat_json(system=prompt_system, user=prompt_user, max_tokens=4096)
        return _structure_chapters_from_data(data)
    except RuntimeError:
        data = _generate_structure_gemini(classroom_name=classroom_name, source_text=source_text)
        return _structure_chapters_from_data(data)


def _lesson_outline(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    source_text: str,
) -> dict[str, Any]:
    client = GeminiNotesClient()
    data = client.chat_json(
        system=(
            "You are ASTRA's curriculum designer. Return ONLY valid JSON. "
            "Split one chapter into 3-6 teachable lessons that introduce concepts progressively "
            "(earlier lessons establish prerequisites for later ones). "
            "Do not design lessons as source summaries — design them as a teaching sequence. "
            "Mark needs_video false for introduction/overview/welcome lessons; true for topical lessons."
        ),
        user=(
            f"Classroom: {classroom_name}\n"
            f"Chapter {chapter.get('chapter')}: {chapter.get('title')}\n"
            f"Summary: {chapter.get('summary')}\n"
            f"Topics: {chapter.get('topics')}\n"
            f"Objectives: {chapter.get('objectives')}\n\n"
            f"Source materials (topic scope only):\n{source_text[:7000]}\n\n"
            "Return JSON:\n"
            '{"lessons":[{"lesson":1,"title":"","summary":"","needs_video":true}],'
            '"activities":[]}'
            "\nInclude 3 to 6 lessons. Each summary should state what the student will learn, "
            "not a bullet list of syllabus lines."
        ),
    )
    lessons = []
    for idx, lesson in enumerate(data.get("lessons") or [], start=1):
        title = str(lesson.get("title") or f"Lesson {idx}")
        explicit = lesson.get("needs_video")
        if isinstance(explicit, str):
            explicit = explicit.lower() in {"true", "1", "yes"}
        elif not isinstance(explicit, bool):
            explicit = None
        lessons.append(
            {
                "lesson": int(lesson.get("lesson") or idx),
                "title": title,
                "summary": str(lesson.get("summary") or ""),
                "needs_video": infer_needs_video(title, explicit),
                "overview": str(lesson.get("summary") or ""),
                "learning_objectives": [],
                "prerequisites": [],
                "sections": [],
                "examples": [],
                "real_world_applications": [],
                "common_misconceptions": [],
                "key_terms": [],
                "references": [],
                "youtube_video_id": None,
                "youtube_title": None,
                "youtube_url": None,
            }
        )
    return {
        "lessons": lessons,
        "activities": _as_str_list(data.get("activities")),
    }


def _notes_context_block(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    lesson: dict[str, Any],
    source_text: str,
) -> str:
    return (
        f"Classroom: {classroom_name}\n"
        f"Chapter {chapter.get('chapter')}: {chapter.get('title')}\n"
        f"Chapter summary: {chapter.get('summary')}\n"
        f"Lesson {lesson.get('lesson')}: {lesson.get('title')}\n"
        f"Lesson goal: {lesson.get('summary') or lesson.get('overview')}\n\n"
        f"Source materials (topic scope only — do not summarize):\n{source_text[:8000]}"
    )


def _write_notes_markdown_fallback(
    *,
    client: GeminiNotesClient,
    classroom_name: str,
    chapter: dict[str, Any],
    lesson: dict[str, Any],
    source_text: str,
) -> dict[str, Any]:
    context = _notes_context_block(
        classroom_name=classroom_name,
        chapter=chapter,
        lesson=lesson,
        source_text=source_text,
    )
    markdown = client.chat_text(
        system=TEACHING_MARKDOWN_SYSTEM,
        user=(
            f"{context}\n\n"
            "Write the lesson now with ## headings for each section. Finish completely."
        ),
        max_tokens=NOTES_MAX_TOKENS,
    )
    if markdown.startswith("```"):
        markdown = re.sub(r"^```(?:markdown|md)?\s*", "", markdown)
        markdown = re.sub(r"\s*```$", "", markdown).strip()
    title = str(lesson.get("title") or "Lesson")
    return normalize_lesson(
        {
            **lesson,
            "title": title,
            "overview": str(lesson.get("summary") or lesson.get("overview") or ""),
            "summary": "",
            "sections": [
                {
                    "title": title,
                    "content_markdown": markdown,
                    "key_points": [],
                    "sources": [],
                }
            ],
        },
        index=int(lesson.get("lesson") or 1),
    )


def _write_full_lesson_notes(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    lesson: dict[str, Any],
    source_text: str,
    pinned_key: str | None = None,
) -> dict[str, Any]:
    client = GeminiNotesClient(pinned_key=pinned_key)
    context = _notes_context_block(
        classroom_name=classroom_name,
        chapter=chapter,
        lesson=lesson,
        source_text=source_text,
    )
    base_user = (
        f"{context}\n\n"
        "Return JSON matching this schema exactly:\n"
        f"{LESSON_JSON_SCHEMA}\n"
        "Rules:\n"
        "- title should match the lesson title\n"
        "- overview introduces what/why; summary is a short recap only (no new ideas)\n"
        "- sections: 3–5 progressive teaching sections with content_markdown + key_points\n"
        "- sources/references: only real known URLs; otherwise use empty arrays "
        "(never invent citations)\n"
        "- source_type must be one of: official_documentation, academic_paper, textbook, "
        "government_source, reputable_website, technical_article, other\n"
        "- No quizzes, flashcards, practice prompts, or grading content\n"
        "- Return COMPLETE valid JSON"
    )
    retry_user = (
        f"{context}\n\n"
        "IMPORTANT: Previous output failed JSON validation (often truncation). "
        "Return SHORTER but COMPLETE valid JSON with the same schema. "
        "Use 3 sections, 2 examples, 4 key_terms, empty sources if unsure.\n"
        f"Schema:\n{LESSON_JSON_SCHEMA}"
    )

    last_error: Exception | None = None
    for attempt, user in enumerate((base_user, retry_user, retry_user)):
        try:
            data = client.chat_json(
                system=TEACHING_SYSTEM,
                user=user,
                max_tokens=NOTES_MAX_TOKENS,
            )
            merged = {
                **lesson,
                **data,
                "title": str(data.get("title") or lesson.get("title") or "Lesson"),
                "needs_video": lesson.get("needs_video"),
                "youtube_video_id": lesson.get("youtube_video_id"),
                "youtube_title": lesson.get("youtube_title"),
                "youtube_url": lesson.get("youtube_url"),
            }
            normalized = normalize_lesson(merged, index=int(lesson.get("lesson") or 1))
            if lesson_has_content(normalized):
                return normalized
            raise ValueError("Empty sections in structured lesson response")
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt < 2 and (_is_json_validate_failed(exc) or _is_transient(exc)):
                time.sleep(1.0 * (attempt + 1))
                continue
            break

    try:
        return _write_notes_markdown_fallback(
            client=client,
            classroom_name=classroom_name,
            chapter=chapter,
            lesson=lesson,
            source_text=source_text,
        )
    except Exception as fallback_exc:  # noqa: BLE001
        raise RuntimeError(
            f"Lesson notes failed after JSON retries and markdown fallback: {last_error}; "
            f"fallback: {fallback_exc}"
        ) from fallback_exc


def generate_chapter_content(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    source_text: str,
    on_progress: Callable[[str], None] | None = None,
) -> dict[str, Any]:
    outline = _lesson_outline(
        classroom_name=classroom_name,
        chapter=chapter,
        source_text=source_text,
    )
    lessons = outline["lessons"]
    if not lessons:
        raise ValueError("No lessons returned for chapter content")

    pool = settings.gemini_keys_for_notes_pool()
    if not pool:
        raise RuntimeError(
            "No Gemini API keys configured for notes. "
            "Set GEMINI_API_KEY_NOTES_1 / _2 / _3 in backend/.env"
        )

    progress_lock = threading.Lock()
    done_count = 0
    total = len(lessons)

    def report(message: str) -> None:
        if not on_progress:
            return
        with progress_lock:
            on_progress(message)

    def placeholder_lesson(lesson: dict[str, Any], error: str) -> dict[str, Any]:
        title = str(lesson.get("title") or "Lesson")
        return normalize_lesson(
            {
                **lesson,
                "title": title,
                "overview": str(lesson.get("summary") or ""),
                "sections": [
                    {
                        "title": title,
                        "content_markdown": (
                            f"Study notes could not be generated for this lesson ({error}). "
                            "Use Regenerate content to retry."
                        ),
                        "key_points": [],
                        "sources": [],
                    }
                ],
            },
            index=int(lesson.get("lesson") or 1),
        )

    def fill_one(index: int, lesson: dict[str, Any]) -> tuple[int, dict[str, Any], str | None]:
        nonlocal done_count
        key = pool[index % len(pool)]
        report(f"Writing full notes {index + 1}/{total}: {lesson.get('title')}")
        try:
            notes = _write_full_lesson_notes(
                classroom_name=classroom_name,
                chapter=chapter,
                lesson=lesson,
                source_text=source_text,
                pinned_key=key,
            )
            updated = normalize_lesson({**lesson, **notes}, index=index + 1)
            if not lesson_has_content(updated):
                updated = placeholder_lesson(
                    lesson,
                    "empty structured content",
                )
            with progress_lock:
                done_count += 1
                finished = done_count
            report(f"Completed notes {finished}/{total}: {updated.get('title')}")
            return index, updated, None
        except Exception as exc:  # noqa: BLE001
            return index, dict(lesson), str(exc)

    filled_by_index: dict[int, dict[str, Any]] = {}
    failed: list[tuple[int, dict[str, Any], str]] = []
    workers = min(len(pool), total)
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [executor.submit(fill_one, i, lesson) for i, lesson in enumerate(lessons)]
        for fut in as_completed(futures):
            idx, filled, err = fut.result()
            if err:
                failed.append((idx, filled, err))
                report(f"Notes failed {idx + 1}/{total}: {filled.get('title')} — will retry")
            else:
                filled_by_index[idx] = filled

    still_failed: list[tuple[int, dict[str, Any], str]] = []
    for idx, lesson, err in failed:
        report(f"Retrying notes {idx + 1}/{total}: {lesson.get('title')}")
        try:
            notes = _write_full_lesson_notes(
                classroom_name=classroom_name,
                chapter=chapter,
                lesson=lesson,
                source_text=source_text,
                pinned_key=pool[idx % len(pool)],
            )
            updated = normalize_lesson({**lesson, **notes}, index=idx + 1)
            if not lesson_has_content(updated):
                raise ValueError("Empty notes after retry")
            filled_by_index[idx] = updated
            with progress_lock:
                done_count += 1
                finished = done_count
            report(f"Completed notes {finished}/{total}: {updated.get('title')}")
        except Exception as retry_exc:  # noqa: BLE001
            still_failed.append((idx, lesson, str(retry_exc)))
            filled_by_index[idx] = placeholder_lesson(lesson, str(retry_exc)[:180])
            report(f"Notes still failed {idx + 1}/{total}: {lesson.get('title')}")

    if len(still_failed) == total:
        raise RuntimeError(
            "All lesson notes failed. Last error: "
            + (still_failed[0][2] if still_failed else "unknown")
        )

    filled_lessons = [filled_by_index[i] for i in range(total)]
    return {
        "activities": outline["activities"],
        "lessons": filled_lessons,
        "subtopics": filled_lessons,
        "flashcards": [],
    }


def chapter_lessons(chapter: dict[str, Any]) -> list[dict[str, Any]]:
    lessons = chapter.get("lessons")
    if isinstance(lessons, list) and lessons:
        return list(lessons)
    return list(chapter.get("subtopics") or [])


def _notes_excerpts(chapter: dict[str, Any], *, per_lesson: int = 1200, total_cap: int = 9000) -> str:
    parts: list[str] = []
    used = 0
    for lesson in chapter_lessons(chapter):
        normalized = normalize_lesson(lesson if isinstance(lesson, dict) else {})
        title = str(normalized.get("title") or "Lesson")
        chunks: list[str] = []
        overview = str(normalized.get("overview") or "").strip()
        if overview:
            chunks.append(overview)
        for section in normalized.get("sections") or []:
            if not isinstance(section, dict):
                continue
            body = str(section.get("content_markdown") or "").strip()
            if body:
                chunks.append(f"## {section.get('title') or 'Section'}\n{body}")
        text = "\n\n".join(chunks).strip()
        if not text:
            summary = str(normalized.get("summary") or "").strip()
            if summary:
                parts.append(f"### {title}\n{summary}")
            continue
        excerpt = text[:per_lesson]
        chunk = f"### {title}\n{excerpt}"
        if used + len(chunk) > total_cap:
            break
        parts.append(chunk)
        used += len(chunk)
    return "\n\n".join(parts)


def _parse_quiz(data: dict[str, Any]) -> list[dict[str, Any]]:
    from app.services.practice_gemini import parse_quiz_questions

    return parse_quiz_questions(data.get("quiz") or [])


def _parse_flashcards(data: dict[str, Any]) -> list[dict[str, Any]]:
    flashcards = []
    for fc in data.get("flashcards") or []:
        if not isinstance(fc, dict):
            continue
        q = str(fc.get("question") or "").strip()
        if not q:
            continue
        flashcards.append(
            {
                "question": q,
                "answer": str(fc.get("answer") or ""),
                "topic": str(fc.get("topic") or "General"),
            }
        )
    return flashcards


def _parse_scenarios(data: dict[str, Any], *, chapter_number: int) -> list[dict[str, Any]]:
    from app.services.practice_gemini import parse_scenarios

    return parse_scenarios(data.get("scenarios") or [], chapter_number=chapter_number)


def generate_chapter_quiz(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    document_source_text: str,
) -> list[dict[str, Any]]:
    assessments = generate_chapter_assessments(
        classroom_name=classroom_name,
        chapter=chapter,
        document_source_text=document_source_text,
        include_flashcards=False,
    )
    return assessments["quiz"]


def generate_chapter_assessments(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    document_source_text: str,
    include_flashcards: bool = True,
) -> dict[str, Any]:
    client = GroqStageClient("CHAPTER_QUIZ")
    source_excerpt = document_source_text.strip()[:18000]
    if not source_excerpt:
        return {"quiz": [], "flashcards": [], "scenarios": []}
    flashcard_schema = (
        ',"flashcards":[{"question":"","answer":"","topic":""}]' if include_flashcards else ""
    )
    scenario_schema = (
        ',"scenarios":[{"title":"","situation":"","questions":[{"question":"","options":'
        '["First complete answer","Second complete answer","Third complete answer","Fourth complete answer"],'
        '"correct_answer":"Second complete answer","explanation":"","bloom_level":"APPLY"}]}]'
    )
    flashcard_instruction = (
        "\nAlso provide 6 to 12 flashcards that check understanding of taught concepts."
        if include_flashcards
        else ""
    )
    chapter_number = int(chapter.get("chapter") or 0)
    last_data: dict[str, Any] = {}
    scenarios: list[dict[str, Any]] = []
    for attempt in range(2):
        retry_note = ""
        if attempt:
            retry_note = (
                "\n\nIMPORTANT: Your previous response used placeholder options like A, B, C, D. "
                "Every option must be a complete answer phrase. correct_answer must match one option exactly."
            )
        last_data = client.chat_json(
            system=(
                "You are ASTRA's assessment writer. Return ONLY valid JSON. "
                "Write quizzes, flashcards, and scenarios from the provided classroom documents only — "
                "test understanding and reasoning grounded in those materials."
            ),
            user=(
                f"Classroom: {classroom_name}\n"
                f"Chapter {chapter.get('chapter')}: {chapter.get('title')}\n"
                f"Summary: {chapter.get('summary')}\n"
                f"Topics: {chapter.get('topics')}\n\n"
                f"Classroom documents:\n{source_excerpt}\n\n"
                "Return JSON:\n"
                '{"quiz":[{"question":"","options":["First complete answer","Second complete answer",'
                '"Third complete answer","Fourth complete answer"],"correct_answer":"Second complete answer",'
                '"explanation":"","bloom_level":"APPLY"}]'
                f"{flashcard_schema}"
                f"{scenario_schema}"
                "}\n"
                "Provide 4 to 8 multiple-choice quiz questions.\n"
                "Each question must include bloom_level as one of: REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE.\n"
                "The bloom_level must match the cognitive demand of the question stem.\n"
                "Each option must be a full answer sentence or phrase — never use bare letters like A, B, C, or D.\n"
                "correct_answer must exactly match one option string."
                f"{flashcard_instruction}\n"
                "Also provide 5 to 6 scenario case studies. Each scenario has a title, one concise situation "
                "paragraph, and exactly 5 MCQs with 4 full-text options each. Scenario questions must apply the situation. "
                "Each scenario MCQ must include bloom_level as one of: REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE."
                f"{retry_note}"
            ),
        )
        scenarios = _parse_scenarios(last_data, chapter_number=chapter_number)
        if scenarios:
            break
    return {
        "quiz": _parse_quiz(last_data),
        "flashcards": _parse_flashcards(last_data) if include_flashcards else [],
        "scenarios": scenarios,
    }
