from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models import CodingTest, TestAssignment, TestSession, User, UserRole
from app.routers.student_results import _get_active_session, _session_evals

router = APIRouter(prefix="/internal", tags=["internal"])


class LeaderboardScoresRequest(BaseModel):
    emails: list[str] = Field(default_factory=list)


class LeaderboardScoreOut(BaseModel):
    email: str
    coding_points: int


class LeaderboardScoresResponse(BaseModel):
    scores: list[LeaderboardScoreOut]


class CodingStreakEventOut(BaseModel):
    key: str
    title: str
    available_at: datetime
    completed_at: datetime | None = None


class CodingStreakEventsRequest(BaseModel):
    email: str


class CodingStreakEventsResponse(BaseModel):
    items: list[CodingStreakEventOut] = Field(default_factory=list)


def _coding_points_for_student(db: Session, student_id: int) -> int:
    assignments = (
        db.query(TestAssignment)
        .filter(TestAssignment.student_id == student_id)
        .all()
    )
    if not assignments:
        return 0

    by_test: dict[int, list[TestAssignment]] = defaultdict(list)
    for assignment in assignments:
        by_test[assignment.coding_test_id].append(assignment)

    total = 0
    for test_assignments in by_test.values():
        best_session: TestSession | None = None
        best_session_id = -1
        for assignment in test_assignments:
            session = _get_active_session(db, assignment.id)
            if not session:
                continue
            evals = _session_evals(db, session)
            if not evals:
                continue
            if session.id > best_session_id:
                best_session_id = session.id
                best_session = session
        if best_session is None:
            continue
        evals = _session_evals(db, best_session)
        avg = sum(ev.total_score for ev in evals) / len(evals)
        total += round(avg)
    return total


@router.post("/leaderboard-scores", response_model=LeaderboardScoresResponse)
def leaderboard_scores(
    payload: LeaderboardScoresRequest,
    db: Session = Depends(get_db),
    x_coding_sync_secret: str | None = Header(default=None),
):
    if not settings.coding_sync_secret or x_coding_sync_secret != settings.coding_sync_secret:
        raise HTTPException(status_code=401, detail="Invalid sync secret")

    normalized = {email.lower().strip() for email in payload.emails if email and email.strip()}
    if not normalized:
        return LeaderboardScoresResponse(scores=[])

    students = (
        db.query(User)
        .filter(User.email.in_(normalized), User.role == UserRole.STUDENT)
        .all()
    )

    scores = [
        LeaderboardScoreOut(email=student.email, coding_points=_coding_points_for_student(db, student.id))
        for student in students
    ]
    return LeaderboardScoresResponse(scores=scores)


def _latest_submitted_session(db: Session, assignment_id: int) -> TestSession | None:
    return (
        db.query(TestSession)
        .filter(
            TestSession.assignment_id == assignment_id,
            TestSession.submitted_at.isnot(None),
        )
        .order_by(TestSession.submitted_at.desc(), TestSession.id.desc())
        .first()
    )


@router.post("/streak-events", response_model=CodingStreakEventsResponse)
def streak_events(
    payload: CodingStreakEventsRequest,
    db: Session = Depends(get_db),
    x_coding_sync_secret: str | None = Header(default=None),
):
    if not settings.coding_sync_secret or x_coding_sync_secret != settings.coding_sync_secret:
        raise HTTPException(status_code=401, detail="Invalid sync secret")

    email = payload.email.strip().lower()
    if not email:
        return CodingStreakEventsResponse(items=[])

    student = (
        db.query(User)
        .filter(User.email == email, User.role == UserRole.STUDENT)
        .first()
    )
    if not student:
        return CodingStreakEventsResponse(items=[])

    assignments = (
        db.query(TestAssignment)
        .filter(TestAssignment.student_id == student.id)
        .all()
    )
    items: list[CodingStreakEventOut] = []
    for assignment in assignments:
        test = db.query(CodingTest).filter(CodingTest.id == assignment.coding_test_id).first()
        title = test.title if test else "Coding test"
        session = _latest_submitted_session(db, assignment.id)
        items.append(
            CodingStreakEventOut(
                key=f"coding:{assignment.id}",
                title=title,
                available_at=assignment.created_at,
                completed_at=session.submitted_at if session else None,
            )
        )
    return CodingStreakEventsResponse(items=items)
