from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from app.ai.guardrails.policies import STUDENT_REFUSAL
from app.ai.guardrails.terms import PHRASE_CATEGORIES, WORD_CATEGORIES

_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b\u200c\u200d\ufeff\u2060"), None)
_LEET = str.maketrans(
    {
        "0": "o",
        "1": "i",
        "3": "e",
        "4": "a",
        "5": "s",
        "@": "a",
        "$": "s",
        "!": "i",
    }
)
_OBFUSCATION = re.compile(r"(?<=[a-z])[*\-_.]+(?=[a-z])")
_NON_ALNUM = re.compile(r"[^a-z0-9\s]+")
_WHITESPACE = re.compile(r"\s+")
_TOKEN = re.compile(r"[a-z0-9]+")


@dataclass(frozen=True, slots=True)
class GuardrailResult:
    blocked: bool
    category: str | None = None


def normalize_question(text: str) -> str:
    folded = unicodedata.normalize("NFKC", text or "")
    folded = folded.translate(_ZERO_WIDTH).lower().translate(_LEET)
    folded = _OBFUSCATION.sub("", folded)
    folded = _NON_ALNUM.sub(" ", folded)
    return _WHITESPACE.sub(" ", folded).strip()


def _match_phrases(normalized: str, categories: tuple[str, ...]) -> GuardrailResult | None:
    for category in categories:
        for phrase in PHRASE_CATEGORIES.get(category, ()):
            if re.search(rf"\b{re.escape(phrase)}\b", normalized):
                return GuardrailResult(blocked=True, category=category)
    return None


def check_student_question(question: str) -> GuardrailResult:
    normalized = normalize_question(question)
    if not normalized:
        return GuardrailResult(blocked=False)

    tokens = set(_TOKEN.findall(normalized))
    for category, words in WORD_CATEGORIES.items():
        if tokens & words:
            return GuardrailResult(blocked=True, category=category)

    matched = _match_phrases(
        normalized,
        ("self_harm", "violence", "drugs", "jailbreak"),
    )
    if matched:
        return matched

    return GuardrailResult(blocked=False)


def check_injection_request(question: str) -> GuardrailResult:
    normalized = normalize_question(question)
    if not normalized:
        return GuardrailResult(blocked=False)
    matched = _match_phrases(normalized, ("injection", "jailbreak"))
    if matched:
        return matched
    return GuardrailResult(blocked=False)


__all__ = [
    "STUDENT_REFUSAL",
    "GuardrailResult",
    "check_student_question",
    "check_injection_request",
    "normalize_question",
]
