"""Assemble role-aware profile payloads from authoritative backend data."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.classroom_course import CourseChapterAttempt, MockExamAttempt
from app.models.institution import Department, Institution
from app.models.user import User, UserRole
from app.services.achievements import (
    ACHIEVEMENT_DEFS,
    TEACHER_MILESTONE_DEFS,
    build_achievements,
    student_achievement_facts,
    teacher_milestone_facts,
)
from app.services.streak import compute_streak, to_utc_date
from app.services.teacher_overview import build_teacher_overview

TEACHER_ROLES = {
    UserRole.SUPER_ADMIN,
    UserRole.INSTITUTION_ADMIN,
    UserRole.HOD,
    UserRole.CLASS_TEACHER,
    UserRole.SUBJECT_TEACHER,
}


def _identity_block(db: Session, user: User) -> dict:
    institution_name = None
    department_name = None
    if user.institution_id:
        institution = db.query(Institution).filter(Institution.id == user.institution_id).first()
        institution_name = institution.name if institution else None
    if user.department_id:
        department = db.query(Department).filter(Department.id == user.department_id).first()
        department_name = department.name if department else None

    return {
        "id": user.id,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role.value,
        "avatar_url": user.avatar_url,
        "institution_name": institution_name,
        "department_name": department_name,
        "is_google_account": bool(user.google_sub),
    }


def _student_classroom_ids(db: Session, user_id: int) -> list[tuple[int, str]]:
    rows = (
        db.query(ClassroomStudent.classroom_id, Classroom.name)
        .join(Classroom, Classroom.id == ClassroomStudent.classroom_id)
        .filter(
            ClassroomStudent.student_id == user_id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
            Classroom.is_active.is_(True),
        )
        .all()
    )
    return [(row.classroom_id, row.name) for row in rows]


def _collect_student_activity_dates(db: Session, user_id: int, classroom_ids: list[int]) -> set[date]:
    dates: set[date] = set()

    submission_rows = (
        db.query(AssignmentSubmission.submitted_at)
        .filter(AssignmentSubmission.student_id == user_id)
        .all()
    )
    for row in submission_rows:
        dates.add(to_utc_date(row.submitted_at))

    if classroom_ids:
        attempt_rows = (
            db.query(CourseChapterAttempt.created_at)
            .filter(
                CourseChapterAttempt.user_id == user_id,
                CourseChapterAttempt.classroom_id.in_(classroom_ids),
            )
            .all()
        )
        for row in attempt_rows:
            dates.add(to_utc_date(row.created_at))

        mock_rows = (
            db.query(MockExamAttempt.submitted_at)
            .filter(
                MockExamAttempt.student_id == user_id,
                MockExamAttempt.classroom_id.in_(classroom_ids),
            )
            .all()
        )
        for row in mock_rows:
            dates.add(to_utc_date(row.submitted_at))

    return dates


def _student_recent_activity(db: Session, user_id: int, classroom_ids: list[int], limit: int = 12) -> list[dict]:
    events: list[tuple[datetime, dict]] = []

    submissions = (
        db.query(AssignmentSubmission, Assignment, Classroom.name)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .join(Classroom, Classroom.id == Assignment.classroom_id)
        .filter(AssignmentSubmission.student_id == user_id)
        .all()
    )
    for submission, assignment, classroom_name in submissions:
        events.append(
            (
                submission.submitted_at,
                {
                    "kind": "assignment_submitted",
                    "title": f"Submitted {assignment.title}",
                    "subtitle": classroom_name,
                    "occurred_at": submission.submitted_at,
                },
            )
        )

    if classroom_ids:
        attempts = (
            db.query(CourseChapterAttempt, Classroom.name)
            .join(Classroom, Classroom.id == CourseChapterAttempt.classroom_id)
            .filter(
                CourseChapterAttempt.user_id == user_id,
                CourseChapterAttempt.classroom_id.in_(classroom_ids),
            )
            .all()
        )
        for attempt, classroom_name in attempts:
            label = {
                "QUIZ": "Completed quiz",
                "SCENARIO": "Completed scenario",
                "ASSESSMENT_TOPIC": "Completed topic assessment",
                "ASSESSMENT_SUBJECT": "Completed subject assessment",
            }.get(attempt.attempt_type, "Completed practice")
            events.append(
                (
                    attempt.created_at,
                    {
                        "kind": attempt.attempt_type.lower(),
                        "title": label,
                        "subtitle": classroom_name,
                        "occurred_at": attempt.created_at,
                    },
                )
            )

        mock_attempts = (
            db.query(MockExamAttempt, Classroom.name)
            .join(Classroom, Classroom.id == MockExamAttempt.classroom_id)
            .filter(
                MockExamAttempt.student_id == user_id,
                MockExamAttempt.classroom_id.in_(classroom_ids),
            )
            .all()
        )
        for attempt, classroom_name in mock_attempts:
            events.append(
                (
                    attempt.submitted_at,
                    {
                        "kind": "mock_exam",
                        "title": "Submitted mock exam",
                        "subtitle": classroom_name,
                        "occurred_at": attempt.submitted_at,
                    },
                )
            )

    events.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in events[:limit]]


def _student_learning_progress(db: Session, user_id: int, classrooms: list[tuple[int, str]]) -> list[dict]:
    progress: list[dict] = []
    for classroom_id, classroom_name in classrooms:
        assignments = (
            db.query(Assignment.id)
            .filter(Assignment.classroom_id == classroom_id, Assignment.is_active.is_(True))
            .all()
        )
        total = len(assignments)
        if total == 0:
            continue
        assignment_ids = [row.id for row in assignments]
        completed = (
            db.query(AssignmentSubmission.id)
            .filter(
                AssignmentSubmission.student_id == user_id,
                AssignmentSubmission.assignment_id.in_(assignment_ids),
            )
            .count()
        )
        progress.append(
            {
                "classroom_id": classroom_id,
                "classroom_name": classroom_name,
                "completed_assignments": completed,
                "total_assignments": total,
                "progress_pct": round((completed / total) * 100, 1) if total else None,
            }
        )
    return progress


def _student_academic_overview(db: Session, user_id: int, classrooms: list[tuple[int, str]], streak: dict) -> dict:
    classroom_ids = [row[0] for row in classrooms]
    submissions = (
        db.query(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .filter(AssignmentSubmission.student_id == user_id)
        .all()
    )
    completed = len(submissions)
    graded_scores: list[float] = []
    for submission, assignment in submissions:
        if submission.marks is not None and assignment.max_marks > 0:
            graded_scores.append((submission.marks / assignment.max_marks) * 100)

    average_score_pct = round(sum(graded_scores) / len(graded_scores), 1) if graded_scores else None

    return {
        "classrooms": len(classrooms),
        "assignments_completed": completed,
        "average_score_pct": average_score_pct,
        "streak": streak,
    }


def _student_has_perfect_score(db: Session, user_id: int, classroom_ids: list[int]) -> bool:
    for submission, assignment in (
        db.query(AssignmentSubmission, Assignment)
        .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
        .filter(AssignmentSubmission.student_id == user_id, AssignmentSubmission.marks.isnot(None))
        .all()
    ):
        if assignment.max_marks > 0 and submission.marks >= assignment.max_marks:
            return True

    if classroom_ids:
        perfect_attempt = (
            db.query(CourseChapterAttempt.id)
            .filter(
                CourseChapterAttempt.user_id == user_id,
                CourseChapterAttempt.classroom_id.in_(classroom_ids),
                CourseChapterAttempt.score >= 100,
            )
            .first()
        )
        if perfect_attempt:
            return True
    return False


def _student_quiz_count(db: Session, user_id: int, classroom_ids: list[int]) -> int:
    if not classroom_ids:
        return 0
    return (
        db.query(CourseChapterAttempt.id)
        .filter(
            CourseChapterAttempt.user_id == user_id,
            CourseChapterAttempt.classroom_id.in_(classroom_ids),
            CourseChapterAttempt.attempt_type == "QUIZ",
        )
        .count()
    )


def build_student_profile(db: Session, user: User) -> dict:
    classrooms = _student_classroom_ids(db, user.id)
    classroom_ids = [row[0] for row in classrooms]
    active_dates = _collect_student_activity_dates(db, user.id, classroom_ids)
    streak = compute_streak(active_dates)
    best_streak = streak["best_streak"]
    quiz_count = _student_quiz_count(db, user.id, classroom_ids)
    facts = student_achievement_facts(
        best_streak=best_streak,
        quiz_count=quiz_count,
        has_perfect_score=_student_has_perfect_score(db, user.id, classroom_ids),
    )

    return {
        "academic_overview": _student_academic_overview(db, user.id, classrooms, streak),
        "achievements": build_achievements(ACHIEVEMENT_DEFS, facts),
        "recent_activity": _student_recent_activity(db, user.id, classroom_ids),
        "learning_progress": _student_learning_progress(db, user.id, classrooms),
    }


def build_teacher_profile(db: Session, user: User) -> dict:
    overview = build_teacher_overview(db, user)
    stats = overview["stats"]
    recent = overview.get("recent_activity") or []
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    has_recent = any(item["occurred_at"] >= week_ago for item in recent)

    facts = teacher_milestone_facts(
        classrooms=stats["classrooms"],
        documents=stats["documents"],
        assignments=stats["assignments"],
        has_recent_activity=has_recent,
    )

    insights: list[dict] = []
    for item in overview.get("attention") or []:
        insights.append(
            {
                "kind": item["kind"],
                "label": item["label"],
                "count": item["count"],
                "classroom_id": item.get("classroom_id"),
                "classroom_name": item.get("classroom_name"),
                "to": item.get("to"),
            }
        )
    for topic in overview.get("struggling_topics") or []:
        insights.append(
            {
                "kind": "struggling_topic",
                "label": f"{int(round(100 - topic['average_score']))}% of students struggled with {topic['topic_label']}",
                "count": topic["attempt_count"],
                "classroom_id": topic["classroom_id"],
                "classroom_name": topic["classroom_name"],
                "to": f"/classrooms/{topic['classroom_id']}/practice",
            }
        )

    submissions_count = 0
    classroom_ids = [card["classroom_id"] for card in overview.get("classrooms") or []]
    if classroom_ids:
        submissions_count = (
            db.query(AssignmentSubmission.id)
            .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
            .filter(Assignment.classroom_id.in_(classroom_ids))
            .count()
        )

    avg_score = None
    if classroom_ids:
        graded = (
            db.query(AssignmentSubmission.marks, Assignment.max_marks)
            .join(Assignment, Assignment.id == AssignmentSubmission.assignment_id)
            .filter(
                Assignment.classroom_id.in_(classroom_ids),
                AssignmentSubmission.marks.isnot(None),
            )
            .all()
        )
        scores = [(marks / max_marks) * 100 for marks, max_marks in graded if max_marks > 0 and marks is not None]
        if scores:
            avg_score = round(sum(scores) / len(scores), 1)

    recent_activity = [
        {
            "kind": item["kind"],
            "title": item["description"],
            "subtitle": item["classroom_name"],
            "occurred_at": item["occurred_at"],
        }
        for item in (overview.get("recent_activity") or [])
    ]

    return {
        "teaching_overview": {
            "classrooms": stats["classrooms"],
            "students": stats["students"],
            "assignments": stats["assignments"],
            "documents": stats["documents"],
            "submissions": submissions_count,
            "average_score_pct": avg_score,
            "assignments_needing_review": stats["assignments_needing_review"],
        },
        "classrooms": overview.get("classrooms") or [],
        "insights": insights,
        "recent_activity": recent_activity,
        "milestones": build_achievements(TEACHER_MILESTONE_DEFS, facts),
    }


def build_user_profile(db: Session, user: User) -> dict:
    payload: dict = {"identity": _identity_block(db, user), "student": None, "teacher": None}
    if user.role == UserRole.STUDENT:
        payload["student"] = build_student_profile(db, user)
    elif user.role in TEACHER_ROLES:
        payload["teacher"] = build_teacher_profile(db, user)
    return payload
