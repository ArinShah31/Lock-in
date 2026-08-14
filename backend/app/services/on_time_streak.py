from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy.orm import Session

from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.classroom_course import (
    ClassroomCourse,
    CourseChapterAttempt,
    MockExam,
    MockExamAttempt,
    PracticeAssessmentLock,
)
from app.models.user import User
from app.services.coding_streak import fetch_coding_streak_items

DEFAULT_DUE_DAYS = 2
ASSESSMENT_KIND_TOPIC = "TOPIC"
ASSESSMENT_KIND_SUBJECT = "SUBJECT"
SUBJECT_TARGET_KEY = "subject"


class StreakOutcome(str, Enum):
    ON_TIME = "on_time"
    LATE = "late"
    MISSED = "missed"
    PENDING = "pending"


@dataclass(frozen=True)
class StreakWorkItem:
    key: str
    title: str
    available_at: datetime
    due_at: datetime
    completed_at: datetime | None = None
    force_late: bool = False


@dataclass(frozen=True)
class StreakBreak:
    reason: str
    title: str
    occurred_at: datetime


def normalize_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def default_due_at(available_at: datetime) -> datetime:
    return normalize_utc(available_at) + timedelta(days=DEFAULT_DUE_DAYS)


def classify_item(item: StreakWorkItem, now: datetime) -> StreakOutcome:
    due = normalize_utc(item.due_at)
    current = normalize_utc(now)
    if current < due:
        return StreakOutcome.PENDING
    if item.completed_at is None:
        return StreakOutcome.MISSED
    if item.force_late:
        return StreakOutcome.LATE
    completed = normalize_utc(item.completed_at)
    if completed > due:
        return StreakOutcome.LATE
    return StreakOutcome.ON_TIME


def compute_on_time_streak(
    items: list[StreakWorkItem],
    now: datetime | None = None,
) -> tuple[int, StreakBreak | None]:
    current = normalize_utc(now or datetime.now(timezone.utc))
    sorted_items = sorted(items, key=lambda item: normalize_utc(item.due_at))

    streak = 0
    last_break: StreakBreak | None = None

    for item in sorted_items:
        outcome = classify_item(item, current)
        if outcome == StreakOutcome.PENDING:
            continue
        if outcome == StreakOutcome.ON_TIME:
            streak += 1
            continue

        streak = 0
        occurred_at = normalize_utc(item.due_at)
        if outcome == StreakOutcome.LATE and item.completed_at is not None:
            occurred_at = normalize_utc(item.completed_at)
        last_break = StreakBreak(
            reason=outcome.value,
            title=item.title,
            occurred_at=occurred_at,
        )

    return streak, last_break


def _student_classroom_ids(db: Session, student_id: int) -> list[int]:
    rows = (
        db.query(ClassroomStudent.classroom_id)
        .filter(
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
        )
        .all()
    )
    if not rows:
        return []
    classroom_ids = [row[0] for row in rows]
    active = (
        db.query(Classroom.id)
        .filter(Classroom.id.in_(classroom_ids), Classroom.is_active.is_(True))
        .all()
    )
    return [row[0] for row in active]


def _latest_attempt_map(
    db: Session,
    *,
    classroom_id: int,
    user_id: int,
    attempt_type: str,
) -> dict[str, CourseChapterAttempt]:
    rows = (
        db.query(CourseChapterAttempt)
        .filter(
            CourseChapterAttempt.classroom_id == classroom_id,
            CourseChapterAttempt.user_id == user_id,
            CourseChapterAttempt.attempt_type == attempt_type,
        )
        .order_by(CourseChapterAttempt.created_at.desc(), CourseChapterAttempt.id.desc())
        .all()
    )
    latest: dict[str, CourseChapterAttempt] = {}
    for row in rows:
        if attempt_type == "QUIZ":
            key = str(row.chapter_number)
        elif attempt_type == "SCENARIO":
            key = str(row.payload.get("scenario_id") or "")
        else:
            key = str(row.payload.get("target_key") or row.chapter_number)
        latest.setdefault(key, row)
    return latest


