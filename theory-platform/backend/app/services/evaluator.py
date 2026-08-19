"""Grade written theory answers with Bloom-aligned rubrics."""

from __future__ import annotations

import json
import re

from openai import OpenAI

from app.core.config import settings
from app.models import Question
from app.services.bloom import question_rubric, resolve_bloom


def is_empty_answer(text: str) -> bool:
    cleaned = re.sub(r"\s+", " ", (text or "").strip())
    return len(cleaned) < 20


def _client() -> OpenAI:
    if not settings.groq_api_key.strip():
        raise RuntimeError("GROQ_API_KEY is missing in theory-platform/backend/.env")
    return OpenAI(api_key=settings.groq_api_key.strip(), base_url="https://api.groq.com/openai/v1")


def evaluate_submission(*, question: Question, answer_text: str) -> dict:
    rubric = question_rubric(question)
    bloom = resolve_bloom(question)

    if is_empty_answer(answer_text):
        scores = {row["name"]: 0.0 for row in rubric}
        return {
            "scores": scores,
            "total_score": 0.0,
            "verdict": "INCOMPLETE",
            "feedback": "Your answer was too short or empty. Write a complete response that addresses the question.",
            "raw_llm": None,
            "error_message": None,
        }

    marking_guide = (question.model_answer or "").strip()
    rubric_lines = "\n".join(
        f"- {row['name']} (weight {row['weight']}%): {row['description']}"
        for row in rubric
    )
    score_schema = ", ".join(f'"{row["name"]}": 0-{int(row["max_points"])}' for row in rubric)

    prompt = f"""
You are grading a written theory exam answer.

Bloom level: {bloom.value}

Question:
{question.prompt_markdown}

Teacher marking guide (reference only):
{marking_guide or "Not provided — grade from the question prompt and rubric only."}

Student answer:
{answer_text.strip()}

Grade using this rubric. Score each criterion from 0 to its max_points.
{rubric_lines}

Return ONLY valid JSON:
{{
  "scores": {{ {score_schema} }},
  "total_score": 0-100,
  "verdict": "EXCELLENT|GOOD|NEEDS_WORK|INCOMPLETE",
  "feedback": "2-4 sentences of actionable feedback aligned to the rubric and Bloom level"
}}
"""

    models: list[str] = []
    for name in (settings.groq_model, settings.groq_model_fallback):
        model = (name or "").strip()
        if model and model not in models:
            models.append(model)
    if not models:
        models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"]

    data: dict | None = None
    last_error: Exception | None = None
    try:
        client = _client()
        for model in models:
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.2,
                    response_format={"type": "json_object"},
                )
                raw = (response.choices[0].message.content or "").strip()
                data = json.loads(raw)
                last_error = None
                break
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                msg = str(exc).lower()
                if "model_not_found" in msg or "does not exist" in msg or "not have access" in msg:
                    continue
                break
        if data is None:
            raise last_error or RuntimeError("Automatic grading failed")
    except Exception as exc:  # noqa: BLE001
        scores = {row["name"]: 0.0 for row in rubric}
        return {
            "scores": scores,
            "total_score": 0.0,
            "verdict": "ERROR",
            "feedback": "Automatic grading failed. Your teacher may review manually.",
            "raw_llm": None,
            "error_message": str(exc),
        }

    scores: dict[str, float] = {}
    for row in rubric:
        try:
            scores[row["name"]] = float((data.get("scores") or {}).get(row["name"], 0))
        except (TypeError, ValueError):
            scores[row["name"]] = 0.0

    weight_sum = sum(row["weight"] for row in rubric) or 100.0
    weighted = 0.0
    for row in rubric:
        max_pts = float(row["max_points"] or 100)
        pct = scores.get(row["name"], 0.0) / max_pts if max_pts else 0.0
        weighted += pct * (float(row["weight"]) / weight_sum) * 100.0

    total = float(data.get("total_score", weighted))
    total = max(0.0, min(100.0, total if total else weighted))

    return {
        "scores": scores,
        "total_score": round(total, 2),
        "verdict": str(data.get("verdict") or "GOOD")[:40],
        "feedback": str(data.get("feedback") or "").strip()[:4000],
        "raw_llm": data,
        "error_message": None,
    }


def event_weight(event_type: str, duration_seconds: float | None = None) -> float:
    et = event_type.lower().strip()
    dur = duration_seconds or 0.0
    if et in {"window_switch", "alt_tab", "app_switch"}:
        return 2.0
    if et in {"blur", "focus_lost"}:
        return 1.5
    if et in {"visibility_hidden", "tab_hidden"}:
        return 2.0
    if et == "fullscreen_exit":
        return 1.0 if dur < 1.5 else 2.5
    if et == "paste":
        return 1.5
    if et == "paste_storm":
        return 3.0
    if et == "focus_thrash":
        return 2.5
    if et == "devtools_suspect":
        return 2.5
    if et in {"copy", "cut"}:
        return 1.0
    if et == "heartbeat":
        return 0.0
    return 0.5
