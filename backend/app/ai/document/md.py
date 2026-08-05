def extract_text(file_path: str) -> tuple[str, int]:
    with open(file_path, "r", encoding="utf-8") as file:
        text = file.read()

    return text, 1