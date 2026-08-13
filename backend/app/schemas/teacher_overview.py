from datetime import datetime

from pydantic import BaseModel, ConfigDict


class TeacherOverviewStatsOut(BaseModel):
    students: int
    students_joined_this_week: int
    documents: int
    documents_added_this_week: int
    assignments: int
    assignments_needing_review: int
    classrooms: int

    model_config = ConfigDict(from_attributes=True)


class TeacherAttentionItemOut(BaseModel):
    kind: str
    label: str
    count: int
    classroom_id: int | None = None
    classroom_name: str | None = None
    to: str | None = None

    model_config = ConfigDict(from_attributes=True)


class TeacherActivityItemOut(BaseModel):
    kind: str
    description: str
    classroom_id: int
    classroom_name: str
    occurred_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TeacherWeeklyActivityDayOut(BaseModel):
    date: str
    assignment_submissions: int
    practice_attempts: int

    model_config = ConfigDict(from_attributes=True)


class TeacherStrugglingTopicOut(BaseModel):
    classroom_id: int
    classroom_name: str
    topic_label: str
    average_score: float
    attempt_count: int

    model_config = ConfigDict(from_attributes=True)


class TeacherClassroomCardOut(BaseModel):
    classroom_id: int
    name: str
    code: str
    join_code: str
    is_active: bool
    student_count: int
    document_count: int
    assignment_count: int
    last_activity_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class TeacherOverviewOut(BaseModel):
    stats: TeacherOverviewStatsOut
    attention: list[TeacherAttentionItemOut]
    recent_activity: list[TeacherActivityItemOut]
    weekly_activity: list[TeacherWeeklyActivityDayOut]
    struggling_topics: list[TeacherStrugglingTopicOut]
    classrooms: list[TeacherClassroomCardOut]

    model_config = ConfigDict(from_attributes=True)
