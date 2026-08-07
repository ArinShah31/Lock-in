try:
    from docx import Document
except ImportError:
    Document = None


def extract_text(file_path: str) -> tuple[str, int]:
    if Document is None:
        raise ValueError("python-docx is not installed.")
    document = Document(file_path)

    text = "\n".join(
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    )

    pages = 1

    return text, pages