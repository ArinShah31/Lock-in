from __future__ import annotations

import logging
import time
from pathlib import Path
from uuid import uuid4

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from app.ai.llm.client import get_client
from app.core.config import settings
from app.models.content import ClassroomContent
from app.services.source_text import build_source_text, extract_text_from_file

logger = logging.getLogger(__name__)


class ExtractedSection(BaseModel):
    id: str = Field(default_factory=lambda: f"section-{uuid4().hex[:8]}")
    title: str
    instructions: str = ""
    question_type: str = "MCQ"
    marks_per_question: float = 1
    question_count: int = 0
    required_count: int | None = None
    questions: list = Field(default_factory=list)


class ExtractedPattern(BaseModel):
    title: str = "Mock Exam"
    total_marks: int = 60
    duration_minutes: int = 60
    instructions: str = ""
    sections: list[ExtractedSection] = Field(default_factory=list)


class GeneratedQuestion(BaseModel):
    id: str = Field(default_factory=lambda: f"q-{uuid4().hex[:8]}")
    question_type: str = "MCQ"
    question: str
    marks: float = 1
    options: list[str] = Field(default_factory=list)
    correct_answer: str | None = None
    expected_answer: str | None = None
    section_title: str = ""


class GeneratedSection(BaseModel):
    id: str = Field(default_factory=lambda: f"section-{uuid4().hex[:8]}")
    title: str
    instructions: str = ""
    question_type: str = "MCQ"
    marks_per_question: float = 1
    question_count: int = 0
    required_count: int | None = None
    questions: list[GeneratedQuestion] = Field(default_factory=list)


class GeneratedPaper(BaseModel):
    instructions: str = ""
    sections: list[GeneratedSection] = Field(default_factory=list)


class GeminiQuotaError(RuntimeError):
    """Raised when Gemini returns a quota / rate-limit exhaustion error."""


def _file_part(path: str, mime_type: str):
    return types.Part.from_bytes(data=Path(path).read_bytes(), mime_type=mime_type)


def _api_keys() -> list[str]:
    keys: list[str] = []
    for key in [
        settings.gemini_api_key,
        *settings.gemini_keys_for_notes_pool(),
    ]:
        cleaned = (key or "").strip()
        if cleaned and cleaned not in keys:
            keys.append(cleaned)
    return keys


def _model_candidates() -> list[str]:
    models: list[str] = []
    # Prefer aliases/models known to work for this project; skip deprecated/exhausted ones last.
    for model in [
        settings.gemini_chat_model,
        settings.gemini_model,
        "gemini-3.6-flash",
        "gemini-flash-latest",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-2.0-flash",
        "gemini-2.5-flash",
        "gemini-3.5-flash",
    ]:
        cleaned = (model or "").strip()
        if cleaned and cleaned not in models:
            models.append(cleaned)
    return models


def _is_quota_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        token in text
        for token in (
            "429",
            "resource_exhausted",
            "quota",
            "rate limit",
            "rate-limit",
        )
    )


def _is_unavailable_model_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        token in text
        for token in (
            "not_found",
            "no longer available",
            "is not found",
            "not supported",
        )
    )


def _client_for_key(api_key: str | None = None):
    if not api_key:
        return get_client()
    return genai.Client(api_key=api_key)


def _generate_with_fallbacks(*, contents, response_schema, purpose: str):
    keys = _api_keys() or [None]
    models = _model_candidates()
    last_error: Exception | None = None
    quota_hit = False

    for api_key in keys:
        client = _client_for_key(api_key)
        for model in models:
            for attempt in range(2):
                try:
                    response = client.models.generate_content(
                        model=model,
                        contents=contents,
                        config={
                            "response_mime_type": "application/json",
                            "response_schema": response_schema,
                        },
                    )
                    logger.info("Gemini %s succeeded with model=%s", purpose, model)
                    return response
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    if _is_unavailable_model_error(exc):
                        logger.warning(
                            "Gemini model unavailable during %s (model=%s): %s",
                            purpose,
                            model,
                            exc,
                        )
                        break
                    if _is_quota_error(exc):
                        quota_hit = True
                        logger.warning(
                            "Gemini quota/rate limit during %s (model=%s, attempt=%s): %s",
                            purpose,
                            model,
                            attempt + 1,
                            exc,
                        )
                        if attempt == 0:
                            time.sleep(2)
                            continue
                        break
                    logger.warning(
                        "Gemini %s failed (model=%s): %s",
                        purpose,
                        model,
                        exc,
                    )
                    break

    if quota_hit and last_error is not None and _is_quota_error(last_error):
        raise GeminiQuotaError(
            "Gemini free-tier quota is exhausted for the tried models/keys. "
            "Wait for reset, set GEMINI_CHAT_MODEL=gemini-3.6-flash (or gemini-flash-latest), "
            "or add another Gemini API key."
        ) from last_error
    raise RuntimeError(f"Gemini {purpose} failed: {last_error}") from last_error


