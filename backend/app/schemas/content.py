from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.content import ContentType


class ContentCreate(BaseModel):
    title: str = Field(min_length=2, max_length=255)
    description: str | None = None
    content_type: ContentType


class ContentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=255)
    description: str | None = None
    display_order: int | None = None
    is_active: bool | None = None


class ContentOut(BaseModel):
    id: int
    classroom_id: int
    uploaded_by: int

    title: str
    description: str | None

    content_type: ContentType

    file_name: str
    file_path: str
    external_url: str | None

    file_size: int
    mime_type: str

    display_order: int
    is_active: bool

    created_at: datetime

    model_config = ConfigDict(from_attributes=True)