from __future__ import annotations

from pydantic import BaseModel, Field

from app.ai.llm.client import generate_content_with_pool
from app.core.config import settings
from app.models.content import ClassroomContent
from app.services.bloom import resolve_bloom_level
from app.services.source_text import build_source_text

SCENARIO_QUESTIONS_PER_CASE = 5
SCENARIOS_PER_CHAPTER_MIN = 5
SCENARIOS_PER_CHAPTER_MAX = 6

_PLACEHOLDER_OPTIONS = frozenset(
    {
        "a",
        "b",
        "c",
        "d",
        "option a",
        "option b",
        "option c",
        "option d",
        "choice a",
        "choice b",
        "choice c",
        "choice d",
    }
)


def valid_mcq_options(options: list) -> bool:
    cleaned = [str(option).strip() for option in options if str(option).strip()]
    if len(cleaned) != 4:
        return False
    if all(len(option) <= 2 for option in cleaned):
        return False
    if all(option.lower() in _PLACEHOLDER_OPTIONS for option in cleaned):
        return False
    return True


class GeminiPracticeQuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(default_factory=list)
    correct_answer: str
    explanation: str = ""
    bloom_level: str | None = None


class GeminiPracticeFlashcard(BaseModel):
    question: str
    answer: str
    topic: str = "General"


class GeminiPracticeScenario(BaseModel):
    title: str
    situation: str
    questions: list[GeminiPracticeQuizQuestion] = Field(default_factory=list)


class GeminiPracticeChapter(BaseModel):
    title: str
    summary: str = ""
    topics: list[str] = Field(default_factory=list)
    flashcards: list[GeminiPracticeFlashcard] = Field(default_factory=list)
    quiz: list[GeminiPracticeQuizQuestion] = Field(default_factory=list)
    scenarios: list[GeminiPracticeScenario] = Field(default_factory=list)


class GeminiPracticePayload(BaseModel):
    chapters: list[GeminiPracticeChapter] = Field(default_factory=list)


class GeminiChapterScenariosPayload(BaseModel):
    scenarios: list[GeminiPracticeScenario] = Field(default_factory=list)


def parse_quiz_questions(
    items: list,
    *,
    required_count: int | None = None,
) -> list[dict]:
    quiz: list[dict] = []
    for item in items:
        if isinstance(item, dict):
            options = [str(option).strip() for option in (item.get("options") or []) if str(option).strip()]
            correct_answer = str(item.get("correct_answer") or "").strip()
            question = str(item.get("question") or "").strip()
            explanation = str(item.get("explanation") or "").strip()
            stored_bloom = item.get("bloom_level")
        else:
            options = [option.strip() for option in item.options if option.strip()]
            correct_answer = item.correct_answer.strip()
            question = item.question.strip()
            explanation = item.explanation.strip()
            stored_bloom = getattr(item, "bloom_level", None)
        if (
            not valid_mcq_options(options)
            or correct_answer not in options
            or not question
        ):
            continue
        quiz.append(
            {
                "question": question,
                "options": options,
                "correct_answer": correct_answer,
                "explanation": explanation,
                "bloom_level": resolve_bloom_level(question, stored_bloom).value,
            }
        )
        if required_count is not None and len(quiz) >= required_count:
            break
    if required_count is not None and len(quiz) != required_count:
        return []
    return quiz


def parse_scenarios(
    raw_scenarios: list,
    *,
    chapter_number: int,
    max_count: int = SCENARIOS_PER_CHAPTER_MAX,
) -> list[dict]:
    scenarios: list[dict] = []
    for index, item in enumerate(raw_scenarios, start=1):
        if isinstance(item, dict):
            title = str(item.get("title") or "").strip()
            situation = str(item.get("situation") or "").strip()
            questions_raw = item.get("questions") or []
        else:
            title = item.title.strip()
            situation = item.situation.strip()
            questions_raw = item.questions
        if not title or not situation:
            continue
        questions = parse_quiz_questions(questions_raw, required_count=SCENARIO_QUESTIONS_PER_CASE)
        if len(questions) != SCENARIO_QUESTIONS_PER_CASE:
            continue
        scenarios.append(
            {
                "id": f"chapter-{chapter_number}-scenario-{index}",
                "title": title,
                "situation": situation,
                "questions": questions,
            }
        )
        if len(scenarios) >= max_count:
            break
    return scenarios


