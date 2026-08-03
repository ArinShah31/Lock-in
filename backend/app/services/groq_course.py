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

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
TRANSIENT_MARKERS = ("429", "rate_limit", "rate limit", "503", "timeout", "overloaded")
JSON_FAIL_MARKERS = ("json_validate_failed", "failed to generate json", "json_validate")
NOTES_MAX_TOKENS = 8192
INTRO_VIDEO_SKIP = re.compile(
    r"\b(introduction|intro\b|overview|getting started|welcome|course outline|syllabus review)\b",
    re.IGNORECASE,
)

TEACHING_SYSTEM = (
    "You are ASTRA's expert university instructor. Return ONLY valid JSON. "
    "Write classroom study material for ONE lesson.\n\n"
    "The goal is NOT to summarize the source material. "
    "The goal is to TEACH the concept to a student who has limited prior knowledge "
    "while maintaining university-level technical rigor.\n\n"
    "Rules:\n"
    "- Introduce concepts progressively.\n"
    "- Prefer explanation and reasoning over lists of facts.\n"
    "- Do not compress important concepts merely to make the content shorter.\n"
    "- Do not assume knowledge that has not been established as a prerequisite.\n"
    "- Source materials are context and topic scope only — do not paraphrase them as the lesson.\n"
    "- You MUST return a COMPLETE valid JSON object (close all braces/quotes). "
    "Never leave notes_markdown unfinished.\n\n"
    "For every major concept, cover in this order:\n"
    "1. Why it is needed\n"
    "2. Intuitive explanation\n"
    "3. Formal/technical definition\n"
    "4. How it works\n"
    "5. Worked example\n"
    "6. Practical application\n"
    "7. Likely misconceptions\n\n"
    "notes_markdown must be teaching markdown with ## / ### sections — "
    "substantive, but finish the whole JSON within the response."
)

TEACHING_MARKDOWN_SYSTEM = (
    "You are ASTRA's expert university instructor. Write markdown study notes for ONE lesson only. "
    "Do NOT wrap the answer in JSON or code fences.\n\n"
    "The goal is NOT to summarize the source material. "
    "The goal is to TEACH the concept to a student who has limited prior knowledge "
    "while maintaining university-level technical rigor.\n\n"
    "Introduce concepts progressively. Prefer explanation and reasoning over lists of facts. "
    "Do not assume untaught prerequisites.\n\n"
    "For every major concept cover: why needed, intuition, formal definition, how it works, "
    "worked example, practical application, likely misconceptions.\n"
    "Aim for about 1200–2200 words and finish the lesson completely."
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
    return json.loads(cleaned)


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

    def chat_json(
        self,
        *,
        system: str,
        user: str,
        max_tokens: int | None = None,
    ) -> dict[str, Any]:
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


def generate_structure(*, classroom_name: str, source_text: str) -> list[dict[str, Any]]:
    client = GroqStageClient("STRUCTURE")
    data = client.chat_json(
        system=(
            "You are ASTRA's AI course builder. Return ONLY valid JSON. "
            "Build a clear chapter outline from the provided materials. "
            "Order chapters so later chapters build on earlier prerequisites."
        ),
        user=(
            f"Classroom: {classroom_name}\n\n"
            "Source materials (topic scope):\n"
            f"{source_text[:12000]}\n\n"
            "Return JSON:\n"
            '{"chapters":[{"chapter":1,"title":"","summary":"","timeline":"",'
            '"objectives":[],"topics":[]}]}'
            "\nCreate 3 to 10 ordered chapters."
        ),
    )
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


def _lesson_outline(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    source_text: str,
) -> dict[str, Any]:
    client = GroqStageClient("CHAPTER_CONTENT")
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
                "learning_outcomes": [],
                "notes_markdown": "",
                "key_terms": [],
                "examples": [],
                "practice_prompts": [],
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
        f"Lesson goal: {lesson.get('summary')}\n\n"
        f"Source materials (topic scope only — do not summarize):\n{source_text[:8000]}"
    )


