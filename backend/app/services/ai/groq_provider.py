"""Groq free-tier course builder (OpenAI-compatible chat API)."""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from openai import OpenAI

from app.schemas.course_builder import (
    ArtifactType,
    ChapterContent,
    ChapterNotesContent,
    ChapterOutline,
    ChapterPracticeOutput,
    CourseBuilderOutput,
    CourseOutlineOutput,
)
from app.services.ai.provider import CourseBuilderProvider, ProgressCallback

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
PRACTICE_CONCURRENCY = 2
TRANSIENT_MARKERS = ("429", "rate_limit", "rate limit", "503", "timeout", "overloaded")


class GroqCourseBuilderProvider(CourseBuilderProvider):
    def __init__(self, api_key: str, model: str):
        self.api_key = api_key
        self.model = model
        self.client = OpenAI(api_key=api_key, base_url=GROQ_BASE_URL, timeout=120.0)

    def generate_course(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        requested_artifacts: list[ArtifactType],
        on_progress: ProgressCallback | None = None,
    ) -> CourseBuilderOutput:
        syllabus = self._resolve_syllabus_text(syllabus_text, syllabus_file_path)
        if on_progress:
            on_progress("Building chapter outline (Groq)…")

        outline = self._chat_json(
            system=(
                "You are ASTRA's AI course builder. Return ONLY valid JSON matching the schema. "
                "No markdown fences."
            ),
            user=self._build_outline_prompt(subject_name, syllabus),
            schema_hint=(
                '{"chapters":[{"chapter":1,"title":"","summary":"","timeline":"",'
                '"objectives":[],"topics":[],"activities":[]}]}'
            ),
            model_type=CourseOutlineOutput,
        )
        ordered = sorted(outline.chapters, key=lambda item: item.chapter)
        if not ordered:
            raise ValueError("Groq returned no chapters in the outline step")

        total = len(ordered)
        if on_progress:
            on_progress(f"Outline ready ({total} chapters). Generating practice packs…")

        completed = 0
        progress_lock = threading.Lock()
        assembled: dict[int, ChapterContent] = {}

        def _practice_one(chapter: ChapterOutline) -> ChapterContent:
            nonlocal completed
            practice = self._generate_chapter_practice(subject_name, chapter, syllabus)
            with progress_lock:
                completed += 1
                if on_progress:
                    on_progress(
                        f"Generating practice {completed}/{total}: "
                        f"chapter {chapter.chapter} — {chapter.title}"
                    )
            return ChapterContent(
                chapter=chapter.chapter,
                title=chapter.title,
                summary=chapter.summary,
                timeline=chapter.timeline,
                objectives=chapter.objectives,
                topics=chapter.topics,
                activities=chapter.activities,
                flashcards=practice.flashcards,
                quiz=practice.quiz,
                assessment=None,
            )

        with ThreadPoolExecutor(max_workers=PRACTICE_CONCURRENCY) as pool:
            futures = {pool.submit(_practice_one, chapter): chapter for chapter in ordered}
            for future in as_completed(futures):
                chapter_content = future.result()
                assembled[chapter_content.chapter] = chapter_content

        chapters = [assembled[item.chapter] for item in ordered]
        if on_progress:
            on_progress("Saving learning path…")
        return CourseBuilderOutput(chapters=chapters)

    def generate_chapter_notes(
        self,
        *,
        subject_name: str,
        chapter: int,
        chapter_title: str,
        topics: list[str],
        objectives: list[str],
        summary: str | None,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        on_progress: ProgressCallback | None = None,
    ) -> ChapterNotesContent:
        if on_progress:
            on_progress(f"Writing notes for chapter {chapter} (Groq)…")
        syllabus = self._resolve_syllabus_text(syllabus_text, syllabus_file_path)
        notes = self._chat_json(
            system=(
                "You are ASTRA's teaching-notes writer. Return ONLY valid JSON. "
                "No markdown fences."
            ),
            user=self._build_notes_prompt(
                subject_name=subject_name,
                chapter=chapter,
                chapter_title=chapter_title,
                topics=topics,
                objectives=objectives,
                summary=summary,
                syllabus_text=syllabus,
            ),
            schema_hint=(
                '{"chapter":1,"chapter_title":"","intro":"","lessons":['
                '{"lesson":1,"title":"","summary":"","learning_outcomes":[],'
                '"notes_markdown":"","key_terms":[],"examples":[],"practice_prompts":[]}]}'
            ),
            model_type=ChapterNotesContent,
        )
        notes.chapter = chapter
        notes.chapter_title = chapter_title
        return notes

    def _generate_chapter_practice(
        self,
        subject_name: str,
        chapter: ChapterOutline,
        syllabus: str,
    ) -> ChapterPracticeOutput:
        practice = self._chat_json(
            system=(
                "You are ASTRA's quiz/flashcard writer. Return ONLY valid JSON. "
                "No markdown fences."
            ),
            user=self._build_practice_prompt(subject_name, chapter, syllabus),
            schema_hint=(
                '{"flashcards":[{"question":"","answer":"","topic":"","difficulty":"MEDIUM"}],'
                '"quiz":[{"question":"","options":["a","b","c","d"],'
                '"correct_answer":"a","explanation":"","difficulty":"MEDIUM"}]}'
            ),
            model_type=ChapterPracticeOutput,
        )
        if len(practice.flashcards) < 8:
            raise ValueError(
                f"Chapter {chapter.chapter} returned only {len(practice.flashcards)} flashcards (need about 10)"
            )
        if len(practice.quiz) < 12:
            raise ValueError(
                f"Chapter {chapter.chapter} returned only {len(practice.quiz)} quiz questions (need about 15)"
            )
        practice.flashcards = practice.flashcards[:10]
        practice.quiz = practice.quiz[:15]
        return practice

    def _chat_json(self, *, system: str, user: str, schema_hint: str, model_type: type):
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    temperature=0.2,
                    response_format={"type": "json_object"},
                    messages=[
                        {"role": "system", "content": f"{system}\nJSON shape example: {schema_hint}"},
                        {"role": "user", "content": user},
                    ],
                )
                content = response.choices[0].message.content or "{}"
                return model_type.model_validate(json.loads(content))
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                if not self._is_transient(exc) or attempt >= 2:
                    raise
                time.sleep(1.5 * (attempt + 1))
        assert last_error is not None
        raise last_error

    @staticmethod
    def _is_transient(exc: Exception) -> bool:
        text = str(exc).lower()
        return any(marker in text for marker in TRANSIENT_MARKERS)

    @staticmethod
    def _resolve_syllabus_text(syllabus_text: str | None, syllabus_file_path: str | None) -> str:
        if (syllabus_text or "").strip():
            return (syllabus_text or "").strip()
        if not syllabus_file_path:
            raise ValueError("No syllabus text or file was provided for Groq generation")
        path = Path(syllabus_file_path)
        if not path.is_absolute():
            path = Path.cwd() / path
        if not path.exists():
            raise FileNotFoundError(f"Syllabus file not found at {path}")
        suffix = path.suffix.lower()
        if suffix in {".txt", ".md", ".csv", ".json"}:
            return path.read_text(encoding="utf-8", errors="ignore")
        raise ValueError(
            "Groq cannot read binary syllabus files (PDF/DOCX). "
            "Paste the syllabus as text on the subject, or upload a .txt/.md file."
        )

    @staticmethod
    def _build_outline_prompt(subject_name: str, syllabus: str) -> str:
        return f"""
Subject: {subject_name}

Read this syllabus and generate 3 to 12 ordered learning chapters that follow IT.
Match syllabus depth. Do not invent a generic course if the syllabus is specific.

Each chapter: chapter, title, summary, timeline, objectives, topics, activities.
Do NOT include flashcards or quiz in this step.
Return JSON with top-level "chapters" array.

Syllabus:
{syllabus[:20000]}
"""

    @staticmethod
    def _build_practice_prompt(subject_name: str, chapter: ChapterOutline, syllabus: str) -> str:
        topics = "\n".join(f"- {topic}" for topic in chapter.topics) or "- (use chapter title and summary)"
        objectives = "\n".join(f"- {item}" for item in chapter.objectives) or "- (use chapter summary)"
        return f"""
Subject: {subject_name}
Chapter {chapter.chapter}: {chapter.title}
Summary: {chapter.summary}
Timeline: {chapter.timeline}

Topics:
{topics}

Objectives:
{objectives}

Generate practice for THIS chapter only:
- exactly 10 flashcards (question, answer, topic, difficulty EASY|MEDIUM|HARD)
- exactly 15 MCQ quiz items (question, 4 options, correct_answer matching one option, explanation, difficulty)

Return JSON with flashcards and quiz arrays.

Syllabus excerpt:
{syllabus[:8000]}
"""

    @staticmethod
    def _build_notes_prompt(
        *,
        subject_name: str,
        chapter: int,
        chapter_title: str,
        topics: list[str],
        objectives: list[str],
        summary: str | None,
        syllabus_text: str,
    ) -> str:
        topic_list = "\n".join(f"- {topic}" for topic in topics) or "- (derive from title)"
        objective_list = "\n".join(f"- {item}" for item in objectives) or "- (derive from syllabus)"
        return f"""
Subject: {subject_name}
Chapter {chapter}: {chapter_title}
Summary: {summary or "N/A"}

Create complete self-study lesson notes for THIS chapter.
One lesson per topic (or 3-5 lessons if topics empty).

Topics:
{topic_list}

Objectives:
{objective_list}

Each lesson: lesson, title, summary, learning_outcomes, notes_markdown,
key_terms, examples, practice_prompts.
Return JSON with chapter, chapter_title, intro, lessons.

Syllabus:
{syllabus_text[:12000]}
"""
