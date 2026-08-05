from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AssignmentOut(BaseModel):
    id: int
    classroom_id: int
    created_by: int
    title: str
    instructions: str | None
    max_marks: float
    due_at: datetime
    file_name: str | None
    file_path: str | None
    file_size: int | None
    mime_type: str | None
    is_active: bool
    created_at: datetime
    submitted_count: int | None = None
    graded_count: int | None = None
    my_submission: "AssignmentSubmissionOut | None" = None

    model_config = ConfigDict(from_attributes=True)


class AssignmentSubmissionOut(BaseModel):
    id: int
    assignment_id: int
    student_id: int
    file_name: str
    file_path: str
    file_size: int
    mime_type: str
    submitted_at: datetime
    is_late: bool
    marks: float | None
    feedback: str | None
    graded_at: datetime | None
    graded_by: int | None
    student_full_name: str | None = None
    student_email: str | None = None
    is_graded: bool = False

    model_config = ConfigDict(from_attributes=True)


class GradeSubmissionRequest(BaseModel):
    marks: float = Field(ge=0)
    feedback: str | None = None


class StudentAssignmentFeedItem(AssignmentOut):
    """Cross-classroom assignment row for the student home tracker."""

    classroom_name: str
    is_overdue: bool = False


AssignmentOut.model_rebuild()
StudentAssignmentFeedItem.model_rebuild()
