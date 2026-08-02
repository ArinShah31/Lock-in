import json
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError
from pathlib import Path

from google.genai import types

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

GEMINI_CALL_TIMEOUT_SECONDS = 120
COURSE_JOB_TIMEOUT_SECONDS = 900
PRACTICE_CONCURRENCY = 3
TRANSIENT_MARKERS = ("429", "RESOURCE_EXHAUSTED", "503", "UNAVAILABLE", "high demand", "rate")


class _KeyPool:
    def __init__(self, keys: list[str]):
        if not keys:
            raise ValueError("At least one Gemini API key is required")
        self._keys = keys
        self._index = 0
        self._lock = threading.Lock()

    def next_key(self) -> str:
        with self._lock:
            key = self._keys[self._index % len(self._keys)]
            self._index += 1
            return key

    def all_keys(self) -> list[str]:
        return list(self._keys)


class GeminiCourseBuilderProvider(CourseBuilderProvider):
    def __init__(self, api_keys: list[str], model: str):
        self.key_pool = _KeyPool(api_keys)
        self.model = model

    def generate_course(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        requested_artifacts: list[ArtifactType],
        on_progress: ProgressCallback | None = None,
    ) -> CourseBuilderOutput:
        return self._run_with_timeout(
            COURSE_JOB_TIMEOUT_SECONDS,
            lambda: self._generate_course_multistep(
                subject_name=subject_name,
                syllabus_text=syllabus_text,
                syllabus_file_path=syllabus_file_path,
                on_progress=on_progress,
            ),
            "Course generation timed out. Try again — large syllabi can take several minutes.",
        )

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
            on_progress(f"Writing notes for chapter {chapter}…")
        prompt = self._build_notes_prompt(
            subject_name=subject_name,
            chapter=chapter,
            chapter_title=chapter_title,
            topics=topics,
            objectives=objectives,
            summary=summary,
            syllabus_text=syllabus_text,
        )

        def _call(client):
            contents = self._build_contents(client, prompt, syllabus_text, syllabus_file_path)
            return self._generate_json(
                client,
                contents,
                ChapterNotesContent,
                timeout_seconds=GEMINI_CALL_TIMEOUT_SECONDS,
            )

        response = self._with_key_retries(_call)
        if getattr(response, "parsed", None):
            return response.parsed
        return ChapterNotesContent.model_validate(json.loads(response.text))

    def _generate_course_multistep(
        self,
        *,
        subject_name: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
        on_progress: ProgressCallback | None,
    ) -> CourseBuilderOutput:
        if on_progress:
            on_progress("Building chapter outline…")

        def _outline_call(client):
            outline_prompt = self._build_outline_prompt(subject_name, syllabus_text)
            outline_contents = self._build_contents(client, outline_prompt, syllabus_text, syllabus_file_path)
            return self._generate_json(
                client,
                outline_contents,
                CourseOutlineOutput,
                timeout_seconds=GEMINI_CALL_TIMEOUT_SECONDS,
            )

        outline_response = self._with_key_retries(_outline_call)
        outline = (
            outline_response.parsed
            if getattr(outline_response, "parsed", None)
            else CourseOutlineOutput.model_validate(json.loads(outline_response.text))
        )
        ordered = sorted(outline.chapters, key=lambda item: item.chapter)
        if not ordered:
            raise ValueError("AI returned no chapters in the outline step")

        total = len(ordered)
        if on_progress:
            on_progress(f"Outline ready ({total} chapters). Generating practice packs in parallel…")

        completed = 0
        progress_lock = threading.Lock()
        assembled: dict[int, ChapterContent] = {}

        def _practice_one(chapter: ChapterOutline) -> ChapterContent:
            nonlocal completed
            practice = self._generate_chapter_practice(
                subject_name=subject_name,
                chapter=chapter,
                syllabus_text=syllabus_text,
                syllabus_file_path=syllabus_file_path,
            )
            with progress_lock:
                completed += 1
                if on_progress:
                    on_progress(
                        f"Generating practice {completed}/{total}: chapter {chapter.chapter} — {chapter.title}"
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

    def _generate_chapter_practice(
        self,
        *,
        subject_name: str,
        chapter: ChapterOutline,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
    ) -> ChapterPracticeOutput:
        prompt = self._build_practice_prompt(subject_name, chapter)

        def _call(client):
            contents: list[object] = [prompt]
            if (syllabus_text or "").strip():
                contents.append(f"Syllabus excerpt for grounding:\n{(syllabus_text or '')[:8000]}")
            elif syllabus_file_path:
                contents = self._build_contents(client, prompt, syllabus_text, syllabus_file_path)
            return self._generate_json(
                client,
                contents,
                ChapterPracticeOutput,
                timeout_seconds=GEMINI_CALL_TIMEOUT_SECONDS,
            )

        response = self._with_key_retries(_call)
        practice = (
            response.parsed
            if getattr(response, "parsed", None)
            else ChapterPracticeOutput.model_validate(json.loads(response.text))
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

    def _with_key_retries(self, call: Callable):
        from google import genai

        keys = self.key_pool.all_keys()
        last_error: Exception | None = None
        # Walk the whole pool at least once; extra attempt if only one key.
        attempts = max(len(keys), 2)
        for attempt in range(attempts):
            api_key = self.key_pool.next_key()
            client = genai.Client(api_key=api_key)
            try:
                return call(client)
            except Exception as exc:  # noqa: BLE001
                root = self._root_error(exc)
                last_error = root
                if not self._is_transient(root) or attempt >= attempts - 1:
                    break
                if self._is_daily_quota(root):
                    continue
                time.sleep(self._retry_delay_seconds(root, attempt))

        assert last_error is not None
        if self._is_daily_quota(last_error):
            raise RuntimeError(
                f"All {len(keys)} Gemini API key(s) hit today's free-tier quota "
                f"for model '{self.model}' (20 requests/day/project). "
                "Add a key from another Google account/project, wait for daily reset, "
                "or enable billing. See https://ai.google.dev/gemini-api/docs/rate-limits"
            ) from last_error
        raise last_error

    @staticmethod
    def _root_error(exc: BaseException) -> Exception:
        current: BaseException = exc
        while current.__cause__ is not None:
            current = current.__cause__
        return current if isinstance(current, Exception) else Exception(str(current))

    @staticmethod
    def _is_daily_quota(exc: Exception) -> bool:
        text = str(exc).lower()
        return (
            "perday" in text.replace("_", "").replace("-", "")
            or "generate_content_free_tier_requests" in text
            or "requestsperday" in text.replace("_", "").replace("-", "")
        )

    @staticmethod
    def _retry_delay_seconds(exc: Exception, attempt: int) -> float:
        import re

        text = str(exc)
        # Don't honor long RetryInfo delays when it's a daily-quota style message.
        if GeminiCourseBuilderProvider._is_daily_quota(exc):
            return 0.5
        match = re.search(r"retry in ([\d.]+)\s*s", text, flags=re.IGNORECASE)
        if match:
            return min(20.0, float(match.group(1)) + 1.0)
        return 1.5 * (attempt + 1)

    @staticmethod
    def _is_transient(exc: Exception) -> bool:
        text = str(exc)
        return any(marker.lower() in text.lower() for marker in TRANSIENT_MARKERS)

    def _generate_json(self, client, contents: list[object], schema: type, *, timeout_seconds: int):
        # Use the HTTP client timeout only — nested thread pools broke key rotation
        # when 429s were raised from worker threads in some runs.
        return client.models.generate_content(
            model=self.model,
            contents=contents,
            config={
                "response_mime_type": "application/json",
                "response_schema": schema,
                "http_options": types.HttpOptions(timeout=timeout_seconds * 1000),
            },
        )

    @staticmethod
    def _run_with_timeout(timeout_seconds: int, fn, timeout_message: str):
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(fn)
            try:
                return future.result(timeout=timeout_seconds)
            except FuturesTimeoutError as exc:
                raise TimeoutError(timeout_message) from exc

    def _build_contents(
        self,
        client,
        prompt: str,
        syllabus_text: str | None,
        syllabus_file_path: str | None,
    ) -> list[object]:
        contents: list[object] = [prompt]
        if syllabus_file_path:
            path = Path(syllabus_file_path)
            if not path.is_absolute():
                path = Path.cwd() / path
            if not path.exists():
                raise FileNotFoundError(f"Syllabus file not found at {path}")
            contents.append(client.files.upload(file=str(path)))
        elif not (syllabus_text or "").strip():
            raise ValueError("No syllabus text or file was provided for Gemini generation")
        return contents

    @staticmethod
    def _build_outline_prompt(subject_name: str, syllabus_text: str | None) -> str:
        return f"""
You are ASTRA's AI course builder for college teachers.

Subject: {subject_name}

Read the attached syllabus carefully (or the syllabus text below) and generate 3 to 15 ordered learning chapters
that follow THAT syllabus — match the syllabus depth (more units => more chapters, up to 15).
Do not invent a generic course if the syllabus is more specific.

Each chapter must include only:
- chapter number, title, summary, timeline
- objectives, topics, activities grounded in the syllabus

Do NOT include flashcards, quiz, or assessment in this step.
Return only JSON matching the schema with a top-level "chapters" array.

Syllabus text:
{syllabus_text or "Primary source is the attached syllabus file. Extract chapters from that document."}
"""

    @staticmethod
    def _build_practice_prompt(subject_name: str, chapter: ChapterOutline) -> str:
        topics = "\n".join(f"- {topic}" for topic in chapter.topics) or "- (use chapter title and summary)"
        objectives = "\n".join(f"- {item}" for item in chapter.objectives) or "- (use chapter summary)"
        return f"""
You are ASTRA's AI quiz/flashcard writer for college students.

Subject: {subject_name}
Chapter {chapter.chapter}: {chapter.title}
Summary: {chapter.summary}
Timeline: {chapter.timeline}

Topics:
{topics}

Objectives:
{objectives}

Generate practice material for THIS chapter only:
- about 10 flashcards (target exactly 10; minimum 8) with question, answer, topic, difficulty
- about 15 MCQ quiz questions (target exactly 15; minimum 12) with 4 options each, correct_answer, explanation, difficulty

Cover the chapter thoroughly so a student can revise the whole chapter from these items alone.
Flashcards = recall. Quiz = application and common mistakes.
Do not include assessments.
Return JSON matching the schema with flashcards and quiz arrays.
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
        syllabus_text: str | None,
    ) -> str:
        topic_list = "\n".join(f"- {topic}" for topic in topics) or "- (derive lessons from chapter title and syllabus)"
        objective_list = "\n".join(f"- {item}" for item in objectives) or "- (derive from syllabus)"
        return f"""
You are ASTRA's AI teaching-notes writer for college students.

Subject: {subject_name}
Chapter {chapter}: {chapter_title}
Chapter summary: {summary or "N/A"}

Create complete self-study lesson notes for THIS chapter only.
Use one lesson per topic below (or invent 3-5 coherent lessons if topics are empty), aligned to the syllabus.

Topics / lessons to cover:
{topic_list}

Chapter objectives:
{objective_list}

For each lesson include:
- lesson number, title, short summary
- learning_outcomes
- notes_markdown: thorough classroom-quality notes (definitions, explanations, steps, common mistakes, mini examples) so a student can learn without the teacher present
- key_terms, examples, practice_prompts

Write notes_markdown in Markdown with clear headings. Be practical and syllabus-faithful.
Return JSON matching the schema with chapter, chapter_title, intro, and lessons.

Syllabus text:
{syllabus_text or "Primary source is the attached syllabus file. Ground every lesson in that document."}
"""
