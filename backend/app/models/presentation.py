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
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class PresentationStatus(str, Enum):
    UPLOADED = "UPLOADED"
    PREPARING = "PREPARING"
    SCRIPTS_READY = "SCRIPTS_READY"
    AUDIO_READY = "AUDIO_READY"
    GENERATING = "GENERATING"
    VIDEO_READY = "VIDEO_READY"
    FAILED = "FAILED"


class ClassroomPresentation(Base):
    __tablename__ = "classroom_presentations"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    classroom_id: Mapped[int] = mapped_column(ForeignKey("classrooms.id"), nullable=False, index=True)
    uploaded_by: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    video_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[PresentationStatus] = mapped_column(
        SqlEnum(PresentationStatus),
        default=PresentationStatus.UPLOADED,
        nullable=False,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_message: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    slides = relationship(
        "PresentationSlide",
        back_populates="presentation",
        cascade="all, delete-orphan",
        order_by="PresentationSlide.index",
    )


class PresentationSlide(Base):
    __tablename__ = "presentation_slides"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    presentation_id: Mapped[int] = mapped_column(
        ForeignKey("classroom_presentations.id"),
        nullable=False,
        index=True,
    )
    index: Mapped[int] = mapped_column(Integer, nullable=False)
    extracted_text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    script: Mapped[str] = mapped_column(Text, nullable=False, default="")
    audio_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    shapes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    cues: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    presentation = relationship("ClassroomPresentation", back_populates="slides")
