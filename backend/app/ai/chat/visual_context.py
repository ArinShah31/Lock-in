"""Collect classroom document images for diagram/table questions."""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy.orm import Session

from app.ai.document.visual_pages import compress_image_bytes, render_pdf_visual_pages
from app.models.content import ClassroomContent, ContentType

_VISUAL_QUESTION_RE = re.compile(
    r"\b("
    r"diagram|diagrams|table|tables|chart|charts|figure|figures|"
    r"graph|graphs|flowchart|flowcharts|illustration|illustrations|"
    r"image|images|picture|pictures|plot|plots|visual|visuals|"
    r"infographic|drawing|drawings|schematic|screenshot|screenshots"
    r")\b",
    re.IGNORECASE,
)
_LATEST_DOC_RE = re.compile(
    r"\b(latest|most\s+recent|last\s+uploaded|newest|recent)\b",
    re.IGNORECASE,
)

MAX_DOCS = 1
_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def question_requests_visuals(question: str) -> bool:
    return bool(_VISUAL_QUESTION_RE.search(question or ""))


def _is_pdf(doc: ClassroomContent) -> bool:
    suffix = Path(doc.file_path or doc.file_name or "").suffix.lower()
    return doc.content_type == ContentType.PDF or suffix == ".pdf"


def _is_image(doc: ClassroomContent) -> bool:
    suffix = Path(doc.file_path or doc.file_name or "").suffix.lower()
    return doc.content_type == ContentType.IMAGE or suffix in _IMAGE_SUFFIXES


def _image_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".webp":
        return "image/webp"
    if suffix == ".gif":
        return "image/gif"
    return "image/png"


def _load_image_file(file_path: str) -> tuple[bytes, str] | None:
    path = Path(file_path)
    if not path.is_file():
        return None
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if len(data) < 80:
        return None
    return data, _image_mime(path)


def _rank_documents(documents: list[ClassroomContent], question: str) -> list[ClassroomContent]:
    tokens = {t for t in re.findall(r"[a-z0-9]{3,}", (question or "").lower())}
    if not tokens:
        return documents

    def score(doc: ClassroomContent) -> int:
        haystack = " ".join(
            part
            for part in (
                doc.title or "",
                doc.file_name or "",
                doc.description or "",
            )
            if part
        ).lower()
        hay_tokens = set(re.findall(r"[a-z0-9]{3,}", haystack))
        return len(tokens & hay_tokens)

    return sorted(documents, key=score, reverse=True)


def collect_visual_pages(
    db: Session,
    classroom_id: int,
    question: str,
) -> list[tuple[str, bytes, str]]:
    """Return (label, image_bytes, mime_type) tuples for vision analysis."""
    documents = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id == classroom_id,
            ClassroomContent.is_active.is_(True),
        )
        .order_by(ClassroomContent.created_at.desc())
        .all()
    )

    visual_docs = [doc for doc in documents if _is_pdf(doc) or _is_image(doc)]
    if not visual_docs:
        return []

    if _LATEST_DOC_RE.search(question or ""):
        visual_docs = visual_docs[:1]
    else:
        visual_docs = _rank_documents(visual_docs, question)[:MAX_DOCS]

    collected: list[tuple[str, bytes, str]] = []
    for doc in visual_docs:
        label_base = doc.title or doc.file_name or "Document"
        if _is_image(doc):
            loaded = _load_image_file(doc.file_path)
            if loaded:
                data, mime = loaded
                compressed, out_mime = compress_image_bytes(data, mime_type=mime)
                collected.append((label_base, compressed, out_mime))
        elif _is_pdf(doc):
            for page_num, image_bytes, mime in render_pdf_visual_pages(doc.file_path):
                collected.append((f"{label_base} — page {page_num}", image_bytes, mime))

    return collected
