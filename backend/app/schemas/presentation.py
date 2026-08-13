from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.presentation import PresentationStatus


class SlideShapeOut(BaseModel):
    index: int
    text: str
    x: float
    y: float
    w: float
    h: float
    kind: str = "text"


class SlideCueOut(BaseModel):
    start_ms: float
    end_ms: float
    text: str
    shape_index: int | None = None


class PresentationSlideOut(BaseModel):
    id: int
    presentation_id: int
    index: int
    extracted_text: str
    script: str
    duration_ms: float
    has_audio: bool
    has_image: bool
    shapes: list[SlideShapeOut] = Field(default_factory=list)
    cues: list[SlideCueOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class PresentationOut(BaseModel):
    id: int
    classroom_id: int
    uploaded_by: int
    title: str
    file_name: str
    status: PresentationStatus
    error_message: str | None = None
    progress_message: str | None = None
    slide_count: int = 0
    has_video: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CaptionCueOut(BaseModel):
    start_ms: float
    end_ms: float
    text: str


class PresentationDetailOut(PresentationOut):
    slides: list[PresentationSlideOut] = Field(default_factory=list)
    caption_cues: list[CaptionCueOut] = Field(default_factory=list)


class SlideScriptPatch(BaseModel):
    script: str = Field(min_length=1, max_length=8000)
