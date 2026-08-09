from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class MembershipStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class Classroom(Base):
    __tablename__ = "classrooms"
    __table_args__ = (
        UniqueConstraint(
            "institution_id",
            "code",
            name="uq_classroom_institution_code",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    institution_id: Mapped[int] = mapped_column(
        ForeignKey("institutions.id"),
        nullable=False,
        index=True,
    )
    department_id: Mapped[int | None] = mapped_column(
        ForeignKey("departments.id"),
        nullable=True,
        index=True,
    )
    class_teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    join_code: Mapped[str] = mapped_column(
        String(5),
        unique=True,
        index=True,
        nullable=False,
    )
    # Analytics sharing: this code identifies the classroom as a *viewer*.
    # Another teacher pastes it into their own classroom to grant this
    # classroom view-only analytics of theirs. Separate from join_code.
    analytics_share_code: Mapped[str | None] = mapped_column(
        String(12),
        unique=True,
        index=True,
        nullable=True,
    )
    academic_year: Mapped[str | None] = mapped_column(
        String(20),
        nullable=True,
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    students = relationship(
        "ClassroomStudent",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    teachers = relationship(
        "ClassroomTeacher",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    announcements = relationship(
        "ClassroomAnnouncement",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    contents = relationship(
        "ClassroomContent",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    assignments = relationship(
        "Assignment",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )

    course = relationship(
        "ClassroomCourse",
        back_populates="classroom",
        uselist=False,
        cascade="all, delete-orphan",
    )

    subjects = relationship(
        "Subject",
        back_populates="classroom",
        cascade="all, delete-orphan",
    )


class ClassroomStudent(Base):
    __tablename__ = "classroom_students"
    __table_args__ = (
        UniqueConstraint(
            "classroom_id",
            "student_id",
            name="uq_classroom_student",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True,
    )
    student_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    status: Mapped[MembershipStatus] = mapped_column(
        SqlEnum(MembershipStatus),
        default=MembershipStatus.PENDING,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    classroom = relationship(
        "Classroom",
        back_populates="students",
    )


class ClassroomTeacher(Base):
    __tablename__ = "classroom_teachers"
    __table_args__ = (
        UniqueConstraint(
            "classroom_id",
            "teacher_id",
            "subject_label",
            name="uq_classroom_teacher_subject",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True,
    )
    teacher_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    subject_id: Mapped[int | None] = mapped_column(
        ForeignKey("subjects.id"),
        nullable=True,
        index=True,
    )
    subject_label: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        default="GENERAL",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    classroom = relationship(
        "Classroom",
        back_populates="teachers",
    )


class ClassroomAnalyticsGrant(Base):
    """View-only analytics grant between classrooms.

    The *source* classroom's owner pasted the *viewer* classroom's share code,
    granting the viewer classroom's owner a read-only analytics tab for the
    source classroom. This never unlocks manage/course/assignment access.
    """

    __tablename__ = "classroom_analytics_grants"
    __table_args__ = (
        UniqueConstraint(
            "viewer_classroom_id",
            "source_classroom_id",
            name="uq_analytics_grant_viewer_source",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    viewer_classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True,
    )
    source_classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True,
    )
    granted_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class ClassroomAnnouncement(Base):
    __tablename__ = "classroom_announcements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True,
    )
    author_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    classroom = relationship(
        "Classroom",
        back_populates="announcements",
    )