def _collect_assignment_items(db: Session, student_id: int, classroom_ids: list[int]) -> list[StreakWorkItem]:
    if not classroom_ids:
        return []

    assignments = (
        db.query(Assignment)
        .filter(
            Assignment.classroom_id.in_(classroom_ids),
            Assignment.is_active.is_(True),
        )
        .all()
    )
    if not assignments:
        return []

    assignment_ids = [assignment.id for assignment in assignments]
    submissions = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id.in_(assignment_ids),
            AssignmentSubmission.student_id == student_id,
        )
        .all()
    )
    submission_by_assignment = {row.assignment_id: row for row in submissions}

    items: list[StreakWorkItem] = []
    for assignment in assignments:
        submission = submission_by_assignment.get(assignment.id)
        completed_at = submission.submitted_at if submission else None
        force_late = bool(submission and submission.is_late)

        items.append(
            StreakWorkItem(
                key=f"assignment:{assignment.id}",
                title=assignment.title,
                available_at=normalize_utc(assignment.created_at),
                due_at=normalize_utc(assignment.due_at),
                completed_at=completed_at,
                force_late=force_late,
            )
        )
    return items


def _collect_practice_items(
    db: Session,
    student_id: int,
    classroom_ids: list[int],
) -> list[StreakWorkItem]:
    items: list[StreakWorkItem] = []

    for classroom_id in classroom_ids:
        course = (
            db.query(ClassroomCourse)
            .filter(
                ClassroomCourse.classroom_id == classroom_id,
                ClassroomCourse.is_active.is_(True),
                ClassroomCourse.is_published.is_(True),
            )
            .first()
        )
        if not course:
            continue

        available_at = normalize_utc(course.updated_at or course.created_at)
        quiz_attempts = _latest_attempt_map(
            db,
            classroom_id=classroom_id,
            user_id=student_id,
            attempt_type="QUIZ",
        )
        scenario_attempts = _latest_attempt_map(
            db,
            classroom_id=classroom_id,
            user_id=student_id,
            attempt_type="SCENARIO",
        )
        topic_attempts = _latest_attempt_map(
            db,
            classroom_id=classroom_id,
            user_id=student_id,
            attempt_type="ASSESSMENT_TOPIC",
        )
        subject_attempts = _latest_attempt_map(
            db,
            classroom_id=classroom_id,
            user_id=student_id,
            attempt_type="ASSESSMENT_SUBJECT",
        )

        lock_rows = (
            db.query(PracticeAssessmentLock)
            .filter(
                PracticeAssessmentLock.classroom_id == classroom_id,
                PracticeAssessmentLock.is_unlocked.is_(True),
            )
            .all()
        )
        unlocked_at: dict[tuple[str, str], datetime] = {
            (row.assessment_kind.upper(), row.target_key): normalize_utc(row.updated_at)
            for row in lock_rows
        }

        chapters = list((course.content or {}).get("chapters") or [])
        for chapter in chapters:
            if not isinstance(chapter, dict):
                continue
            chapter_number = int(chapter.get("chapter") or 0)
            chapter_title = str(chapter.get("title") or f"Chapter {chapter_number}").strip()
            chapter_quiz = [item for item in (chapter.get("quiz") or []) if isinstance(item, dict)]
            if chapter_quiz:
                attempt = quiz_attempts.get(str(chapter_number))
                items.append(
                    StreakWorkItem(
                        key=f"quiz:{classroom_id}:{chapter_number}",
                        title=f"{chapter_title} Quiz",
                        available_at=available_at,
                        due_at=default_due_at(available_at),
                        completed_at=attempt.created_at if attempt else None,
                    )
                )

            scenarios_raw = [item for item in (chapter.get("scenarios") or []) if isinstance(item, dict)]
            for scenario_index, scenario in enumerate(scenarios_raw, start=1):
                scenario_id = str(scenario.get("id") or f"chapter-{chapter_number}-scenario-{scenario_index}").strip()
                scenario_title = str(scenario.get("title") or f"Scenario {scenario_index}").strip()
                if not scenario_id or not scenario_title:
                    continue
                attempt = scenario_attempts.get(scenario_id)
                items.append(
                    StreakWorkItem(
                        key=f"scenario:{classroom_id}:{scenario_id}",
                        title=scenario_title,
                        available_at=available_at,
                        due_at=default_due_at(available_at),
                        completed_at=attempt.created_at if attempt else None,
                    )
                )

            if chapter_quiz:
                topic_key = (ASSESSMENT_KIND_TOPIC, str(chapter_number))
                if topic_key in unlocked_at:
                    attempt = topic_attempts.get(str(chapter_number))
                    topic_available = unlocked_at[topic_key]
                    items.append(
                        StreakWorkItem(
                            key=f"assessment-topic:{classroom_id}:{chapter_number}",
                            title=f"{chapter_title} Assessment",
                            available_at=topic_available,
                            due_at=default_due_at(topic_available),
                            completed_at=attempt.created_at if attempt else None,
                        )
                    )

        subject_key = (ASSESSMENT_KIND_SUBJECT, SUBJECT_TARGET_KEY)
        if subject_key in unlocked_at and chapters:
            attempt = subject_attempts.get(SUBJECT_TARGET_KEY)
            subject_available = unlocked_at[subject_key]
            classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
            classroom_name = classroom.name if classroom else "Classroom"
            items.append(
                StreakWorkItem(
                    key=f"assessment-subject:{classroom_id}",
                    title=f"{classroom_name} Full Revision Assessment",
                    available_at=subject_available,
                    due_at=default_due_at(subject_available),
                    completed_at=attempt.created_at if attempt else None,
                )
            )

    return items


