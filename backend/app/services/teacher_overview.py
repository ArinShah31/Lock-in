from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.api.routes.classrooms import _user_can_view_classroom
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import (
    Classroom,
    ClassroomAnnouncement,
    ClassroomStudent,
    ClassroomTeacher,
    MembershipStatus,
)
from app.models.classroom_course import CourseChapterAttempt
from app.models.content import ClassroomContent
from app.models.user import User, UserRole


def get_viewable_classrooms(db: Session, user: User) -> list[Classroom]:
    query = db.query(Classroom).filter(Classroom.is_active.is_(True))
    if user.role == UserRole.SUPER_ADMIN:
        return query.order_by(Classroom.name).all()

    if user.institution_id is None:
        return []

    query = query.filter(Classroom.institution_id == user.institution_id)

    if user.role == UserRole.HOD:
        if user.department_id is not None:
            query = query.filter(
                (Classroom.department_id == user.department_id) | (Classroom.department_id.is_(None))
            )
        candidates = query.order_by(Classroom.name).all()
    elif user.role == UserRole.CLASS_TEACHER:
        candidates = query.filter(Classroom.class_teacher_id == user.id).order_by(Classroom.name).all()
    elif user.role == UserRole.SUBJECT_TEACHER:
        owned = query.filter(Classroom.class_teacher_id == user.id)
        linked_ids = [
            row.classroom_id
            for row in db.query(ClassroomTeacher.classroom_id)
            .filter(
                ClassroomTeacher.teacher_id == user.id,
                ClassroomTeacher.is_active.is_(True),
            )
            .all()
        ]
        if linked_ids:
            candidates = owned.union(query.filter(Classroom.id.in_(linked_ids))).order_by(Classroom.name).all()
        else:
            candidates = owned.order_by(Classroom.name).all()
    else:
        return []

    return [classroom for classroom in candidates if _user_can_view_classroom(db, user, classroom)]


def _week_ago() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=7)


def _day_key(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).date().isoformat()


