from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ArtifactType(str, Enum):
    LEARNING_PATH = "LEARNING_PATH"
    ROADMAP = "ROADMAP"
    FLASHCARDS = "FLASHCARDS"
    QUIZ = "QUIZ"
    ASSESSMENT = "ASSESSMENT"
    CHAPTER_NOTES = "CHAPTER_NOTES"


class ChapterNotesStatus(str, Enum):
    READY = "READY"
    MISSING = "MISSING"
    GENERATING = "GENERATING"
    FAILED = "FAILED"


class JobStatus(str, Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class GenerateCourseRequest(BaseModel):
    artifact_types: list[ArtifactType] = Field(
        default_factory=lambda: [ArtifactType.LEARNING_PATH]
    )


class CourseBuildJobOut(BaseModel):
    id: int
    subject_id: int
    created_by_id: int
    status: JobStatus
    requested_artifacts: list[str]
    syllabus_file_url: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CourseArtifactOut(BaseModel):
    id: int
    subject_id: int
    job_id: int | None
    created_by_id: int
    artifact_type: ArtifactType
    title: str
    content: dict[str, Any] | list[Any]
    is_published: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CourseArtifactUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    content: dict[str, Any] | list[Any] | None = None
    is_published: bool | None = None


class Flashcard(BaseModel):
    question: str
    answer: str
    topic: str = "General"
    difficulty: str = "MEDIUM"


class QuizQuestion(BaseModel):
    question: str
    options: list[str]
    correct_answer: str
    explanation: str
    difficulty: str = "MEDIUM"


class AssessmentPrompt(BaseModel):
    prompt: str


class Assessment(BaseModel):
    title: str
    instructions: str
    prompts: list[AssessmentPrompt] = Field(default_factory=list)
    rubric: list[str] = Field(default_factory=list)
    estimated_minutes: int = 20


class ChapterContent(BaseModel):
    chapter: int
    title: str
    summary: str
    timeline: str
    objectives: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    flashcards: list[Flashcard] = Field(default_factory=list)
    quiz: list[QuizQuestion] = Field(default_factory=list)
    assessment: Assessment | None = None


class CourseBuilderOutput(BaseModel):
    chapters: list[ChapterContent] = Field(default_factory=list)


class LessonNote(BaseModel):
    lesson: int
    title: str
    summary: str
    learning_outcomes: list[str] = Field(default_factory=list)
    notes_markdown: str
    key_terms: list[str] = Field(default_factory=list)
    examples: list[str] = Field(default_factory=list)
    practice_prompts: list[str] = Field(default_factory=list)


class ChapterNotesContent(BaseModel):
    chapter: int
    chapter_title: str
    intro: str
    lessons: list[LessonNote] = Field(default_factory=list)


class ChapterNotesOut(BaseModel):
    subject_id: int
    chapter: int
    chapter_title: str | None = None
    status: ChapterNotesStatus
    intro: str | None = None
    lessons: list[LessonNote] = Field(default_factory=list)
    artifact_id: int | None = None
    job_id: int | None = None
    is_published: bool = False
    is_unlocked: bool = False
    is_locked_for_viewer: bool = False
    error_message: str | None = None


class ChapterLockUpdate(BaseModel):
    is_unlocked: bool


class LearningChapterOut(BaseModel):
    chapter: int
    title: str
    summary: str | None = None
    timeline: str | None = None
    objectives: list[str] = Field(default_factory=list)
    topics: list[str] = Field(default_factory=list)
    activities: list[str] = Field(default_factory=list)
    flashcards: list[Flashcard] = Field(default_factory=list)
    quiz: list[QuizQuestion] = Field(default_factory=list)
    assessment: Assessment | None = None
    is_unlocked: bool
    is_current: bool
    is_locked_for_viewer: bool


class LearningPathOut(BaseModel):
    subject_id: int
    artifact_id: int | None = None
    is_published: bool
    current_chapter: int
    chapters: list[LearningChapterOut]


class AssessmentAttemptCreate(BaseModel):
    answers: list[str] = Field(default_factory=list)


class QuizAttemptCreate(BaseModel):
    selected_answers: list[str] = Field(default_factory=list)


class AttemptOut(BaseModel):
    id: int
    subject_id: int
    chapter_number: int
    attempt_type: str
    score: float | None
    payload: dict[str, Any] | list[Any]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
