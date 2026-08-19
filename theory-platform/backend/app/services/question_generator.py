"""AI theory question generation from topic/scenario + Bloom level + subject."""

from __future__ import annotations

import json
import re

from google import genai

from app.core.config import settings
from app.models import BloomLevel, SubjectArea
from app.services.bloom import normalize_rubric

BLOOM_GUIDANCE = {
    BloomLevel.REMEMBER: "Recall facts, definitions, or lists. Ask the student to state, name, or identify.",
    BloomLevel.UNDERSTAND: "Explain or summarize in their own words. Ask the student to describe or paraphrase.",
    BloomLevel.APPLY: "Use a known method on a new scenario. Ask the student to solve a familiar-type problem.",
    BloomLevel.ANALYZE: "Break down, compare, or contrast. Ask the student to examine relationships or causes.",
    BloomLevel.EVALUATE: "Judge, justify, or critique. Ask the student to defend a position with evidence.",
    BloomLevel.CREATE: "Design or propose something original. Ask the student to plan, outline, or invent.",
}

_gemini_client = None


def _client():
    global _gemini_client
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing in theory-platform/backend/.env")
    if _gemini_client is None:
        _gemini_client = genai.Client(api_key=api_key)
    return _gemini_client


def _parse_json(raw_text: str) -> dict:
    text = (raw_text or "").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        data = json.loads(text, strict=False)
    except json.JSONDecodeError:
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
        data = json.loads(cleaned, strict=False)
    if not isinstance(data, dict):
        raise RuntimeError("Generator did not return a JSON object")
    return data


def generate_question_draft(
    *,
    topic_or_scenario: str,
    bloom_level: BloomLevel,
    subject: SubjectArea,
) -> dict:
    prompt = f"""
You are an expert instructor writing one written theory exam question.

Bloom's taxonomy level: {bloom_level.value}
Level intent: {BLOOM_GUIDANCE[bloom_level]}
Subject area: {subject.value}

Teacher topic or scenario:
{topic_or_scenario.strip()}

Write ONE original written-answer question at that Bloom level.

Rules:
- No coding, no programming languages, no starter code.
- The prompt must be self-contained exam markdown (context, constraints, word-count guidance if useful).
- model_answer is a concise marking guide for teachers (key points, not a full essay).
- Rubric must have 3-5 weighted criteria that sum to 100% weight.
- Return valid JSON only.

Return ONLY JSON:
{{
  "title": "short title",
  "prompt_markdown": "markdown question for the student",
  "model_answer": "teacher marking guide with key points",
  "rubric": [
    {{
      "name": "criterion name",
      "description": "what to look for",
      "weight": 40,
      "max_points": 100
    }}
  ]
}}
"""
    client = _client()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
        config={
            "temperature": 0.4,
            "response_mime_type": "application/json",
        },
    )
    raw_text = (getattr(response, "text", None) or "").strip()
    raw = _parse_json(raw_text)
    title = str(raw.get("title") or "Untitled question").strip()[:200]
    prompt_md = str(raw.get("prompt_markdown") or "").strip()
    model_answer = str(raw.get("model_answer") or "").strip()
    if not prompt_md:
        raise RuntimeError("Generator returned an empty prompt")
    return {
        "title": title or "Untitled question",
        "prompt_markdown": prompt_md,
        "model_answer": model_answer,
        "bloom_level": bloom_level,
        "subject": subject,
        "rubric": normalize_rubric(raw.get("rubric")),
        "source_prompt": topic_or_scenario.strip()[:4000],
    }
