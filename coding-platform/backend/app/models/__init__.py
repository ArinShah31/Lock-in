from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SqlEnum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UserRole(str, Enum):
    TEACHER = "TEACHER"
    STUDENT = "STUDENT"


class Difficulty(str, Enum):
    EASY = "EASY"
    MEDIUM = "MEDIUM"
    HARD = "HARD"


class BloomLevel(str, Enum):
    REMEMBER = "REMEMBER"
    UNDERSTAND = "UNDERSTAND"
    APPLY = "APPLY"
    ANALYZE = "ANALYZE"
    EVALUATE = "EVALUATE"
    CREATE = "CREATE"


class QuestionType(str, Enum):
    SYLLABUS = "SYLLABUS"
    HIRING = "HIRING"


class Language(str, Enum):
    PYTHON = "python"
    JAVA = "java"
    CPP = "cpp"
    HTML = "html"
    CSS = "css"
    JAVASCRIPT = "javascript"


class AssignmentStatus(str, Enum):
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    BLOCKED = "BLOCKED"


class SessionStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    SUBMITTED = "SUBMITTED"
    BLOCKED = "BLOCKED"
    EXPIRED = "EXPIRED"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SqlEnum(UserRole), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    prompt_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    starter_code: Mapped[str] = mapped_column(Text, nullable=False, default="")
    language: Mapped[Language] = mapped_column(SqlEnum(Language), nullable=False, index=True)
    difficulty: Mapped[Difficulty] = mapped_column(SqlEnum(Difficulty), nullable=False, index=True)
    question_type: Mapped[QuestionType] = mapped_column(
        SqlEnum(QuestionType), nullable=False, default=QuestionType.SYLLABUS, index=True
    )
    bloom_level: Mapped[BloomLevel] = mapped_column(
        SqlEnum(BloomLevel), nullable=False, default=BloomLevel.APPLY, index=True
    )
    rubric_json: Mapped[list | None] = mapped_column(JSON, nullable=True)
    source_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class CodingTest(Base):
    __tablename__ = "coding_tests"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    created_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    is_published_results: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    invite_code: Mapped[str] = mapped_column(String(8), unique=True, index=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    questions = relationship("CodingTestQuestion", back_populates="coding_test", cascade="all, delete-orphan")
    assignments = relationship("TestAssignment", back_populates="coding_test", cascade="all, delete-orphan")


class CodingTestQuestion(Base):
    __tablename__ = "coding_test_questions"
    __table_args__ = (UniqueConstraint("coding_test_id", "order_index", name="uq_test_order"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    coding_test_id: Mapped[int] = mapped_column(ForeignKey("coding_tests.id"), nullable=False, index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False, index=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False)  # 1..N
    required_difficulty: Mapped[Difficulty] = mapped_column(SqlEnum(Difficulty), nullable=False)

    coding_test = relationship("CodingTest", back_populates="questions")
    question = relationship("Question")


class TestAssignment(Base):
    __tablename__ = "test_assignments"
    __table_args__ = (UniqueConstraint("coding_test_id", "student_id", name="uq_test_student"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    coding_test_id: Mapped[int] = mapped_column(ForeignKey("coding_tests.id"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    status: Mapped[AssignmentStatus] = mapped_column(
        SqlEnum(AssignmentStatus), default=AssignmentStatus.ASSIGNED, nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    coding_test = relationship("CodingTest", back_populates="assignments")
    sessions = relationship("TestSession", back_populates="assignment", cascade="all, delete-orphan")


class TestSession(Base):
    __tablename__ = "test_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("test_assignments.id"), nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[SessionStatus] = mapped_column(
        SqlEnum(SessionStatus), default=SessionStatus.IN_PROGRESS, nullable=False
    )
    violation_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    current_question_order: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    assignment = relationship("TestAssignment", back_populates="sessions")
    drafts = relationship("CodeDraft", back_populates="session", cascade="all, delete-orphan")
    submissions = relationship("CodeSubmission", back_populates="session", cascade="all, delete-orphan")
    events = relationship("ProctorEvent", back_populates="session", cascade="all, delete-orphan")


class CodeDraft(Base):
    __tablename__ = "code_drafts"
    __table_args__ = (UniqueConstraint("session_id", "question_id", name="uq_session_question_draft"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("test_sessions.id"), nullable=False, index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    session = relationship("TestSession", back_populates="drafts")


class CodeSubmission(Base):
    __tablename__ = "code_submissions"
    __table_args__ = (UniqueConstraint("session_id", "question_id", name="uq_session_question_sub"),)

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("test_sessions.id"), nullable=False, index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id"), nullable=False, index=True)
    code: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[Language] = mapped_column(SqlEnum(Language), nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    session = relationship("TestSession", back_populates="submissions")
    eval_run = relationship("EvalRun", back_populates="submission", uselist=False, cascade="all, delete-orphan")


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    submission_id: Mapped[int] = mapped_column(
        ForeignKey("code_submissions.id"), unique=True, nullable=False, index=True
    )
    scores: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    total_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    verdict: Mapped[str] = mapped_column(String(40), nullable=False, default="PENDING")
    feedback: Mapped[str] = mapped_column(Text, nullable=False, default="")
    raw_llm: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    submission = relationship("CodeSubmission", back_populates="eval_run")


class ProctorEvent(Base):
    __tablename__ = "proctor_events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("test_sessions.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    detail: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    session = relationship("TestSession", back_populates="events")
