from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SqlEnum,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class ContentType(str, Enum):
    PDF = "PDF"
    DOCUMENT = "DOCUMENT"
    PRESENTATION = "PRESENTATION"
    IMAGE = "IMAGE"
    VIDEO = "VIDEO"
    LINK = "LINK"
    ASSIGNMENT = "ASSIGNMENT"
    OTHER = "OTHER"


class ClassroomContent(Base):
    __tablename__ = "classroom_contents"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)

    classroom_id: Mapped[int] = mapped_column(
        ForeignKey("classrooms.id"),
        nullable=False,
        index=True,
    )

    uploaded_by: Mapped[int] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
        index=True,
    )

    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    content_type: Mapped[ContentType] = mapped_column(
        SqlEnum(ContentType),
        nullable=False,
    )

    file_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    stored_name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        unique=True,
    )

    file_path: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    external_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    file_size: Mapped[int] = mapped_column(
        nullable=False,
    )

    mime_type: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        nullable=False,
    )

    display_order: Mapped[int] = mapped_column(
        default=0,
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    classroom = relationship(
        "Classroom",
        back_populates="contents",
    )

    uploader = relationship(
        "User",
    )