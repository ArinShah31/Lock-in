from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ClassroomCreate(BaseModel):
    institution_id: int
    department_id: int | None = None
    class_teacher_id: int | None = None
    name: str = Field(min_length=2, max_length=200)
    code: str = Field(min_length=2, max_length=50)
    academic_year: str | None = Field(default=None, max_length=20)
    description: str | None = None


class ClassroomUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    code: str | None = Field(default=None, min_length=2, max_length=50)
    department_id: int | None = None
    academic_year: str | None = Field(default=None, max_length=20)
    description: str | None = None
    class_teacher_id: int | None = None
    is_active: bool | None = None


class ClassroomOut(BaseModel):
    id: int
    institution_id: int
    department_id: int | None
    class_teacher_id: int
    name: str
    code: str
    academic_year: str | None
    description: str | None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AddStudentRequest(BaseModel):
    student_id: int


class ClassroomStudentOut(BaseModel):
    id: int
    classroom_id: int
    student_id: int
    is_active: bool
    joined_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AssignTeacherRequest(BaseModel):
    teacher_id: int
    subject_label: str = Field(default="GENERAL", min_length=2, max_length=120)


class ClassroomTeacherOut(BaseModel):
    id: int
    classroom_id: int
    teacher_id: int
    subject_id: int | None = None
    subject_label: str
    is_active: bool

    model_config = ConfigDict(from_attributes=True)


class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    body: str = Field(min_length=1)


class AnnouncementOut(BaseModel):
    id: int
    classroom_id: int
    author_id: int
    title: str
    body: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
