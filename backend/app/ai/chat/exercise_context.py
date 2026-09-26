"""Detect exercise-solving requests and load full document context."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.content import ClassroomContent
from app.services.source_text import extract_full_text_from_file

_EXERCISE_QUESTION_RE = re.compile(
    r"\b("
    r"exercise|exercises|practice\s+problem|practice\s+problems|"
    r"worksheet|homework|assignment\s+question|solve|"
    r"answer\s+all|answer\s+the\s+questions|work\s+out|"
    r"complete\s+the\s+questions|problem\s+set"
    r")\b",
    re.IGNORECASE,
)
_LATEST_DOC_RE = re.compile(
    r"\b(latest|most\s+recent|last\s+uploaded|newest|recent)\b",
    re.IGNORECASE,
)

_EXERCISE_SECTION_MARKERS = (
    "exercises",
    "exercise",
    "practice problems",
    "practice questions",
    "review questions",
    "questions",
    "problems",
    "worksheet",
)


def question_requests_exercise_help(question: str) -> bool:
    return bool(_EXERCISE_QUESTION_RE.search(question or ""))


def _focus_exercise_text(full_text: str, *, max_chars: int = 16_000) -> str:
    text = (full_text or "").strip()
    if not text:
        return ""
    lower = text.lower()
    for marker in _EXERCISE_SECTION_MARKERS:
        idx = lower.find(marker)
        if idx >= 0:
            start = max(0, idx - 1_500)
            section = text[start : start + max_chars]
            if marker.lower() not in section.lower():
                section = text[idx : idx + max_chars]
            return section.strip()
    return text[:max_chars].strip()


def _pick_documents(
    documents: list[ClassroomContent],
    question: str,
) -> list[ClassroomContent]:
    if not documents:
        return []
    if _LATEST_DOC_RE.search(question or ""):
        return [documents[0]]
    return documents[-1:] if len(documents) == 1 else [documents[-1], documents[0]]


def collect_exercise_context(
    db: Session,
    classroom_id: int,
    question: str,
) -> list[str]:
    """Load full text from the target document, focused on exercise sections."""
    documents = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom_id,
            ClassroomContent.is_active.is_(True),
        )
        .order_by(ClassroomContent.created_at.desc())
        .all()
    )
    if not documents:
        return []

    parts: list[str] = []
    for doc in _pick_documents(documents, question):
        label = doc.title or doc.file_name or "Document"
        full_text = extract_full_text_from_file(
            doc.file_path,
            fallback_title=doc.description or doc.title or "",
        )
        focused = _focus_exercise_text(full_text)
        if focused:
            parts.append(f"[{label} — full document context]\n{focused}")

    return parts
