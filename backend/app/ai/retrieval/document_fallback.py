"""File-based retrieval when Qdrant is offline or empty."""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models.classroom_course import ClassroomCourse
from app.models.content import ClassroomContent
from app.services.source_text import extract_text_from_file


def _tokenize(text: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", (text or "").lower())}


def _score(query_tokens: set[str], chunk: str) -> int:
    if not query_tokens:
        return 0
    chunk_tokens = _tokenize(chunk)
    return len(query_tokens & chunk_tokens)


def _split_chunks(text: str, *, chunk_size: int = 900, overlap: int = 120) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(0, end - overlap)
    return chunks


def fallback_context_chunks(
    db: Session,
    classroom_id: int,
    question: str,
    *,
    limit: int = 6,
) -> list[str]:
    """Rank local document/syllabus text chunks by simple token overlap."""
    scored: list[tuple[int, str]] = []
    query_tokens = _tokenize(question)

    course = (
        db.query(ClassroomCourse)
        .filter(ClassroomCourse.classroom_id == classroom_id)
        .first()
    )
    if course is not None:
        syllabus_parts: list[str] = []
        if course.syllabus_text and course.syllabus_text.strip():
            syllabus_parts.append(course.syllabus_text.strip())
        elif course.syllabus_file_path:
            syllabus_parts.append(
                extract_text_from_file(
                    course.syllabus_file_path,
                    fallback_title=course.syllabus_file_name or "Syllabus",
                )
            )
        for block in syllabus_parts:
            for chunk in _split_chunks(block):
                scored.append((_score(query_tokens, chunk), f"[Syllabus]\n{chunk}"))

    documents = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom_id,
            ClassroomContent.is_active.is_(True),
        )
        .order_by(ClassroomContent.created_at.asc())
        .all()
    )

    for doc in documents:
        body = extract_text_from_file(
            doc.file_path,
            fallback_title=doc.description or doc.title or "",
        )
        label = doc.title or doc.file_name or "Document"
        for chunk in _split_chunks(body):
            scored.append((_score(query_tokens, chunk), f"[{label}]\n{chunk}"))

    if not scored:
        return []

    scored.sort(key=lambda item: item[0], reverse=True)
    matched = [text for score, text in scored if score > 0]
    return matched[:limit]