def _default_pattern(fallback_title: str, *, note: str = "") -> dict:
    instructions = note or "Edit this blueprint to match your paper pattern, then generate."
    pattern = ExtractedPattern(
        title=fallback_title or "Mock Exam",
        total_marks=60,
        duration_minutes=60,
        instructions=instructions,
        sections=[
            ExtractedSection(
                title="Section A · MCQ",
                instructions="Choose the correct option.",
                question_type="MCQ",
                marks_per_question=1,
                question_count=20,
            ),
            ExtractedSection(
                title="Section B · Short answers",
                instructions="Answer briefly.",
                question_type="SHORT",
                marks_per_question=5,
                question_count=4,
            ),
            ExtractedSection(
                title="Section C · Theory",
                instructions="Write detailed answers.",
                question_type="THEORY",
                marks_per_question=10,
                question_count=2,
            ),
        ],
    )
    return pattern.model_dump()


def extract_mock_exam_pattern(*, file_path: str, mime_type: str, fallback_title: str) -> dict:
    prompt = (
        "Extract only the exam paper pattern from this previous-year paper. "
        "Do not copy the question content. Return JSON with title, total_marks, "
        "duration_minutes, instructions, and sections. Each section must include "
        "title, instructions, question_type (MCQ/SHORT/THEORY/MIXED), "
        "marks_per_question, question_count, and required_count if choices exist. "
        f"Use {fallback_title!r} as fallback title."
    )

    extracted_text = ""
    if mime_type == "application/pdf" or Path(file_path).suffix.lower() == ".pdf":
        extracted_text = extract_text_from_file(file_path, fallback_title=fallback_title)

    attempts: list[tuple[str, object]] = []
    if extracted_text and len(extracted_text.strip()) > 80:
        attempts.append(
            (
                "mock exam pattern extraction (text)",
                f"{prompt}\n\nExtracted PYQ text (structure only):\n{extracted_text[:18000]}",
            )
        )
    attempts.append(
        (
            "mock exam pattern extraction (file)",
            [prompt, _file_part(file_path, mime_type)],
        )
    )

    last_error: Exception | None = None
    for purpose, contents in attempts:
        try:
            response = _generate_with_fallbacks(
                contents=contents,
                response_schema=ExtractedPattern,
                purpose=purpose,
            )
            pattern = response.parsed or ExtractedPattern(title=fallback_title)
            return pattern.model_dump()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            logger.warning("Pattern extraction attempt failed (%s): %s", purpose, exc)

    if isinstance(last_error, GeminiQuotaError):
        logger.warning("Returning editable default pattern after Gemini quota failure")
        return _default_pattern(
            fallback_title,
            note=(
                "Gemini quota was exhausted, so this is an editable default blueprint. "
                "Adjust sections/marks to match the PYQ, then generate."
            ),
        )
    if last_error is not None:
        raise last_error
    return _default_pattern(fallback_title)


def generate_mock_exam_paper(
    *,
    classroom_name: str,
    pattern: dict,
    syllabus_text: str | None,
    syllabus_path: str | None,
    syllabus_name: str | None,
    documents: list[ClassroomContent],
) -> dict:
    source_text = build_source_text(
        syllabus_text=syllabus_text,
        syllabus_path=syllabus_path,
        syllabus_name=syllabus_name,
        documents=documents,
    )
    response = _generate_with_fallbacks(
        contents=(
            "You are ASTRA's mock exam paper generator. Generate fresh questions only from "
            "the supplied classroom source material. Copy the structure and marks pattern, "
            "but do not copy questions from any previous-year paper. For MCQs include exactly "
            "4 options and correct_answer. For theory/short answers include expected_answer. "
            "Return JSON with instructions and sections, each section containing questions.\n\n"
            f"Classroom: {classroom_name}\n\n"
            f"Reviewed pattern JSON:\n{pattern}\n\n"
            f"Classroom source material:\n{source_text[:22000]}"
        ),
        response_schema=GeneratedPaper,
        purpose="mock exam paper generation",
    )
    paper = response.parsed or GeneratedPaper()
    return paper.model_dump()
