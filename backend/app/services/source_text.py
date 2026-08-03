from pathlib import Path

from app.models.content import ClassroomContent


def extract_text_from_file(path: str | None, *, fallback_title: str = "") -> str:
    if not path:
        return fallback_title
    file_path = Path(path)
    if not file_path.exists():
        return fallback_title
    suffix = file_path.suffix.lower()
    try:
        if suffix in {".txt", ".md", ".csv"}:
            return file_path.read_text(encoding="utf-8", errors="ignore")
        if suffix == ".pdf":
            try:
                from pypdf import PdfReader

                reader = PdfReader(str(file_path))
                parts = []
                for page in reader.pages[:30]:
                    parts.append(page.extract_text() or "")
                text = "\n".join(parts).strip()
                return text or fallback_title
            except Exception:  # noqa: BLE001
                return fallback_title or f"[PDF] {file_path.name}"
    except Exception:  # noqa: BLE001
        return fallback_title
    return fallback_title or f"[{suffix}] {file_path.name}"


def build_source_text(
    *,
    syllabus_text: str | None,
    syllabus_path: str | None,
    syllabus_name: str | None,
    documents: list[ClassroomContent],
) -> str:
    chunks: list[str] = []
    if syllabus_text and syllabus_text.strip():
        chunks.append(f"## Syllabus text\n{syllabus_text.strip()}")
    elif syllabus_path:
        extracted = extract_text_from_file(syllabus_path, fallback_title=syllabus_name or "Syllabus")
        chunks.append(f"## Syllabus file ({syllabus_name or 'upload'})\n{extracted}")

    for doc in documents:
        header = f"## Document: {doc.title} ({doc.file_name})"
        body = extract_text_from_file(doc.file_path, fallback_title=doc.description or doc.title)
        chunks.append(f"{header}\n{body}")

    if not chunks:
        return "No syllabus or documents provided. Create a general foundational course outline."
    return "\n\n".join(chunks)