def _normalize_lesson_notes(data: dict[str, Any], lesson: dict[str, Any]) -> dict[str, Any]:
    return {
        "summary": str(data.get("summary") or lesson.get("summary") or ""),
        "learning_outcomes": _as_str_list(data.get("learning_outcomes")),
        "notes_markdown": str(data.get("notes_markdown") or "").strip(),
        "key_terms": _as_str_list(data.get("key_terms")),
        "examples": _as_str_list(data.get("examples")),
        "practice_prompts": _as_str_list(data.get("practice_prompts")),
    }


def _write_notes_markdown_fallback(
    *,
    client: GroqStageClient,
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
            "Write the full lesson notes in markdown now. "
            "Start with a ## heading for the lesson title. Finish completely."
        ),
        max_tokens=NOTES_MAX_TOKENS,
    )
    if markdown.startswith("```"):
        markdown = re.sub(r"^```(?:markdown|md)?\s*", "", markdown)
        markdown = re.sub(r"\s*```$", "", markdown).strip()
    return {
        "summary": str(lesson.get("summary") or ""),
        "learning_outcomes": [],
        "notes_markdown": markdown,
        "key_terms": [],
        "examples": [],
        "practice_prompts": [],
    }


def _write_full_lesson_notes(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    lesson: dict[str, Any],
    source_text: str,
    pinned_key: str | None = None,
) -> dict[str, Any]:
    client = GroqStageClient("CHAPTER_CONTENT", pinned_key=pinned_key)
    context = _notes_context_block(
        classroom_name=classroom_name,
        chapter=chapter,
        lesson=lesson,
        source_text=source_text,
    )
    base_user = (
        f"{context}\n\n"
        "Return JSON:\n"
        '{"summary":"","learning_outcomes":["string outcome 1","string outcome 2"],'
        '"notes_markdown":"","key_terms":["term"],"examples":["example"],'
        '"practice_prompts":["prompt"]}\n'
        "Schema rules:\n"
        "- learning_outcomes MUST be an array of plain strings (never objects)\n"
        "- key_terms, examples, practice_prompts MUST be arrays of strings\n"
        "- notes_markdown must be complete teaching markdown (~1200–2200 words)\n"
        "- Follow the 7-step treatment for major concepts\n"
        "- Include worked examples, practical applications, and misconceptions\n"
        "- End with a brief checklist recap\n"
        "- Return COMPLETE valid JSON only — close every brace and quote"
    )
    retry_user = (
        f"{context}\n\n"
        "IMPORTANT: A previous attempt was truncated and failed JSON validation. "
        "Return SHORTER but COMPLETE valid JSON with the same schema. "
        "Keep pedagogy (7-step treatment) but target ~900–1400 words in notes_markdown "
        "so the JSON finishes.\n"
        "learning_outcomes must be an array of plain strings.\n"
        "Return JSON:\n"
        '{"summary":"","learning_outcomes":["..."],"notes_markdown":"",'
        '"key_terms":[],"examples":[],"practice_prompts":[]}'
    )

    last_error: Exception | None = None
    for attempt, user in enumerate((base_user, retry_user, retry_user)):
        try:
            data = client.chat_json(
                system=TEACHING_SYSTEM,
                user=user,
                max_tokens=NOTES_MAX_TOKENS,
            )
            normalized = _normalize_lesson_notes(data, lesson)
            if normalized["notes_markdown"]:
                return normalized
            raise ValueError("Empty notes_markdown in JSON response")
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

    pool = settings.groq_keys_for_notes_pool()
    if not pool:
        raise RuntimeError(
            "No Groq API keys configured for notes. "
            "Set GROQ_API_KEY_STRUCTURE / NOTES / QUIZ in backend/.env"
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
        updated = dict(lesson)
        updated.update(
            {
                "summary": str(lesson.get("summary") or ""),
                "learning_outcomes": [],
                "notes_markdown": (
                    f"## {lesson.get('title')}\n\n"
                    f"Study notes could not be generated for this lesson ({error}). "
                    "Use Regenerate content to retry.\n"
                ),
                "key_terms": [],
                "examples": [],
                "practice_prompts": [],
            }
        )
        return updated

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
            updated = dict(lesson)
            updated.update(notes)
            if not updated.get("notes_markdown"):
                updated["notes_markdown"] = (
                    f"## {updated.get('title')}\n\n"
                    f"{updated.get('summary') or 'Study notes could not be generated. Regenerate this chapter.'}\n"
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

    # One serial retry for failed lessons (often helps after parallel rate/truncation pressure).
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
            updated = dict(lesson)
            updated.update(notes)
            if not updated.get("notes_markdown"):
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
        title = str(lesson.get("title") or "Lesson")
        notes = str(lesson.get("notes_markdown") or "").strip()
        if not notes:
            summary = str(lesson.get("summary") or "").strip()
            if summary:
                parts.append(f"### {title}\n{summary}")
            continue
        excerpt = notes[:per_lesson]
        chunk = f"### {title}\n{excerpt}"
        if used + len(chunk) > total_cap:
            break
        parts.append(chunk)
        used += len(chunk)
    return "\n\n".join(parts)


def _parse_quiz(data: dict[str, Any]) -> list[dict[str, Any]]:
    quiz = []
    for q in data.get("quiz") or []:
        options = [str(o) for o in (q.get("options") or [])]
        if len(options) < 2:
            continue
        correct = str(q.get("correct_answer") or options[0])
        if correct not in options:
            correct = options[0]
        quiz.append(
            {
                "question": str(q.get("question") or ""),
                "options": options,
                "correct_answer": correct,
                "explanation": str(q.get("explanation") or ""),
            }
        )
    return [q for q in quiz if q["question"]]


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


def generate_chapter_quiz(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
) -> list[dict[str, Any]]:
    assessments = generate_chapter_assessments(
        classroom_name=classroom_name,
        chapter=chapter,
        include_flashcards=False,
    )
    return assessments["quiz"]


def generate_chapter_assessments(
    *,
    classroom_name: str,
    chapter: dict[str, Any],
    include_flashcards: bool = True,
) -> dict[str, Any]:
    client = GroqStageClient("CHAPTER_QUIZ")
    lessons = chapter_lessons(chapter)
    lesson_titles = [s.get("title") for s in lessons]
    notes = _notes_excerpts(chapter)
    flashcard_schema = (
        ',"flashcards":[{"question":"","answer":"","topic":""}]' if include_flashcards else ""
    )
    flashcard_instruction = (
        "\nAlso provide 6 to 12 flashcards that check understanding of taught concepts."
        if include_flashcards
        else ""
    )
    data = client.chat_json(
        system=(
            "You are ASTRA's assessment writer. Return ONLY valid JSON. "
            "Write quizzes from the taught lesson notes — test understanding and reasoning, "
            "not trivia memorization of the syllabus."
        ),
        user=(
            f"Classroom: {classroom_name}\n"
            f"Chapter {chapter.get('chapter')}: {chapter.get('title')}\n"
            f"Summary: {chapter.get('summary')}\n"
            f"Lessons: {lesson_titles}\n"
            f"Topics: {chapter.get('topics')}\n\n"
            f"Taught notes (excerpts):\n{notes or '(no notes yet — use chapter summary/topics)'}\n\n"
            "Return JSON:\n"
            '{"quiz":[{"question":"","options":["A","B","C","D"],'
            '"correct_answer":"","explanation":""}]'
            f"{flashcard_schema}"
            "}\n"
            "Provide 4 to 8 multiple-choice questions. correct_answer must exactly match one option."
            f"{flashcard_instruction}"
        ),
    )
    return {
        "quiz": _parse_quiz(data),
        "flashcards": _parse_flashcards(data) if include_flashcards else [],
    }
