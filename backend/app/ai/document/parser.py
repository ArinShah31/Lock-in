from pathlib import Path

from app.ai.document.docx import extract_text as extract_docx
from app.ai.document.md import extract_text as extract_md
from app.ai.document.pdf import extract_text as extract_pdf
from app.ai.document.pptx import extract_text as extract_pptx
from app.ai.document.txt import extract_text as extract_txt

PARSERS = {
    ".pdf": extract_pdf,
    ".docx": extract_docx,
    ".pptx": extract_pptx,
    ".txt": extract_txt,
    ".md": extract_md,
}


def extract_text(file_path: str) -> tuple[str, int]:
    extension = Path(file_path).suffix.lower()

    parser = PARSERS.get(extension)

    if parser is None:
        raise ValueError(f"Unsupported file type: {extension}")

    return parser(file_path)