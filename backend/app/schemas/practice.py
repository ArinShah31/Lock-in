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


class PracticeScenarioOut(BaseModel):
    id: str
    chapter_number: int
    chapter_title: str
    title: str
    situation: str
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
    ready_scenarios: int = 0
    locked_assessments: int = 0
    completed_quizzes: int = 0
    completed_scenarios: int = 0
    completed_assessments: int = 0


class PracticeOverviewOut(BaseModel):
    classroom_id: int
    classroom_name: str
    course_title: str | None = None
    source_document_count: int = 0
    generation_status: str = "idle"
    generation_error: str | None = None
    generation_message: str | None = None
    summary: PracticeSummaryOut
    quizzes: list[PracticeQuizOut] = Field(default_factory=list)
    flashcard_decks: list[PracticeFlashcardDeckOut] = Field(default_factory=list)
    scenarios: list[PracticeScenarioOut] = Field(default_factory=list)
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


class MockExamQuestionOut(BaseModel):
    id: str
    question_type: str = "MCQ"
    question: str
    marks: float = 1
    options: list[str] = Field(default_factory=list)
    correct_answer: str | None = None
    expected_answer: str | None = None
    section_title: str = ""


class MockExamSectionOut(BaseModel):
    id: str
    title: str
    instructions: str = ""
    question_type: str = "MCQ"
    marks_per_question: float = 1
    question_count: int = 0
    required_count: int | None = None
    questions: list[MockExamQuestionOut] = Field(default_factory=list)


class MockExamPatternOut(BaseModel):
    title: str = "Mock Exam"
    total_marks: int = 60
    duration_minutes: int = 60
    instructions: str = ""
    sections: list[MockExamSectionOut] = Field(default_factory=list)
    pyq_file_name: str | None = None
    pyq_file_path: str | None = None


class MockExamCreateRequest(BaseModel):
    title: str = "Mock Exam"
    total_marks: int = 60
    duration_minutes: int = 60
    pattern: dict = Field(default_factory=dict)
    pyq_file_name: str | None = None
    pyq_file_path: str | None = None


class MockExamOut(BaseModel):
    id: int
    classroom_id: int
    title: str
    total_marks: int
    duration_minutes: int
    status: str
    pyq_file_name: str | None = None
    pattern: dict = Field(default_factory=dict)
    paper: dict = Field(default_factory=dict)
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MockExamAttemptRequest(BaseModel):
    answers: dict = Field(default_factory=dict)


class MockExamAttemptOut(BaseModel):
    id: int
    mock_exam_id: int
    classroom_id: int
    student_id: int
    answers: dict = Field(default_factory=dict)
    mcq_score: float | None = None
    theory_score: float | None = None
    total_score: float | None = None
    theory_status: str
    feedback: str | None = None
    submitted_at: datetime
    reviewed_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class MockExamReviewRequest(BaseModel):
    theory_score: float = 0
    feedback: str | None = None


class MockExamPublishRequest(BaseModel):
    is_published: bool
