from datetime import datetime

from pydantic import BaseModel


class StreakBreakOut(BaseModel):
    reason: str
    title: str
    occurred_at: datetime


class StudentStreakOut(BaseModel):
    streak: int
    last_break: StreakBreakOut | None = None