def generate_chapter_scenarios(
    *,
    classroom_name: str,
    chapter: dict,
    syllabus_text: str | None = None,
    syllabus_path: str | None = None,
    syllabus_name: str | None = None,
    documents: list[ClassroomContent] | None = None,
) -> list[dict]:
    chapter_number = int(chapter.get("chapter") or 0)
    source_text = build_source_text(
        syllabus_text=syllabus_text,
        syllabus_path=syllabus_path,
        syllabus_name=syllabus_name,
        documents=documents or [],
    )
    chapter_context = (
        f"Chapter {chapter_number}: {chapter.get('title')}\n"
        f"Summary: {chapter.get('summary')}\n"
        f"Topics: {', '.join(str(topic) for topic in (chapter.get('topics') or []))}"
    )
    response = generate_content_with_pool(
        model=settings.gemini_chat_model,
        contents=(
            "You are ASTRA's scenario-based practice writer. Use ONLY the provided classroom documents "
            "and chapter context. Do not invent topics outside the source material.\n\n"
            f"Classroom: {classroom_name}\n"
            f"{chapter_context}\n\n"
            "Source material:\n"
            f"{source_text[:18000]}\n\n"
            f"Create {SCENARIOS_PER_CHAPTER_MIN} to {SCENARIOS_PER_CHAPTER_MAX} realistic scenario case studies in JSON. "
            "Each scenario must include:\n"
            "- title: short case title\n"
            "- situation: one concise paragraph describing a realistic situation grounded in the material\n"
            f"- exactly {SCENARIO_QUESTIONS_PER_CASE} MCQs that require applying the situation (not trivia)\n"
            "- each MCQ must have exactly 4 options\n"
            "- correct_answer must match one option exactly\n"
            "- each MCQ must include bloom_level as one of: REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE\n"
            "- bloom_level must match the cognitive demand of the question stem\n"
            "Keep situations short so the full set fits in one response."
        ),
        config={
            "response_mime_type": "application/json",
            "response_schema": GeminiChapterScenariosPayload,
        },
    )
    payload = response.parsed
    if not payload or not payload.scenarios:
        return []
    return parse_scenarios(payload.scenarios, chapter_number=chapter_number)


def generate_practice_chapters(
    *,
    classroom_name: str,
    syllabus_text: str | None,
    syllabus_path: str | None,
    syllabus_name: str | None,
    documents: list[ClassroomContent],
) -> list[dict]:
    source_text = build_source_text(
        syllabus_text=syllabus_text,
        syllabus_path=syllabus_path,
        syllabus_name=syllabus_name,
        documents=documents,
    )
    if not source_text.strip():
        return []

    response = generate_content_with_pool(
        model=settings.gemini_chat_model,
        contents=(
            "You are ASTRA's practice generator. Use ONLY the provided classroom documents and syllabus context. "
            "Do not invent topics outside the source material.\n\n"
            f"Classroom: {classroom_name}\n\n"
            "Source material:\n"
            f"{source_text[:20000]}\n\n"
            "Create student practice material in JSON. "
            "Group the material into 1 to 6 meaningful chapter/topic clusters based on the actual content. "
            "For each chapter provide:\n"
            "- a strong title inferred from the materials\n"
            "- a short summary\n"
            "- 3 to 6 topics\n"
            "- 6 to 10 flashcards\n"
            "- 4 to 8 MCQ quiz questions\n"
            f"- {SCENARIOS_PER_CHAPTER_MIN} to {SCENARIOS_PER_CHAPTER_MAX} scenario case studies\n"
            "Rules:\n"
            "- flashcards must help revision and recall\n"
            "- quiz questions must test understanding, not trivia noise\n"
            "- each quiz must have exactly 4 options\n"
            "- each quiz question must include bloom_level as one of: REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE\n"
            "- bloom_level must match the cognitive demand of the question stem\n"
            "- each scenario has a title, one concise situation paragraph, and exactly "
            f"{SCENARIO_QUESTIONS_PER_CASE} MCQs with 4 options each\n"
            "- scenario MCQs must require applying the situation, not memorizing isolated facts\n"
            "- each scenario MCQ must include bloom_level as one of: REMEMBER, UNDERSTAND, APPLY, ANALYZE, EVALUATE, CREATE\n"
            "- correct_answer must match one option exactly\n"
            "- keep everything bounded to the uploaded documents and syllabus\n"
            "- return clean academic material suitable for students"
        ),
        config={
            "response_mime_type": "application/json",
            "response_schema": GeminiPracticePayload,
        },
    )
    payload = response.parsed
    if not payload or not payload.chapters:
        return []

    chapters: list[dict] = []
    for index, chapter in enumerate(payload.chapters, start=1):
        quiz = parse_quiz_questions(chapter.quiz)

        flashcards = []
        for item in chapter.flashcards:
            question = item.question.strip()
            answer = item.answer.strip()
            if not question or not answer:
                continue
            flashcards.append(
                {
                    "question": question,
                    "answer": answer,
                    "topic": item.topic.strip() or "General",
                }
            )

        scenarios = parse_scenarios(chapter.scenarios, chapter_number=index)

        topics = [topic.strip() for topic in chapter.topics if topic.strip()]
        title = chapter.title.strip() or f"Chapter {index}"
        chapters.append(
            {
                "chapter": index,
                "title": title,
                "summary": chapter.summary.strip(),
                "timeline": "Gemini practice generation",
                "objectives": [f"Revise {topic}" for topic in topics[:3]],
                "topics": topics,
                "activities": [],
                "lessons": [],
                "subtopics": [],
                "flashcards": flashcards,
                "quiz": quiz,
                "scenarios": scenarios,
            }
        )
    return chapters