def _collect_mock_exam_items(db: Session, student_id: int, classroom_ids: list[int]) -> list[StreakWorkItem]:
    if not classroom_ids:
        return []

    exams = (
        db.query(MockExam)
        .filter(
            MockExam.classroom_id.in_(classroom_ids),
            MockExam.status == "PUBLISHED",
        )
        .all()
    )
    if not exams:
        return []

    exam_ids = [exam.id for exam in exams]
    attempts = (
        db.query(MockExamAttempt)
        .filter(
            MockExamAttempt.mock_exam_id.in_(exam_ids),
            MockExamAttempt.student_id == student_id,
        )
        .order_by(MockExamAttempt.submitted_at.desc(), MockExamAttempt.id.desc())
        .all()
    )
    latest_attempt: dict[int, MockExamAttempt] = {}
    for attempt in attempts:
        latest_attempt.setdefault(attempt.mock_exam_id, attempt)

    items: list[StreakWorkItem] = []
    for exam in exams:
        available_at = normalize_utc(exam.updated_at or exam.created_at)
        attempt = latest_attempt.get(exam.id)
        items.append(
            StreakWorkItem(
                key=f"mock-exam:{exam.id}",
                title=exam.title,
                available_at=available_at,
                due_at=default_due_at(available_at),
                completed_at=attempt.submitted_at if attempt else None,
            )
        )
    return items


def _collect_coding_items(email: str) -> list[StreakWorkItem]:
    rows = fetch_coding_streak_items(email)
    items: list[StreakWorkItem] = []
    for row in rows:
        available_at = normalize_utc(row.available_at)
        items.append(
            StreakWorkItem(
                key=row.key,
                title=row.title,
                available_at=available_at,
                due_at=default_due_at(available_at),
                completed_at=row.completed_at,
            )
        )
    return items


def collect_student_streak_items(db: Session, student: User) -> list[StreakWorkItem]:
    classroom_ids = _student_classroom_ids(db, student.id)
    items: list[StreakWorkItem] = []
    items.extend(_collect_assignment_items(db, student.id, classroom_ids))
    items.extend(_collect_practice_items(db, student.id, classroom_ids))
    items.extend(_collect_mock_exam_items(db, student.id, classroom_ids))
    items.extend(_collect_coding_items(student.email))
    return items


def get_student_on_time_streak(db: Session, student: User) -> tuple[int, StreakBreak | None]:
    items = collect_student_streak_items(db, student)
    return compute_on_time_streak(items)
