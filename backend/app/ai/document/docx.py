from docx import Document


def extract_text(file_path: str) -> tuple[str, int]:
    document = Document(file_path)

    text = "\n".join(
        paragraph.text
        for paragraph in document.paragraphs
        if paragraph.text.strip()
    )

    pages = 1

    return text, pages