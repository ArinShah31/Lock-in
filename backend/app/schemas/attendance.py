from datetime import date

from pydantic import BaseModel, Field


class AttendanceMark(BaseModel):
    student_id: int
    present: bool


class AttendanceSessionCreate(BaseModel):
    held_on: date
    title: str = Field(default="", max_length=200)
    marks: list[AttendanceMark]


class AttendanceSessionUpdate(BaseModel):
    held_on: date | None = None
    title: str | None = Field(default=None, max_length=200)
    marks: list[AttendanceMark] | None = None


class AttendanceSessionOut(BaseModel):
    id: int
    subject_id: int
    held_on: date
    title: str
    marks: list[AttendanceMark]


class AttendanceStudent(BaseModel):
    id: int
    full_name: str
    email: str


class SubjectAttendanceOut(BaseModel):
    subject_id: int
    subject_name: str
    subject_code: str
    can_edit: bool
    students: list[AttendanceStudent]
    sessions: list[AttendanceSessionOut]


class SubjectPercent(BaseModel):
    subject_id: int
    attended: int
    held: int
    percent: float | None


class StudentSummaryRow(BaseModel):
    student_id: int
    full_name: str
    email: str
    subjects: list[SubjectPercent]
    final_percent: float | None


class SummarySubject(BaseModel):
    id: int
    name: str
    code: str


class AttendanceSummaryOut(BaseModel):
    subjects: list[SummarySubject]
    rows: list[StudentSummaryRow]


class MyLecture(BaseModel):
    session_id: int
    held_on: date
    title: str
    present: bool


class MySubjectAttendance(BaseModel):
    subject_id: int
    subject_name: str
    subject_code: str
    attended: int
    held: int
    percent: float | None
    lectures: list[MyLecture]


class MyAttendanceOut(BaseModel):
    subjects: list[MySubjectAttendance]
    final_percent: float | None
