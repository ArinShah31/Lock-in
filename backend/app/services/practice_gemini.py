from __future__ import annotations

from pydantic import BaseModel, Field

from app.ai.llm.client import get_client
from app.core.config import settings
from app.models.content import ClassroomContent
from app.services.source_text import build_source_text


class GeminiPracticeQuizQuestion(BaseModel):
    question: str
    options: list[str] = Field(default_factory=list)
    correct_answer: str
    explanation: str = ""


class GeminiPracticeFlashcard(BaseModel):
    question: str
    answer: str
    topic: str = "General"


class GeminiPracticeChapter(BaseModel):
    title: str
    summary: str = ""
    topics: list[str] = Field(default_factory=list)
    flashcards: list[GeminiPracticeFlashcard] = Field(default_factory=list)
    quiz: list[GeminiPracticeQuizQuestion] = Field(default_factory=list)


class GeminiPracticePayload(BaseModel):
    chapters: list[GeminiPracticeChapter] = Field(default_factory=list)


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

    client = get_client()
    response = client.models.generate_content(
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
            "Rules:\n"
            "- flashcards must help revision and recall\n"
            "- quiz questions must test understanding, not trivia noise\n"
            "- each quiz must have exactly 4 options\n"
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
        quiz = []
        for item in chapter.quiz:
            options = [option.strip() for option in item.options if option.strip()]
            if len(options) != 4:
                continue
            correct_answer = item.correct_answer.strip()
            if correct_answer not in options:
                continue
            question = item.question.strip()
            if not question:
                continue
            quiz.append(
                {
                    "question": question,
                    "options": options,
                    "correct_answer": correct_answer,
                    "explanation": item.explanation.strip(),
                }
            )

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
            }
        )
    return chapters
