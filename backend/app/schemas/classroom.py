from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.classroom import MembershipStatus


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
    join_code: str
    academic_year: str | None
    description: str | None
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class JoinClassroomRequest(BaseModel):
    join_code: str = Field(min_length=5, max_length=5, pattern=r"^[A-Za-z0-9]{5}$")


class ClassroomStudentOut(BaseModel):
    id: int
    classroom_id: int
    student_id: int
    status: MembershipStatus
    is_active: bool
    joined_at: datetime
    decided_at: datetime | None = None
    student_full_name: str | None = None
    student_email: str | None = None
    classroom_name: str | None = None
    classroom_code: str | None = None

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


class AnalyticsShareCodeOut(BaseModel):
    classroom_id: int
    analytics_share_code: str


class AnalyticsGrantCreate(BaseModel):
    viewer_code: str = Field(min_length=6, max_length=12)


class AnalyticsGrantOut(BaseModel):
    id: int
    viewer_classroom_id: int
    source_classroom_id: int
    granted_by_user_id: int
    is_active: bool
    created_at: datetime
    viewer_classroom_name: str | None = None
    viewer_classroom_code: str | None = None
    source_classroom_name: str | None = None
    source_classroom_code: str | None = None
    source_teacher_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class LinkedStudentAnalyticsOut(BaseModel):
    student_id: int
    full_name: str
    email: str
    assignments_submitted: int
    assignments_total: int
    average_score_pct: float | None = None
    last_submission_at: datetime | None = None


class SourceAnalyticsSummaryOut(BaseModel):
    source_classroom_id: int
    source_classroom_name: str
    source_classroom_code: str
    source_teacher_name: str | None = None
    student_count: int
    assignment_count: int
    course_published: bool
    average_completion_pct: float | None = None
    students: list[LinkedStudentAnalyticsOut]


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
