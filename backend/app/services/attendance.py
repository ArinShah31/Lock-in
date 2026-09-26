"""Attendance percentage maths (pure, no DB access)."""

from collections.abc import Iterable, Mapping


def percent(attended: int, held: int) -> float | None:
    if held <= 0:
        return None
    return round(attended * 100.0 / held, 2)


def compute_student(
    subject_ids: Iterable[int],
    sessions_by_subject: Mapping[int, Iterable[int]],
    marks: Mapping[tuple[int, int], bool],
    student_id: int,
) -> tuple[dict[int, dict], float | None]:
    """Per-subject stats and the final average for one student.

    A lecture only counts for a student if a mark exists for them (students who
    joined after a lecture are not penalised). Subjects with no counted lectures
    are left out of the final average; the final % is the simple mean of the
    per-subject percentages.
    """
    per_subject: dict[int, dict] = {}
    percents: list[float] = []
    for sid in subject_ids:
        attended = held = 0
        for session_id in sessions_by_subject.get(sid, ()):
            mark = marks.get((session_id, student_id))
            if mark is None:
                continue
            held += 1
            if mark:
                attended += 1
        per_subject[sid] = {"attended": attended, "held": held, "percent": percent(attended, held)}
        if held:
            percents.append(attended * 100.0 / held)
    final = round(sum(percents) / len(percents), 2) if percents else None
    return per_subject, final


# ---------------------------------------------------------------------------
# DB snapshot helpers
# ---------------------------------------------------------------------------

from dataclasses import dataclass, field  # noqa: E402

from sqlalchemy.orm import Session  # noqa: E402

from app.models.attendance import AttendanceRecord, AttendanceSession  # noqa: E402
from app.models.classroom import ClassroomStudent, MembershipStatus  # noqa: E402
from app.models.subject import Subject  # noqa: E402
from app.models.user import User  # noqa: E402


@dataclass
class Snapshot:
    subjects: list[Subject]
    students: list[User]
    sessions: list[AttendanceSession]
    sessions_by_subject: dict[int, list[int]] = field(default_factory=dict)
    marks: dict[tuple[int, int], bool] = field(default_factory=dict)

    def student_stats(self, student_id: int) -> tuple[dict[int, dict], float | None]:
        return compute_student(
            [s.id for s in self.subjects], self.sessions_by_subject, self.marks, student_id
        )


def approved_students(db: Session, classroom_id: int) -> list[User]:
    return (
        db.query(User)
        .join(ClassroomStudent, ClassroomStudent.student_id == User.id)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
        )
        .order_by(User.full_name)
        .all()
    )


def load_snapshot(
    db: Session, classroom_id: int, subject_ids: set[int] | None = None
) -> Snapshot:
    q = db.query(Subject).filter(Subject.classroom_id == classroom_id, Subject.is_active.is_(True))
    if subject_ids is not None:
        q = q.filter(Subject.id.in_(subject_ids))
    subjects = q.order_by(Subject.name).all()
    ids = [s.id for s in subjects]
    sessions = (
        db.query(AttendanceSession)
        .filter(AttendanceSession.subject_id.in_(ids))
        .order_by(AttendanceSession.held_on, AttendanceSession.id)
        .all()
        if ids
        else []
    )
    snap = Snapshot(subjects=subjects, students=approved_students(db, classroom_id), sessions=sessions)
    for sess in sessions:
        snap.sessions_by_subject.setdefault(sess.subject_id, []).append(sess.id)
    if sessions:
        rows = (
            db.query(AttendanceRecord)
            .filter(AttendanceRecord.session_id.in_([s.id for s in sessions]))
            .all()
        )
        snap.marks = {(r.session_id, r.student_id): r.present for r in rows}
    return snap
