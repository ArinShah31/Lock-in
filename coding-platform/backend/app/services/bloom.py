"""Bloom taxonomy helpers and default rubrics for coding questions."""

from __future__ import annotations

from app.models import BloomLevel, Difficulty, Question

DIFFICULTY_TO_BLOOM = {
    Difficulty.EASY: BloomLevel.APPLY,
    Difficulty.MEDIUM: BloomLevel.ANALYZE,
    Difficulty.HARD: BloomLevel.CREATE,
}

BLOOM_TO_DIFFICULTY = {
    BloomLevel.REMEMBER: Difficulty.EASY,
    BloomLevel.UNDERSTAND: Difficulty.EASY,
    BloomLevel.APPLY: Difficulty.MEDIUM,
    BloomLevel.ANALYZE: Difficulty.MEDIUM,
    BloomLevel.EVALUATE: Difficulty.HARD,
    BloomLevel.CREATE: Difficulty.HARD,
}

DEFAULT_RUBRIC: list[dict] = [
    {
        "name": "Correctness",
        "description": "The solution solves the stated problem with working logic.",
        "weight": 55,
        "max_points": 100,
    },
    {
        "name": "Efficiency",
        "description": "The approach has reasonable time and space complexity.",
        "weight": 15,
        "max_points": 100,
    },
    {
        "name": "Style",
        "description": "Code is readable, structured, and follows language conventions.",
        "weight": 15,
        "max_points": 100,
    },
    {
        "name": "Edge cases",
        "description": "Handles empty input, bounds, and other edge cases.",
        "weight": 15,
        "max_points": 100,
    },
]


def bloom_from_difficulty(difficulty: Difficulty | None) -> BloomLevel:
    if difficulty is None:
        return BloomLevel.APPLY
    return DIFFICULTY_TO_BLOOM.get(difficulty, BloomLevel.APPLY)


def difficulty_from_bloom(bloom: BloomLevel | None) -> Difficulty:
    if bloom is None:
        return Difficulty.MEDIUM
    return BLOOM_TO_DIFFICULTY.get(bloom, Difficulty.MEDIUM)


def resolve_bloom(question: Question | None, fallback: Difficulty | None = None) -> BloomLevel:
    if question is not None:
        level = getattr(question, "bloom_level", None)
        if level:
            return BloomLevel(level) if not isinstance(level, BloomLevel) else level
        return bloom_from_difficulty(getattr(question, "difficulty", None))
    return bloom_from_difficulty(fallback)


def normalize_rubric(raw: object | None) -> list[dict]:
    if not isinstance(raw, list) or not raw:
        return [dict(item) for item in DEFAULT_RUBRIC]
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        try:
            weight = float(item.get("weight") or 0)
        except (TypeError, ValueError):
            weight = 0.0
        try:
            max_points = float(item.get("max_points") or 100)
        except (TypeError, ValueError):
            max_points = 100.0
        out.append(
            {
                "name": name[:120],
                "description": str(item.get("description") or "").strip()[:2000],
                "weight": max(0.0, min(100.0, weight)),
                "max_points": max(1.0, min(100.0, max_points)),
            }
        )
    if not out:
        return [dict(item) for item in DEFAULT_RUBRIC]
    total_weight = sum(row["weight"] for row in out) or 1.0
    for row in out:
        row["weight"] = round(100.0 * row["weight"] / total_weight, 2)
    return out


def question_rubric(question: Question | None) -> list[dict]:
    if question is None:
        return [dict(item) for item in DEFAULT_RUBRIC]
    return normalize_rubric(getattr(question, "rubric_json", None))
