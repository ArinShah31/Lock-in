import json
import re

from openai import OpenAI

from app.core.config import settings
from app.models import Language, Question

WEIGHTS = {
    "correctness": 0.55,
    "efficiency": 0.15,
    "style": 0.15,
    "edge_cases": 0.15,
}

_STUB_PATTERNS = [
    r"^\s*pass\s*$",
    r"^\s*\.\.\.\s*$",
    r"^\s*return\s+None\s*$",
    r"^\s*return\s+null\s*;?\s*$",
    r"^\s*TODO\b",
    r"^\s*NotImplementedError",
]


def _strip_comments_and_strings_rough(code: str, language: Language) -> str:
    text = code
    if language == Language.PYTHON:
        text = re.sub(r"#.*", "", text)
        text = re.sub(r'"""[\s\S]*?"""', "", text)
        text = re.sub(r"'''[\s\S]*?'''", "", text)
    else:
        text = re.sub(r"//.*", "", text)
        text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return text


def is_stub_solution(code: str, language: Language, starter_code: str = "") -> bool:
    """True when the student barely changed a starter / left an empty body."""
    raw = (code or "").strip()
    if len(raw) < 8:
        return True

    normalized = re.sub(r"\s+", "", raw)
    starter_norm = re.sub(r"\s+", "", (starter_code or "").strip())
    if starter_norm and normalized == starter_norm:
        return True
    if starter_norm and normalized.startswith(starter_norm) and len(normalized) - len(starter_norm) < 12:
        return True

    body = _strip_comments_and_strings_rough(raw, language)
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    meaningful: list[str] = []
    for ln in lines:
        if re.match(r"^(def|class|public|private|protected|static|function|#include|using)\b", ln):
            continue
        if ln in {"{", "}", "};"}:
            continue
        if re.match(r"^[:{]$", ln):
            continue
        meaningful.append(ln)

    if not meaningful:
        return True
    if all(any(re.search(pat, ln) for pat in _STUB_PATTERNS) for ln in meaningful):
        return True
    if len(meaningful) <= 2 and all(
        re.match(r"^return\s+(0|-1|\[\]|\{\}|false|true|\"\"|'')\s*;?$", ln, re.I) for ln in meaningful
    ):
        return True
    return False


def _client() -> OpenAI:
    if not settings.groq_api_key.strip():
        raise RuntimeError("GROQ_API_KEY is missing in coding-platform/backend/.env")
    return OpenAI(api_key=settings.groq_api_key.strip(), base_url="https://api.groq.com/openai/v1")


def evaluate_submission(*, question: Question, code: str, language: Language) -> dict:
    if is_stub_solution(code, language, question.starter_code or ""):
        return {
            "scores": {"correctness": 0, "efficiency": 0, "style": 5, "edge_cases": 0},
            "total_score": 0.75,
            "verdict": "FAIL",
            "feedback": (
                "No working solution detected (empty body, unchanged starter, or only `pass`/placeholder). "
                "Implement the required logic before submitting."
            ),
            "raw_llm": {"stub_detected": True},
            "error_message": None,
        }

    web = language in {Language.HTML, Language.CSS, Language.JAVASCRIPT}
    rubric = (
        "Grade web markup/styles/scripts for structure, correctness vs prompt, accessibility, and polish."
        if web
        else "Grade algorithms/code for correctness, efficiency, style, and edge-case handling."
    )
    prompt = f"""
You are a STRICT coding assessment grader for college exams.

Language: {language.value}
Difficulty: {question.difficulty.value}
Question type: {question.question_type.value}
Title: {question.title}

Problem:
{question.prompt_markdown}

Student solution:
```{language.value}
{code}
```

Rules:
- If the solution is incomplete, only a stub, uses pass/TODO, or does not solve the problem, correctness must be 0-15 and total quality must FAIL.
- Do NOT award high style/efficiency points for empty or placeholder code.
- Only give PASS-level scores when the core problem is actually solved.
- {rubric}

Return ONLY JSON:
{{
  "correctness": 0-100,
  "efficiency": 0-100,
  "style": 0-100,
  "edge_cases": 0-100,
  "feedback": "2-4 sentences of actionable feedback"
}}
"""
    try:
        response = _client().chat.completions.create(
            model=settings.groq_model,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": "Return only valid JSON. Be strict with incomplete solutions."},
                {"role": "user", "content": prompt},
            ],
        )
        raw_text = response.choices[0].message.content or "{}"
        raw = json.loads(raw_text)
    except Exception as exc:  # noqa: BLE001
        return {
            "scores": {"correctness": 0, "efficiency": 0, "style": 0, "edge_cases": 0},
            "total_score": 0.0,
            "verdict": "ERROR",
            "feedback": "Automatic grading failed. A teacher will review manually.",
            "raw_llm": None,
            "error_message": str(exc),
        }

    scores = {key: float(max(0, min(100, raw.get(key, 0)))) for key in WEIGHTS}
    if scores["correctness"] < 25:
        for key in ("efficiency", "style", "edge_cases"):
            scores[key] = min(scores[key], 20.0)

    total = sum(scores[k] * w for k, w in WEIGHTS.items())
    if total >= 70:
        verdict = "PASS"
    elif total >= 50:
        verdict = "BORDERLINE"
    else:
        verdict = "FAIL"
    feedback = str(raw.get("feedback") or "").strip() or "No feedback provided."
    return {
        "scores": scores,
        "total_score": round(total, 2),
        "verdict": verdict,
        "feedback": feedback,
        "raw_llm": raw,
        "error_message": None,
    }


def event_weight(event_type: str, duration_seconds: float | None = None) -> float:
    """Strict proctoring: window switches always count; short grace elsewhere."""
    et = event_type.lower().strip()
    dur = duration_seconds or 0.0
    # Alt+Tab / app switch — always counts (no grace).
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