def build_teacher_overview(db: Session, user: User) -> dict:
    classrooms = get_viewable_classrooms(db, user)
    classroom_ids = [c.id for c in classrooms]
    week_ago = _week_ago()

    if not classroom_ids:
        empty_stats = {
            "students": 0,
            "students_joined_this_week": 0,
            "documents": 0,
            "documents_added_this_week": 0,
            "assignments": 0,
            "assignments_needing_review": 0,
            "classrooms": 0,
        }
        return {
            "stats": empty_stats,
            "attention": [],
            "recent_activity": [],
            "weekly_activity": [],
            "struggling_topics": [],
            "classrooms": [],
        }

    memberships = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id.in_(classroom_ids),
            ClassroomStudent.is_active.is_(True),
            ClassroomStudent.status == MembershipStatus.APPROVED,
        )
        .all()
    )
    students_joined_week = sum(
        1
        for m in memberships
        if m.joined_at and (m.joined_at.replace(tzinfo=timezone.utc) if m.joined_at.tzinfo is None else m.joined_at) >= week_ago
    )

    documents = (
        db.query(ClassroomContent)
        .filter(
            ClassroomContent.classroom_id.in_(classroom_ids),
            ClassroomContent.is_active.is_(True),
        )
        .all()
    )
    docs_added_week = sum(
        1
        for d in documents
        if d.created_at and (d.created_at.replace(tzinfo=timezone.utc) if d.created_at.tzinfo is None else d.created_at) >= week_ago
    )

    assignments = (
        db.query(Assignment)
        .filter(Assignment.classroom_id.in_(classroom_ids), Assignment.is_active.is_(True))
        .all()
    )
    assignment_ids = [a.id for a in assignments]
    submissions: list[AssignmentSubmission] = []
    if assignment_ids:
        submissions = (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.assignment_id.in_(assignment_ids))
            .all()
        )

    needs_review = sum(1 for s in submissions if s.marks is None)

    pending_joins = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id.in_(classroom_ids),
            ClassroomStudent.is_active.is_(True),
            ClassroomStudent.status == MembershipStatus.PENDING,
        )
        .count()
    )

    classroom_by_id = {c.id: c for c in classrooms}
    attention: list[dict] = []
    if needs_review:
        attention.append(
            {
                "kind": "ungraded_submissions",
                "label": f"{needs_review} assignment submission{'s' if needs_review != 1 else ''} awaiting review",
                "count": needs_review,
                "classroom_id": None,
                "classroom_name": None,
                "to": f"/classrooms/{classrooms[0].id}/assignments" if classrooms else None,
            }
        )
    if pending_joins:
        attention.append(
            {
                "kind": "join_requests",
                "label": f"{pending_joins} student join request{'s' if pending_joins != 1 else ''}",
                "count": pending_joins,
                "classroom_id": None,
                "classroom_name": None,
                "to": f"/classrooms/{classrooms[0].id}/details" if classrooms else None,
            }
        )

    events: list[tuple[datetime, dict]] = []

    for membership in memberships:
        if membership.joined_at:
            joined = membership.joined_at
            if joined.tzinfo is None:
                joined = joined.replace(tzinfo=timezone.utc)
            classroom = classroom_by_id.get(membership.classroom_id)
            if classroom:
                events.append(
                    (
                        joined,
                        {
                            "kind": "student_joined",
                            "description": f"A student joined {classroom.name}",
                            "classroom_id": classroom.id,
                            "classroom_name": classroom.name,
                            "occurred_at": joined,
                        },
                    )
                )

    for doc in documents:
        created = doc.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        classroom = classroom_by_id.get(doc.classroom_id)
        if classroom:
            title = doc.title or doc.file_name or "Document"
            events.append(
                (
                    created,
                    {
                        "kind": "document_uploaded",
                        "description": f"{title} was uploaded to {classroom.name}",
                        "classroom_id": classroom.id,
                        "classroom_name": classroom.name,
                        "occurred_at": created,
                    },
                )
            )

    assignment_by_id = {a.id: a for a in assignments}
    for sub in submissions:
        submitted = sub.submitted_at
        if submitted.tzinfo is None:
            submitted = submitted.replace(tzinfo=timezone.utc)
        assignment = assignment_by_id.get(sub.assignment_id)
        if not assignment:
            continue
        classroom = classroom_by_id.get(assignment.classroom_id)
        if classroom:
            events.append(
                (
                    submitted,
                    {
                        "kind": "assignment_submitted",
                        "description": f'Assignment "{assignment.title}" received a submission in {classroom.name}',
                        "classroom_id": classroom.id,
                        "classroom_name": classroom.name,
                        "occurred_at": submitted,
                    },
                )
            )

    announcements = (
        db.query(ClassroomAnnouncement)
        .filter(
            ClassroomAnnouncement.classroom_id.in_(classroom_ids),
            ClassroomAnnouncement.is_active.is_(True),
        )
        .all()
    )
    for announcement in announcements:
        created = announcement.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        classroom = classroom_by_id.get(announcement.classroom_id)
        if classroom:
            events.append(
                (
                    created,
                    {
                        "kind": "announcement",
                        "description": f'Announcement "{announcement.title}" published in {classroom.name}',
                        "classroom_id": classroom.id,
                        "classroom_name": classroom.name,
                        "occurred_at": created,
                    },
                )
            )

    events.sort(key=lambda item: item[0], reverse=True)
    recent_activity = [payload for _, payload in events[:15]]

    weekly_counts: dict[str, dict[str, int]] = defaultdict(lambda: {"assignment_submissions": 0, "practice_attempts": 0})
    for offset in range(7):
        day = (datetime.now(timezone.utc) - timedelta(days=6 - offset)).date().isoformat()
        weekly_counts[day]  # ensure key exists

    for sub in submissions:
        submitted = sub.submitted_at
        if submitted.tzinfo is None:
            submitted = submitted.replace(tzinfo=timezone.utc)
        if submitted >= week_ago:
            key = _day_key(submitted)
            if key in weekly_counts:
                weekly_counts[key]["assignment_submissions"] += 1

    practice_attempts = (
        db.query(CourseChapterAttempt)
        .filter(
            CourseChapterAttempt.classroom_id.in_(classroom_ids),
            CourseChapterAttempt.created_at >= week_ago,
        )
        .all()
    )
    for attempt in practice_attempts:
        created = attempt.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        key = _day_key(created)
        if key in weekly_counts:
            weekly_counts[key]["practice_attempts"] += 1

    weekly_activity = [
        {
            "date": day,
            "assignment_submissions": weekly_counts[day]["assignment_submissions"],
            "practice_attempts": weekly_counts[day]["practice_attempts"],
        }
        for day in sorted(weekly_counts.keys())
    ]

    struggling_topics: list[dict] = []
    attempts = (
        db.query(CourseChapterAttempt)
        .filter(
            CourseChapterAttempt.classroom_id.in_(classroom_ids),
            CourseChapterAttempt.score.isnot(None),
        )
        .all()
    )
    buckets: dict[tuple[int, str], list[float]] = defaultdict(list)
    for attempt in attempts:
        if attempt.attempt_type == "QUIZ":
            label = f"Chapter {attempt.chapter_number} quiz"
        elif attempt.attempt_type == "SCENARIO":
            label = f"Chapter {attempt.chapter_number} scenario"
        elif attempt.attempt_type in {"ASSESSMENT_TOPIC", "ASSESSMENT_SUBJECT"}:
            label = f"Assessment ({attempt.attempt_type})"
        else:
            label = attempt.attempt_type
        buckets[(attempt.classroom_id, label)].append(float(attempt.score or 0))

    topic_rows: list[tuple[float, dict]] = []
    for (classroom_id, label), scores in buckets.items():
        if len(scores) < 2:
            continue
        avg = sum(scores) / len(scores)
        if avg > 60:
            continue
        classroom = classroom_by_id.get(classroom_id)
        if not classroom:
            continue
        topic_rows.append(
            (
                avg,
                {
                    "classroom_id": classroom_id,
                    "classroom_name": classroom.name,
                    "topic_label": label,
                    "average_score": round(avg, 1),
                    "attempt_count": len(scores),
                },
            )
        )
    topic_rows.sort(key=lambda row: row[0])
    struggling_topics = [row for _, row in topic_rows[:8]]

    classroom_cards: list[dict] = []
    docs_by_class = defaultdict(int)
    for doc in documents:
        docs_by_class[doc.classroom_id] += 1
    students_by_class = defaultdict(int)
    for m in memberships:
        students_by_class[m.classroom_id] += 1
    assignments_by_class = defaultdict(int)
    for a in assignments:
        assignments_by_class[a.classroom_id] += 1

    last_activity_by_class: dict[int, datetime] = {}
    for occurred_at, payload in events:
        cid = payload["classroom_id"]
        existing = last_activity_by_class.get(cid)
        if existing is None or occurred_at > existing:
            last_activity_by_class[cid] = occurred_at

    for classroom in classrooms:
        classroom_cards.append(
            {
                "classroom_id": classroom.id,
                "name": classroom.name,
                "code": classroom.code,
                "join_code": classroom.join_code,
                "is_active": classroom.is_active,
                "student_count": students_by_class[classroom.id],
                "document_count": docs_by_class[classroom.id],
                "assignment_count": assignments_by_class[classroom.id],
                "last_activity_at": last_activity_by_class.get(classroom.id),
            }
        )

    return {
        "stats": {
            "students": len(memberships),
            "students_joined_this_week": students_joined_week,
            "documents": len(documents),
            "documents_added_this_week": docs_added_week,
            "assignments": len(assignments),
            "assignments_needing_review": needs_review,
            "classrooms": len(classrooms),
        },
        "attention": attention,
        "recent_activity": recent_activity,
        "weekly_activity": weekly_activity,
        "struggling_topics": struggling_topics,
        "classrooms": classroom_cards,
    }
