from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PracticeQuestionOut(BaseModel):
    question: str
    options: list[str] = Field(default_factory=list)


class PracticeQuizOut(BaseModel):
    chapter_number: int
    title: str
    summary: str = ""
    topic_label: str = ""
    question_count: int = 0
    latest_score: float | None = None
    latest_attempted_at: datetime | None = None
    questions: list[PracticeQuestionOut] = Field(default_factory=list)


class PracticeFlashcardOut(BaseModel):
    id: str
    question: str
    answer: str
    cue: str = ""


class PracticeFlashcardDeckOut(BaseModel):
    id: str
    title: str
    subject: str
    summary: str = ""
    focus: str = ""
    estimated_time: str = ""
    mastery_hint: str = ""
    cards: list[PracticeFlashcardOut] = Field(default_factory=list)


class PracticeAssessmentOut(BaseModel):
    assessment_kind: str
    target_key: str
    title: str
    meta: str = ""
    detail: str = ""
    question_count: int = 0
    duration_minutes: int = 0
    is_locked: bool = True
    latest_score: float | None = None
    latest_attempted_at: datetime | None = None
    questions: list[PracticeQuestionOut] = Field(default_factory=list)


class PracticeSummaryOut(BaseModel):
    source_document_count: int = 0
    ready_quizzes: int = 0
    flashcard_decks: int = 0
    locked_assessments: int = 0
    completed_quizzes: int = 0
    completed_assessments: int = 0


class PracticeOverviewOut(BaseModel):
    classroom_id: int
    classroom_name: str
    course_title: str | None = None
    source_document_count: int = 0
    summary: PracticeSummaryOut
    quizzes: list[PracticeQuizOut] = Field(default_factory=list)
    flashcard_decks: list[PracticeFlashcardDeckOut] = Field(default_factory=list)
    topic_assessments: list[PracticeAssessmentOut] = Field(default_factory=list)
    subject_assessments: list[PracticeAssessmentOut] = Field(default_factory=list)


class PracticeAttemptRequest(BaseModel):
    selected_answers: list[str] = Field(default_factory=list)


class PracticeAttemptOut(BaseModel):
    id: int
    classroom_id: int
    score: float | None
    attempt_type: str
    payload: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PracticeAssessmentLockRequest(BaseModel):
    is_unlocked: bool
