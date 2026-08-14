from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import UserRole


class UpdateMeRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)

    model_config = ConfigDict(extra="forbid")


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class WeekDateOut(BaseModel):
    date: str
    active: bool


class StreakOut(BaseModel):
    current_streak: int
    best_streak: int
    last_active_date: str | None
    week_dates: list[WeekDateOut]


class AchievementOut(BaseModel):
    id: str
    title: str
    description: str
    unlocked: bool
    unlocked_at: str | None = None


class ActivityOut(BaseModel):
    kind: str
    title: str
    subtitle: str
    occurred_at: datetime


class StudentProgressOut(BaseModel):
    classroom_id: int
    classroom_name: str
    completed_assignments: int
    total_assignments: int
    progress_pct: float | None


class StudentAcademicOverviewOut(BaseModel):
    classrooms: int
    assignments_completed: int
    average_score_pct: float | None
    streak: StreakOut


class StudentProfileOut(BaseModel):
    academic_overview: StudentAcademicOverviewOut
    achievements: list[AchievementOut]
    recent_activity: list[ActivityOut]
    learning_progress: list[StudentProgressOut]


class TeachingOverviewOut(BaseModel):
    classrooms: int
    students: int
    assignments: int
    documents: int
    submissions: int
    average_score_pct: float | None
    assignments_needing_review: int


class TeacherInsightOut(BaseModel):
    kind: str
    label: str
    count: int
    classroom_id: int | None = None
    classroom_name: str | None = None
    to: str | None = None


class TeacherClassroomSummaryOut(BaseModel):
    classroom_id: int
    name: str
    code: str
    join_code: str
    is_active: bool
    student_count: int
    document_count: int
    assignment_count: int
    last_activity_at: datetime | None = None


class TeacherProfileOut(BaseModel):
    teaching_overview: TeachingOverviewOut
    classrooms: list[TeacherClassroomSummaryOut]
    insights: list[TeacherInsightOut]
    recent_activity: list[ActivityOut]
    milestones: list[AchievementOut]


class ProfileIdentityOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: UserRole
    avatar_url: str | None = None
    institution_name: str | None = None
    department_name: str | None = None
    is_google_account: bool


class ProfileOut(BaseModel):
    identity: ProfileIdentityOut
    student: StudentProfileOut | None = None
    teacher: TeacherProfileOut | None = None
