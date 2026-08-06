from datetime import datetime

from pydantic import BaseModel, Field

from app.models import (
    AssignmentStatus,
    Difficulty,
    Language,
    QuestionType,
    SessionStatus,
    UserRole,
)


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=200)
    email: str = Field(min_length=5, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    role: UserRole


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=255)
    password: str


class UserOut(BaseModel):
    id: int
    full_name: str
    email: str
    role: UserRole

    model_config = {"from_attributes": True}


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class QuestionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    prompt_markdown: str = Field(min_length=10)
    starter_code: str = ""
    language: Language
    difficulty: Difficulty
    question_type: QuestionType = QuestionType.SYLLABUS


class QuestionUpdate(BaseModel):
    title: str | None = None
    prompt_markdown: str | None = None
    starter_code: str | None = None
    language: Language | None = None
    difficulty: Difficulty | None = None
    question_type: QuestionType | None = None
    is_active: bool | None = None


class QuestionOut(BaseModel):
    id: int
    title: str
    prompt_markdown: str
    starter_code: str
    language: Language
    difficulty: Difficulty
    question_type: QuestionType
    created_by_id: int
    is_active: bool

    model_config = {"from_attributes": True}


class TestCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    duration_minutes: int = Field(default=60, ge=10, le=300)
    easy_question_id: int
    medium_question_id: int
    hard_question_id: int


class TestQuestionOut(BaseModel):
    order_index: int
    required_difficulty: Difficulty
    question: QuestionOut


class TestOut(BaseModel):
    id: int
    title: str
    duration_minutes: int
    invite_code: str
    is_published_results: bool
    created_by_id: int
    questions: list[TestQuestionOut] = []

    model_config = {"from_attributes": True}


class AssignByEmailRequest(BaseModel):
    student_email: str = Field(min_length=5, max_length=255)


class AssignByCodeRequest(BaseModel):
    invite_code: str = Field(min_length=4, max_length=8)


class AssignmentOut(BaseModel):
    id: int
    coding_test_id: int
    student_id: int
    status: AssignmentStatus
    test_title: str | None = None
    duration_minutes: int | None = None
    is_published_results: bool = False
    student_email: str | None = None
    student_name: str | None = None

    model_config = {"from_attributes": True}


class SessionOut(BaseModel):
    id: int
    assignment_id: int
    started_at: datetime
    ends_at: datetime
    status: SessionStatus
    violation_score: float
    current_question_order: int
    remaining_seconds: int = 0
    warning: str | None = None


class ExamQuestionOut(BaseModel):
    order_index: int
    difficulty: Difficulty
    question_id: int
    title: str
    prompt_markdown: str
    starter_code: str
    language: Language
    unlocked: bool
    draft_code: str | None = None


class DraftSaveRequest(BaseModel):
    question_id: int
    code: str


class ProctorEventRequest(BaseModel):
    event_type: str
    detail: str | None = None
    duration_seconds: float | None = None


class SubmitResponse(BaseModel):
    message: str
    session_id: int
    status: SessionStatus


class EvalOut(BaseModel):
    eval_run_id: int | None = None
    submission_id: int | None = None
    question_id: int
    question_title: str
    difficulty: Difficulty
    language: Language | None = None
    code: str | None = None
    total_score: float
    verdict: str
    feedback: str
    scores: dict


class EvalUpdateRequest(BaseModel):
    total_score: float = Field(ge=0, le=100)
    feedback: str = Field(min_length=1, max_length=4000)
    verdict: str | None = None


class AttemptResultOut(BaseModel):
    assignment_id: int
    student_id: int
    student_name: str
    student_email: str
    session_id: int | None = None
    session_status: SessionStatus | None
    violation_score: float | None
    evals: list[EvalOut] = []
    average_score: float | None = None
    test_id: int | None = None
    test_title: str | None = None


class StudentResultSummaryOut(BaseModel):
    student_id: int
    student_name: str
    student_email: str
    assignment_count: int
    started_count: int
    submitted_count: int


class StudentResultOut(BaseModel):
    test_title: str
    published: bool
    message: str | None = None
    evals: list[EvalOut] = []
    average_score: float | None = None
