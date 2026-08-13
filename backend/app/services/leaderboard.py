from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.models.classroom import ClassroomStudent, MembershipStatus
from app.models.classroom_course import CourseChapterAttempt, MockExam, MockExamAttempt
from app.models.user import User
from app.services.coding_leaderboard import fetch_coding_leaderboard_scores


def _initials(full_name: str) -> str:
    parts = [part for part in full_name.strip().split() if part]
    if not parts:
        return "?"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def _attempt_activity_key(attempt: CourseChapterAttempt) -> str:
    payload = attempt.payload or {}
    if attempt.attempt_type == "QUIZ":
        return f"quiz:{attempt.chapter_number}"
    if attempt.attempt_type == "SCENARIO":
        return f"scenario:{payload.get('scenario_id')}"
    if attempt.attempt_type in {"ASSESSMENT_TOPIC", "ASSESSMENT_SUBJECT"}:
        return f"assessment:{attempt.attempt_type}:{payload.get('target_key')}"
    return f"{attempt.attempt_type}:{attempt.chapter_number}"


def _latest_practice_scores(
    attempts: list[CourseChapterAttempt],
) -> dict[int, dict[str, CourseChapterAttempt]]:
    latest: dict[int, dict[str, CourseChapterAttempt]] = {}
    for attempt in attempts:
        user_attempts = latest.setdefault(attempt.user_id, {})
        key = _attempt_activity_key(attempt)
        existing = user_attempts.get(key)
        if existing is None or attempt.created_at > existing.created_at:
            user_attempts[key] = attempt
    return latest


@dataclass
class _StudentPoints:
    student_id: int
    full_name: str
    email: str
    avatar_url: str | None = None
    quiz_points: int = 0
    exam_points: int = 0
    coding_points: int = 0

    @property
    def total_points(self) -> int:
        return self.quiz_points + self.exam_points + self.coding_points


def build_classroom_leaderboard(
    db: Session,
    classroom_id: int,
    viewer_user_id: int | None = None,
    viewer_is_student: bool = False,
) -> dict:
    memberships = (
        db.query(ClassroomStudent, User)
        .join(User, User.id == ClassroomStudent.student_id)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.is_active.is_(True),
            ClassroomStudent.status == MembershipStatus.APPROVED,
        )
        .order_by(User.full_name)
        .all()
    )

    student_rows: dict[int, _StudentPoints] = {
        student.id: _StudentPoints(
            student_id=student.id,
            full_name=student.full_name,
            email=student.email,
            avatar_url=student.avatar_url,
        )
        for _, student in memberships
    }

    if not student_rows:
        viewer = None
        if viewer_is_student and viewer_user_id is not None:
            viewer = {"rank": None, "total_points": 0, "students_count": 0}
        return {"entries": [], "viewer": viewer}

    student_ids = list(student_rows.keys())

    practice_attempts = (
        db.query(CourseChapterAttempt)
        .filter(
            CourseChapterAttempt.classroom_id == classroom_id,
            CourseChapterAttempt.user_id.in_(student_ids),
            CourseChapterAttempt.attempt_type.in_(
                ("QUIZ", "SCENARIO", "ASSESSMENT_TOPIC", "ASSESSMENT_SUBJECT")
            ),
        )
        .all()
    )
    latest_by_student = _latest_practice_scores(practice_attempts)
    for user_id, activities in latest_by_student.items():
        row = student_rows.get(user_id)
        if not row:
            continue
        for attempt in activities.values():
            if attempt.score is not None:
                row.quiz_points += round(attempt.score)

    published_exam_ids = [
        exam_id
        for (exam_id,) in db.query(MockExam.id)
        .filter(MockExam.classroom_id == classroom_id, MockExam.status == "PUBLISHED")
        .all()
    ]
    if published_exam_ids:
        exam_marks = {
            exam.id: exam.total_marks
            for exam in db.query(MockExam).filter(MockExam.id.in_(published_exam_ids)).all()
        }
        mock_attempts = (
            db.query(MockExamAttempt)
            .filter(
                MockExamAttempt.classroom_id == classroom_id,
                MockExamAttempt.student_id.in_(student_ids),
                MockExamAttempt.mock_exam_id.in_(published_exam_ids),
                MockExamAttempt.total_score.isnot(None),
            )
            .order_by(MockExamAttempt.submitted_at.asc())
            .all()
        )
        latest_mock: dict[tuple[int, int], MockExamAttempt] = {}
        for attempt in mock_attempts:
            latest_mock[(attempt.student_id, attempt.mock_exam_id)] = attempt
        for (user_id, exam_id), attempt in latest_mock.items():
            row = student_rows.get(user_id)
            if not row:
                continue
            total_marks = exam_marks.get(exam_id) or 0
            if total_marks > 0 and attempt.total_score is not None:
                row.exam_points += round((attempt.total_score / total_marks) * 100)

    coding_by_email = fetch_coding_leaderboard_scores([row.email for row in student_rows.values()])
    for row in student_rows.values():
        row.coding_points = coding_by_email.get(row.email.strip().lower(), 0)

    ranked = sorted(
        student_rows.values(),
        key=lambda row: (-row.total_points, row.full_name.lower()),
    )

    entries: list[dict] = []
    rank = 0
    last_points: int | None = None
    for index, row in enumerate(ranked, start=1):
        if last_points != row.total_points:
            rank = index
            last_points = row.total_points
        entries.append(
            {
                "rank": rank,
                "student_id": row.student_id,
                "full_name": row.full_name,
                "initials": _initials(row.full_name),
                "avatar_url": row.avatar_url,
                "quiz_points": row.quiz_points,
                "exam_points": row.exam_points,
                "coding_points": row.coding_points,
                "total_points": row.total_points,
            }
        )

    viewer = None
    if viewer_is_student and viewer_user_id is not None:
        viewer_entry = next((entry for entry in entries if entry["student_id"] == viewer_user_id), None)
        viewer = {
            "rank": viewer_entry["rank"] if viewer_entry else None,
            "total_points": viewer_entry["total_points"] if viewer_entry else 0,
            "students_count": len(entries),
        }

    return {"entries": entries, "viewer": viewer}
