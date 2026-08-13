"""AI question generation from topic/scenario + Bloom level + language."""

from __future__ import annotations

import json
import re

from google import genai

from app.core.config import settings
from app.models import BloomLevel, Language
from app.services.bloom import normalize_rubric

BLOOM_GUIDANCE = {
    BloomLevel.REMEMBER: "Recall facts, syntax, or definitions. Ask the student to identify, list, or reproduce a known construct.",
    BloomLevel.UNDERSTAND: "Explain or paraphrase a concept. Ask the student to describe what code does or why a construct is used.",
    BloomLevel.APPLY: "Use a known technique on a new but familiar problem. The student implements a standard algorithm or pattern.",
    BloomLevel.ANALYZE: "Break a problem into parts. Compare approaches, debug, or reason about complexity and structure.",
    BloomLevel.EVALUATE: "Judge quality or choose among designs. The student critiques, justifies, or selects a better approach.",
    BloomLevel.CREATE: "Design something new. Combine ideas into an original solution, data structure, or small system.",
}


_gemini_client = None


def _client():
    """Reuse one Client. Creating a throwaway Client per call lets google-genai
    close its httpx session before generate_content finishes."""
    global _gemini_client
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is missing in coding-platform/backend/.env")
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
        # Gemini often emits raw newlines/tabs inside JSON strings.
        cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", text)
        data = json.loads(cleaned, strict=False)
    if not isinstance(data, dict):
        raise RuntimeError("Generator did not return a JSON object")
    return data


def generate_question_draft(
    *,
    topic_or_scenario: str,
    bloom_level: BloomLevel,
    language: Language,
) -> dict:
    prompt = f"""
You are an expert computer-science instructor writing one coding exam question.

Bloom's taxonomy level: {bloom_level.value}
Level intent: {BLOOM_GUIDANCE[bloom_level]}
Programming language: {language.value}

Teacher topic or scenario:
{topic_or_scenario.strip()}

Write ONE original coding question at that Bloom level in that language.

Rules:
- Match the Bloom level strictly (do not make a Remember question require original design).
- The prompt must be self-contained exam markdown (constraints, examples if useful).
- Starter code must compile/parse as a skeleton in {language.value} with TODOs or pass/placeholders.
- Rubric must have 3-5 weighted criteria that sum conceptually to 100% weight.
- Return valid JSON. Put real line breaks in starter_code and prompt_markdown as \\n escape sequences, not raw newlines.

Return ONLY JSON:
{{
  "title": "short title",
  "prompt_markdown": "markdown problem statement",
  "starter_code": "starter skeleton",
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
    starter = str(raw.get("starter_code") or "").strip()
    if not prompt_md:
        raise RuntimeError("Generator returned an empty prompt")
    return {
        "title": title or "Untitled question",
        "prompt_markdown": prompt_md,
        "starter_code": starter,
        "bloom_level": bloom_level,
        "language": language,
        "rubric": normalize_rubric(raw.get("rubric")),
        "source_prompt": topic_or_scenario.strip(),
    }
