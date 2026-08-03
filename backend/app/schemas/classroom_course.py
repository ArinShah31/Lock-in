from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class LessonOut(BaseModel):
    lesson: int = 1
    title: str
    summary: str = ""
    learning_outcomes: list[str] = Field(default_factory=list)
    notes_markdown: str = ""
    key_terms: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    practice_prompts: list[str] = Field(default_factory=list)
    needs_video: bool = True
    youtube_video_id: str | None = None
    youtube_title: str | None = None
    youtube_url: str | None = None


class FlashcardOut(BaseModel):
    question: str
    answer: str
    topic: str = "General"


class QuizQuestionOut(BaseModel):
    question: str
    options: list[str]
    correct_answer: str
    explanation: str = ""


class ChapterOut(BaseModel):
    chapter: int
    title: str
    summary: str = ""
    timeline: str = ""
    objectives: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    lessons: list[LessonOut] = Field(default_factory=list)
    # Legacy alias for older clients
    subtopics: list[LessonOut] = Field(default_factory=list)
    flashcards: list[FlashcardOut] = Field(default_factory=list)
    quiz: list[QuizQuestionOut] = Field(default_factory=list)
    is_unlocked: bool = False
    is_locked_for_viewer: bool = False
    content_ready: bool = False
    quiz_ready: bool = False


class ClassroomCourseOut(BaseModel):
    id: int
    classroom_id: int
    title: str
    syllabus_file_name: str | None
    source_content_ids: list[int]
    is_published: bool
    chapters: list[ChapterOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CourseBuildJobOut(BaseModel):
    id: int
    classroom_id: int
    course_id: int
    stage: str
    chapter_number: int | None
    subtopic_index: int | None
    status: str
    progress_message: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SetSourcesRequest(BaseModel):
    source_content_ids: list[int] = Field(default_factory=list)
    use_all_documents: bool = False


class ChapterLockRequest(BaseModel):
    is_unlocked: bool


class PublishRequest(BaseModel):
    is_published: bool


class SubtopicVideoUpdate(BaseModel):
    youtube_url: str | None = None


class QuizAttemptRequest(BaseModel):
    selected_answers: list[str]


class AttemptOut(BaseModel):
    id: int
    classroom_id: int
    chapter_number: int
    attempt_type: str
    score: float | None
    payload: dict[str, Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
