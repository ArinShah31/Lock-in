"""Bloom taxonomy helpers for LMS quiz and scenario questions."""

from __future__ import annotations

import re
from enum import Enum


class BloomLevel(str, Enum):
    REMEMBER = "REMEMBER"
    UNDERSTAND = "UNDERSTAND"
    APPLY = "APPLY"
    ANALYZE = "ANALYZE"
    EVALUATE = "EVALUATE"
    CREATE = "CREATE"


BLOOM_LABELS: dict[BloomLevel, str] = {
    BloomLevel.REMEMBER: "Remember",
    BloomLevel.UNDERSTAND: "Understand",
    BloomLevel.APPLY: "Apply",
    BloomLevel.ANALYZE: "Analyze",
    BloomLevel.EVALUATE: "Evaluate",
    BloomLevel.CREATE: "Create",
}

BLOOM_DIFFICULTY: dict[BloomLevel, str] = {
    BloomLevel.REMEMBER: "easier",
    BloomLevel.UNDERSTAND: "easier",
    BloomLevel.APPLY: "medium",
    BloomLevel.ANALYZE: "medium",
    BloomLevel.EVALUATE: "harder",
    BloomLevel.CREATE: "harder",
}

_VALID_LEVELS = {level.value for level in BloomLevel}

_REMEMBER_PATTERNS = re.compile(
    r"\b(define|list|name|identify|recall|state|label|match|what is|which of the following is)\b",
    re.IGNORECASE,
)
_UNDERSTAND_PATTERNS = re.compile(
    r"\b(explain|describe|summarize|interpret|paraphrase|clarify|discuss|outline)\b",
    re.IGNORECASE,
)
_APPLY_PATTERNS = re.compile(
    r"\b(apply|use|calculate|solve|implement|demonstrate|compute|execute|perform)\b",
    re.IGNORECASE,
)
_ANALYZE_PATTERNS = re.compile(
    r"\b(analyze|analyse|compare|contrast|differentiate|debug|examine|investigate|categorize|categorise)\b",
    re.IGNORECASE,
)
_EVALUATE_PATTERNS = re.compile(
    r"\b(evaluate|justify|assess|critique|recommend|defend|argue|prioritize|prioritise)\b",
    re.IGNORECASE,
)
_CREATE_PATTERNS = re.compile(
    r"\b(create|design|develop|propose|formulate|construct|plan|invent|compose)\b",
    re.IGNORECASE,
)


def normalize_bloom_level(value: object | None) -> BloomLevel | None:
    if value is None:
        return None
    text = str(value).strip().upper()
    if text in _VALID_LEVELS:
        return BloomLevel(text)
    return None


def infer_bloom_level(question: str) -> BloomLevel:
    text = (question or "").strip()
    if not text:
        return BloomLevel.APPLY
    if _CREATE_PATTERNS.search(text):
        return BloomLevel.CREATE
    if _EVALUATE_PATTERNS.search(text):
        return BloomLevel.EVALUATE
    if _ANALYZE_PATTERNS.search(text):
        return BloomLevel.ANALYZE
    if _APPLY_PATTERNS.search(text):
        return BloomLevel.APPLY
    if _UNDERSTAND_PATTERNS.search(text):
        return BloomLevel.UNDERSTAND
    if _REMEMBER_PATTERNS.search(text):
        return BloomLevel.REMEMBER
    return BloomLevel.APPLY


def resolve_bloom_level(question: str, stored: object | None = None) -> BloomLevel:
    normalized = normalize_bloom_level(stored)
    if normalized is not None:
        return normalized
    return infer_bloom_level(question)


def bloom_label(level: BloomLevel | str | None) -> str:
    if level is None:
        return BLOOM_LABELS[BloomLevel.APPLY]
    if isinstance(level, BloomLevel):
        return BLOOM_LABELS[level]
    normalized = normalize_bloom_level(level)
    return BLOOM_LABELS[normalized or BloomLevel.APPLY]


def bloom_difficulty(level: BloomLevel | str | None) -> str:
    if level is None:
        return BLOOM_DIFFICULTY[BloomLevel.APPLY]
    if isinstance(level, BloomLevel):
        return BLOOM_DIFFICULTY[level]
    normalized = normalize_bloom_level(level)
    return BLOOM_DIFFICULTY[normalized or BloomLevel.APPLY]
