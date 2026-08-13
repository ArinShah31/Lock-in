from pydantic import BaseModel, ConfigDict


class LeaderboardEntryOut(BaseModel):
    rank: int
    student_id: int
    full_name: str
    initials: str
    avatar_url: str | None = None
    quiz_points: int
    exam_points: int
    coding_points: int
    total_points: int

    model_config = ConfigDict(from_attributes=True)


class LeaderboardViewerOut(BaseModel):
    rank: int | None = None
    total_points: int
    students_count: int

    model_config = ConfigDict(from_attributes=True)


class ClassroomLeaderboardOut(BaseModel):
    entries: list[LeaderboardEntryOut]
    viewer: LeaderboardViewerOut | None = None

    model_config = ConfigDict(from_attributes=True)
