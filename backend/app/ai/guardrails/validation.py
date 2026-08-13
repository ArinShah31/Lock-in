from __future__ import annotations

import re

MAX_QUESTION_LENGTH = 4000

_OUTPUT_LEAK_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    re.compile(pattern, re.IGNORECASE)
    for pattern in (
        r"system prompt",
        r"api[_\s-]?key",
        r"gemini[_\s-]?api",
        r"jwt[_\s-]?secret",
        r"BEGIN (RSA |OPENSSH )?PRIVATE KEY",
        r"ignore previous instructions",
    )
)


def validate_question_length(question: str) -> str | None:
    text = (question or "").strip()
    if not text:
        return "Question cannot be empty."
    if len(text) > MAX_QUESTION_LENGTH:
        return f"Question is too long (max {MAX_QUESTION_LENGTH} characters)."
    return None


def scan_output_for_leaks(text: str) -> bool:
    if not text:
        return False
    return any(pattern.search(text) for pattern in _OUTPUT_LEAK_PATTERNS)
