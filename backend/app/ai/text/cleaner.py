import re


def clean_text(text: str) -> str:
    """
    Normalize extracted document text.
    """

    # Normalize line endings
    text = text.replace("\r\n", "\n")

    # Replace multiple spaces/tabs with a single space
    text = re.sub(r"[ \t]+", " ", text)

    # Replace 3 or more newlines with 2
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Remove leading/trailing whitespace
    text = text.strip()

    return text