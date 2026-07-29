from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class SubjectCreate(BaseModel):
    classroom_id: int
    teacher_id: int
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(min_length=2, max_length=50)
    description: str | None = None


class SubjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    description: str | None = None
    teacher_id: int | None = None
    is_published: bool | None = None
    is_active: bool | None = None


class SyllabusUpdate(BaseModel):
    syllabus_text: str | None = None
    syllabus_file_url: str | None = Field(default=None, max_length=500)


class SubjectOut(BaseModel):
    id: int
    classroom_id: int
    teacher_id: int
    name: str
    code: str
    description: str | None
    syllabus_text: str | None
    syllabus_file_url: str | None
    is_published: bool
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SubjectMaterialCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    material_type: str = Field(default="NOTE", max_length=50)
    file_url: str | None = Field(default=None, max_length=500)
    content_text: str | None = None


class SubjectMaterialOut(BaseModel):
    id: int
    subject_id: int
    uploaded_by: int
    title: str
    material_type: str
    file_url: str | None
    content_text: str | None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
