from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.core.database import get_db
from app.deps import require_student, require_teacher
from app.models import (
    AssignmentStatus,
    CodeDraft,
    CodeSubmission,
    CodingTest,
    CodingTestQuestion,
    EvalRun,
    ProctorEvent,
    Question,
    SessionStatus,
    TestAssignment,
    TestSession,
    User,
)
from app.schemas import (
    AssignByCodeRequest,
    AssignmentOut,
    AttemptResultOut,
    DraftSaveRequest,
    EvalOut,
    EvalUpdateRequest,
    ExamQuestionOut,
    ProctorEventRequest,
    RunCodeRequest,
    RunCodeResponse,
    SessionOut,
    StudentResultOut,
    StudentResultSummaryOut,
    SubmitResponse,
    TeacherCodingAnalyticsOut,
    AnalyticsBucketOut,
    AnalyticsRiskStudentOut,
    AnalyticsTestBreakdownOut,
    TestCase,
)
from app.services.evaluator import evaluate_submission, event_weight
from app.services.bloom import resolve_bloom
from app.services.code_runner import run_test_cases

student_router = APIRouter(prefix="/student", tags=["student"])
results_router = APIRouter(prefix="/results", tags=["results"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_email_filter(student_emails: str | None) -> set[str] | None:
    """Comma-separated emails → lowercase set. None means no filter."""
    if student_emails is None:
        return None
    emails = {part.strip().lower() for part in student_emails.split(",") if part.strip()}
    return emails


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _remaining(session: TestSession) -> int:
    ends = _ensure_aware(session.ends_at)
    return max(0, int((ends - _utcnow()).total_seconds()))


def _get_active_session(db: Session, assignment_id: int) -> TestSession | None:
    return (
        db.query(TestSession)
        .filter(TestSession.assignment_id == assignment_id)
        .order_by(TestSession.id.desc())
        .first()
    )


def _expire_if_needed(db: Session, session: TestSession, assignment: TestAssignment) -> TestSession:
    if session.status == SessionStatus.IN_PROGRESS and _remaining(session) <= 0:
        _finalize_session(db, session, assignment, blocked=False, expired=True)
        db.refresh(session)
    return session


def _finalize_session(
    db: Session,
    session: TestSession,
    assignment: TestAssignment,
    *,
    blocked: bool,
    expired: bool = False,
) -> None:
    if session.status in {SessionStatus.SUBMITTED, SessionStatus.BLOCKED, SessionStatus.EXPIRED}:
        return

    test = assignment.coding_test
    links = (
        db.query(CodingTestQuestion)
        .filter(CodingTestQuestion.coding_test_id == test.id)
        .order_by(CodingTestQuestion.order_index)
        .all()
    )
    for link in links:
        draft = (
            db.query(CodeDraft)
            .filter(CodeDraft.session_id == session.id, CodeDraft.question_id == link.question_id)
            .first()
        )
        code = draft.code if draft else (link.question.starter_code or "")
        existing = (
            db.query(CodeSubmission)
            .filter(CodeSubmission.session_id == session.id, CodeSubmission.question_id == link.question_id)
            .first()
        )
        if not existing:
            existing = CodeSubmission(
                session_id=session.id,
                question_id=link.question_id,
                code=code,
                language=link.question.language,
            )
            db.add(existing)
            db.flush()
        eval_existing = db.query(EvalRun).filter(EvalRun.submission_id == existing.id).first()
        if not eval_existing:
            result = evaluate_submission(
                question=link.question,
                code=existing.code,
                language=existing.language,
            )
            db.add(
                EvalRun(
                    submission_id=existing.id,
                    scores=result["scores"],
                    total_score=result["total_score"],
                    verdict=result["verdict"],
                    feedback=result["feedback"],
                    raw_llm=result.get("raw_llm"),
                    error_message=result.get("error_message"),
                )
            )

    if blocked:
        session.status = SessionStatus.BLOCKED
        assignment.status = AssignmentStatus.BLOCKED
    elif expired:
        session.status = SessionStatus.EXPIRED
        assignment.status = AssignmentStatus.SUBMITTED
    else:
        session.status = SessionStatus.SUBMITTED
        assignment.status = AssignmentStatus.SUBMITTED
    session.submitted_at = _utcnow()
    db.commit()


@student_router.post("/join", response_model=AssignmentOut)
def join_by_invite(
    payload: AssignByCodeRequest,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    test = (
        db.query(CodingTest)
        .filter(CodingTest.invite_code == payload.invite_code.upper().strip(), CodingTest.is_active.is_(True))
        .first()
    )
    if not test:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    existing = (
        db.query(TestAssignment)
        .filter(TestAssignment.coding_test_id == test.id, TestAssignment.student_id == student.id)
        .first()
    )
    if existing:
        return AssignmentOut(
            id=existing.id,
            coding_test_id=test.id,
            student_id=student.id,
            status=existing.status,
            test_title=test.title,
            duration_minutes=test.duration_minutes,
            is_published_results=test.is_published_results,
        )
    row = TestAssignment(coding_test_id=test.id, student_id=student.id, status=AssignmentStatus.ASSIGNED)
    db.add(row)
    db.commit()
    db.refresh(row)
    return AssignmentOut(
        id=row.id,
        coding_test_id=test.id,
        student_id=student.id,
        status=row.status,
        test_title=test.title,
        duration_minutes=test.duration_minutes,
        is_published_results=test.is_published_results,
    )


@student_router.get("/assignments", response_model=list[AssignmentOut])
def my_assignments(db: Session = Depends(get_db), student: User = Depends(require_student)):
    rows = db.query(TestAssignment).filter(TestAssignment.student_id == student.id).all()
    out: list[AssignmentOut] = []
    for row in rows:
        test = db.query(CodingTest).filter(CodingTest.id == row.coding_test_id).first()
        out.append(
            AssignmentOut(
                id=row.id,
                coding_test_id=row.coding_test_id,
                student_id=student.id,
                status=row.status,
                test_title=test.title if test else None,
                duration_minutes=test.duration_minutes if test else None,
                is_published_results=bool(test and test.is_published_results),
            )
        )
    return out


@student_router.post("/assignments/{assignment_id}/start", response_model=SessionOut)
def start_session(
    assignment_id: int,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    assignment = (
        db.query(TestAssignment)
        .filter(TestAssignment.id == assignment_id, TestAssignment.student_id == student.id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if assignment.status in {AssignmentStatus.SUBMITTED, AssignmentStatus.BLOCKED}:
        raise HTTPException(status_code=400, detail="Assignment already finished")

    existing = _get_active_session(db, assignment.id)
    if existing and existing.status == SessionStatus.IN_PROGRESS:
        existing = _expire_if_needed(db, existing, assignment)
        if existing.status == SessionStatus.IN_PROGRESS:
            return SessionOut(
                id=existing.id,
                assignment_id=assignment.id,
                started_at=existing.started_at,
                ends_at=existing.ends_at,
                status=existing.status,
                violation_score=existing.violation_score,
                current_question_order=existing.current_question_order,
                remaining_seconds=_remaining(existing),
            )

    test = assignment.coding_test
    started = _utcnow()
    session = TestSession(
        assignment_id=assignment.id,
        started_at=started,
        ends_at=started + timedelta(minutes=test.duration_minutes),
        status=SessionStatus.IN_PROGRESS,
        violation_score=0.0,
        current_question_order=1,
    )
    assignment.status = AssignmentStatus.IN_PROGRESS
    db.add(session)
    # seed drafts with starter code
    links = (
        db.query(CodingTestQuestion)
        .filter(CodingTestQuestion.coding_test_id == test.id)
        .all()
    )
    db.flush()
    for link in links:
        db.add(
            CodeDraft(
                session_id=session.id,
                question_id=link.question_id,
                code=link.question.starter_code or "",
            )
        )
    db.commit()
    db.refresh(session)
    return SessionOut(
        id=session.id,
        assignment_id=assignment.id,
        started_at=session.started_at,
        ends_at=session.ends_at,
        status=session.status,
        violation_score=session.violation_score,
        current_question_order=session.current_question_order,
        remaining_seconds=_remaining(session),
    )


@student_router.get("/sessions/{session_id}", response_model=SessionOut)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    session = db.query(TestSession).filter(TestSession.id == session_id).first()
    if not session or session.assignment.student_id != student.id:
        raise HTTPException(status_code=404, detail="Session not found")
    session = _expire_if_needed(db, session, session.assignment)
    return SessionOut(
        id=session.id,
        assignment_id=session.assignment_id,
        started_at=session.started_at,
        ends_at=session.ends_at,
        status=session.status,
        violation_score=session.violation_score,
        current_question_order=session.current_question_order,
        remaining_seconds=_remaining(session),
    )


@student_router.get("/sessions/{session_id}/questions", response_model=list[ExamQuestionOut])
def exam_questions(
    session_id: int,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    session = db.query(TestSession).filter(TestSession.id == session_id).first()
    if not session or session.assignment.student_id != student.id:
        raise HTTPException(status_code=404, detail="Session not found")
    session = _expire_if_needed(db, session, session.assignment)
    links = (
        db.query(CodingTestQuestion)
        .filter(CodingTestQuestion.coding_test_id == session.assignment.coding_test_id)
        .order_by(CodingTestQuestion.order_index)
        .all()
    )
    out: list[ExamQuestionOut] = []
    for link in links:
        draft = (
            db.query(CodeDraft)
            .filter(CodeDraft.session_id == session.id, CodeDraft.question_id == link.question_id)
            .first()
        )
        all_cases = link.question.test_cases_json or []
        visible_cases = [c for c in all_cases if isinstance(c, dict) and c.get("is_visible")]
        out.append(
            ExamQuestionOut(
                order_index=link.order_index,
                bloom_level=resolve_bloom(link.question, getattr(link, "required_difficulty", None)),
                question_id=link.question_id,
                title=link.question.title,
                prompt_markdown=link.question.prompt_markdown,
                starter_code=link.question.starter_code,
                language=link.question.language,
                unlocked=link.order_index <= session.current_question_order,
                draft_code=draft.code if draft else None,
                test_cases=[TestCase(**c) for c in visible_cases],
            )
        )
    return out


@student_router.post("/sessions/{session_id}/run", response_model=RunCodeResponse)
def run_code(
    session_id: int,
    payload: RunCodeRequest,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    if not settings.enable_exam_run_testcases:
        raise HTTPException(status_code=403, detail="Test-case runner is disabled")

    session = db.query(TestSession).filter(TestSession.id == session_id).first()
    if not session or session.assignment.student_id != student.id:
        raise HTTPException(status_code=404, detail="Session not found")
    session = _expire_if_needed(db, session, session.assignment)
    if session.status != SessionStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Session is not active")

    link = (
        db.query(CodingTestQuestion)
        .filter(
            CodingTestQuestion.coding_test_id == session.assignment.coding_test_id,
            CodingTestQuestion.question_id == payload.question_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=400, detail="Question not on this test")
    if link.order_index > session.current_question_order:
        raise HTTPException(status_code=400, detail="Question is locked")

    question = link.question
    all_cases = question.test_cases_json or []
    visible_cases = [c for c in all_cases if isinstance(c, dict) and c.get("is_visible")]
    if not visible_cases:
        return RunCodeResponse(
            results=[],
            ran_count=0,
            message="No test cases available for this question",
        )

    results = run_test_cases(
        code=payload.code,
        language=payload.language,
        test_cases=visible_cases,
    )
    return RunCodeResponse(results=results, ran_count=len(results))


@student_router.post("/sessions/{session_id}/draft")
def save_draft(
    session_id: int,
    payload: DraftSaveRequest,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    session = db.query(TestSession).filter(TestSession.id == session_id).first()
    if not session or session.assignment.student_id != student.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Session is not active")
    session = _expire_if_needed(db, session, session.assignment)
    if session.status != SessionStatus.IN_PROGRESS:
        raise HTTPException(status_code=400, detail="Session ended")

    link = (
        db.query(CodingTestQuestion)
        .filter(
            CodingTestQuestion.coding_test_id == session.assignment.coding_test_id,
            CodingTestQuestion.question_id == payload.question_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=400, detail="Question not on this test")
    if link.order_index > session.current_question_order:
        raise HTTPException(status_code=400, detail="Question is locked")

    draft = (
        db.query(CodeDraft)
        .filter(CodeDraft.session_id == session.id, CodeDraft.question_id == payload.question_id)
        .first()
    )
    if not draft:
        draft = CodeDraft(session_id=session.id, question_id=payload.question_id, code=payload.code)
        db.add(draft)
    else:
        draft.code = payload.code
        draft.updated_at = _utcnow()

    # sequential unlock: saving current max unlocked advances to next
    max_order = (
        db.query(func.max(CodingTestQuestion.order_index))
        .filter(CodingTestQuestion.coding_test_id == session.assignment.coding_test_id)
        .scalar()
    ) or 1
    if link.order_index == session.current_question_order and session.current_question_order < max_order:
        session.current_question_order += 1

    db.commit()
    return {"ok": True, "current_question_order": session.current_question_order}


@student_router.post("/sessions/{session_id}/event", response_model=SessionOut)
def report_event(
    session_id: int,
    payload: ProctorEventRequest,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    session = db.query(TestSession).filter(TestSession.id == session_id).first()
    if not session or session.assignment.student_id != student.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.IN_PROGRESS:
        return SessionOut(
            id=session.id,
            assignment_id=session.assignment_id,
            started_at=session.started_at,
            ends_at=session.ends_at,
            status=session.status,
            violation_score=session.violation_score,
            current_question_order=session.current_question_order,
            remaining_seconds=_remaining(session),
        )

    weight = event_weight(payload.event_type, payload.duration_seconds)
    db.add(
        ProctorEvent(
            session_id=session.id,
            event_type=payload.event_type,
            weight=weight,
            detail=payload.detail,
        )
    )
    session.violation_score = float(session.violation_score) + weight
    warning = None
    if weight > 0:
        warning = f"Proctor warning (+{weight}). Score={session.violation_score:.1f}/{settings.violation_block_threshold}"
    blocked = False
    if session.violation_score >= settings.violation_block_threshold:
        _finalize_session(db, session, session.assignment, blocked=True)
        blocked = True
        warning = "Session blocked due to repeated integrity violations. Your work was submitted."
    else:
        db.commit()
        db.refresh(session)

    return SessionOut(
        id=session.id,
        assignment_id=session.assignment_id,
        started_at=session.started_at,
        ends_at=session.ends_at,
        status=session.status,
        violation_score=session.violation_score,
        current_question_order=session.current_question_order,
        remaining_seconds=_remaining(session),
        warning=warning,
    )


@student_router.post("/sessions/{session_id}/submit", response_model=SubmitResponse)
def submit_session(
    session_id: int,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    session = db.query(TestSession).filter(TestSession.id == session_id).first()
    if not session or session.assignment.student_id != student.id:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.IN_PROGRESS:
        if session.status in {SessionStatus.SUBMITTED, SessionStatus.BLOCKED, SessionStatus.EXPIRED}:
            return SubmitResponse(
                message="Your Test Is Successfully Submitted",
                session_id=session.id,
                status=session.status,
            )
        raise HTTPException(status_code=400, detail="Cannot submit this session")

    if _remaining(session) <= 0:
        _finalize_session(db, session, session.assignment, blocked=False, expired=True)
    else:
        _finalize_session(db, session, session.assignment, blocked=False)
    db.refresh(session)
    return SubmitResponse(
        message="Your Test Is Successfully Submitted",
        session_id=session.id,
        status=session.status,
    )


@student_router.get("/assignments/{assignment_id}/results", response_model=StudentResultOut)
def student_results(
    assignment_id: int,
    db: Session = Depends(get_db),
    student: User = Depends(require_student),
):
    assignment = (
        db.query(TestAssignment)
        .filter(TestAssignment.id == assignment_id, TestAssignment.student_id == student.id)
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    test = assignment.coding_test
    if not test.is_published_results:
        return StudentResultOut(
            test_title=test.title,
            published=False,
            message="Results are not published yet. Your teacher will release them soon.",
        )
    session = _get_active_session(db, assignment.id)
    if not session:
        return StudentResultOut(test_title=test.title, published=True, message="No attempt found.", evals=[])
    evals = _session_evals(db, session)
    avg = round(sum(e.total_score for e in evals) / len(evals), 2) if evals else None
    return StudentResultOut(test_title=test.title, published=True, evals=evals, average_score=avg)


def _session_evals(db: Session, session: TestSession) -> list[EvalOut]:
    subs = db.query(CodeSubmission).filter(CodeSubmission.session_id == session.id).all()
    out: list[EvalOut] = []
    for sub in subs:
        q = db.query(Question).filter(Question.id == sub.question_id).first()
        ev = db.query(EvalRun).filter(EvalRun.submission_id == sub.id).first()
        if not q or not ev:
            continue
        out.append(
            EvalOut(
                eval_run_id=ev.id,
                submission_id=sub.id,
                question_id=q.id,
                question_title=q.title,
                bloom_level=resolve_bloom(q),
                language=sub.language,
                code=sub.code,
                total_score=ev.total_score,
                verdict=ev.verdict,
                feedback=ev.feedback,
                scores=ev.scores or {},
            )
        )
    return out


def _verdict_from_score(score: float) -> str:
    if score >= 70:
        return "PASS"
    if score >= 50:
        return "BORDERLINE"
    return "FAIL"


@results_router.get("/tests/{test_id}/attempts", response_model=list[AttemptResultOut])
def teacher_attempts(
    test_id: int,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    test = db.query(CodingTest).filter(CodingTest.id == test_id, CodingTest.created_by_id == teacher.id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    assignments = db.query(TestAssignment).filter(TestAssignment.coding_test_id == test.id).all()
    out: list[AttemptResultOut] = []
    for assignment in assignments:
        student = db.query(User).filter(User.id == assignment.student_id).first()
        session = _get_active_session(db, assignment.id)
        evals = _session_evals(db, session) if session else []
        avg = round(sum(e.total_score for e in evals) / len(evals), 2) if evals else None
        out.append(
            AttemptResultOut(
                assignment_id=assignment.id,
                student_id=assignment.student_id,
                student_name=student.full_name if student else "?",
                student_email=student.email if student else "?",
                session_id=session.id if session else None,
                session_status=session.status if session else None,
                violation_score=session.violation_score if session else None,
                evals=evals,
                average_score=avg,
                test_id=test.id,
                test_title=test.title,
                is_published_results=bool(test.is_published_results),
            )
        )
    return out


@results_router.get("/analytics", response_model=TeacherCodingAnalyticsOut)
def teacher_coding_analytics(
    student_id: int | None = None,
    student_emails: str | None = None,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    """Aggregate analytics across all tests owned by this teacher.

    Optional student_id scopes charts to one assigned student.
    Optional student_emails (comma-separated) limits to a classroom roster.
    """
    email_filter = _parse_email_filter(student_emails)
    tests = (
        db.query(CodingTest)
        .filter(CodingTest.created_by_id == teacher.id, CodingTest.is_active.is_(True))
        .all()
    )
    test_ids = [t.id for t in tests]
    threshold = float(settings.violation_block_threshold)

    participation = {"assigned": 0, "started": 0, "submitted": 0, "not_started": 0}
    score_buckets = [
        AnalyticsBucketOut(label="0–19", count=0),
        AnalyticsBucketOut(label="20–39", count=0),
        AnalyticsBucketOut(label="40–59", count=0),
        AnalyticsBucketOut(label="60–79", count=0),
        AnalyticsBucketOut(label="80–100", count=0),
    ]
    verdict_counts = {"PASS": 0, "BORDERLINE": 0, "FAIL": 0, "ERROR": 0}
    risk: list[AnalyticsRiskStudentOut] = []
    per_test: list[AnalyticsTestBreakdownOut] = []
    scored_attempt_count = 0
    focus_name: str | None = None
    focus_email: str | None = None

    empty = TeacherCodingAnalyticsOut(
        test_count=0 if email_filter is not None else len(tests),
        participation=participation,
        score_distribution=score_buckets,
        verdict_mix=[AnalyticsBucketOut(label=k, count=0) for k in verdict_counts],
        proctor_risk=[],
        violation_threshold=threshold,
        scored_attempt_count=0,
        student_id=student_id,
        student_name=None,
        student_email=None,
        per_test=[],
    )

    if email_filter is not None and not email_filter:
        return empty

    if not test_ids:
        return empty

    query = (
        db.query(TestAssignment, CodingTest, User)
        .join(CodingTest, CodingTest.id == TestAssignment.coding_test_id)
        .join(User, User.id == TestAssignment.student_id)
        .filter(TestAssignment.coding_test_id.in_(test_ids))
    )
    if student_id is not None:
        query = query.filter(TestAssignment.student_id == student_id)
    rows = query.order_by(CodingTest.id.asc()).all()
    if email_filter is not None:
        rows = [
            row
            for row in rows
            if (row[2].email or "").strip().lower() in email_filter
        ]

    if student_id is not None and not rows:
        student = db.query(User).filter(User.id == student_id).first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        if email_filter is not None and (student.email or "").strip().lower() not in email_filter:
            raise HTTPException(status_code=404, detail="Student not found in this classroom")
        empty.student_name = student.full_name
        empty.student_email = student.email
        return empty

    for assignment, test, student in rows:
        if focus_name is None:
            focus_name = student.full_name
            focus_email = student.email

        participation["assigned"] += 1
        session = _get_active_session(db, assignment.id)
        if not session:
            participation["not_started"] += 1
            if student_id is not None:
                per_test.append(
                    AnalyticsTestBreakdownOut(
                        test_id=test.id,
                        test_title=test.title,
                        assignment_id=assignment.id,
                        session_status=None,
                        average_score=None,
                        violation_score=None,
                        eval_count=0,
                    )
                )
            continue

        participation["started"] += 1
        if session.status == SessionStatus.SUBMITTED:
            participation["submitted"] += 1

        violation = float(session.violation_score or 0)
        if violation >= max(threshold / 2, 1) or session.status == SessionStatus.BLOCKED:
            risk.append(
                AnalyticsRiskStudentOut(
                    student_id=student.id,
                    student_name=student.full_name,
                    student_email=student.email,
                    test_id=test.id,
                    test_title=test.title,
                    assignment_id=assignment.id,
                    violation_score=violation,
                    session_status=session.status,
                )
            )

        evals = _session_evals(db, session)
        avg = None
        if evals:
            avg = round(sum(e.total_score for e in evals) / len(evals), 2)
            scored_attempt_count += 1
            # One verdict per test attempt (avg across questions), not per question.
            verdict_key = _verdict_from_score(avg)
            if verdict_key not in verdict_counts:
                verdict_key = "ERROR"
            verdict_counts[verdict_key] += 1
            if avg < 20:
                score_buckets[0].count += 1
            elif avg < 40:
                score_buckets[1].count += 1
            elif avg < 60:
                score_buckets[2].count += 1
            elif avg < 80:
                score_buckets[3].count += 1
            else:
                score_buckets[4].count += 1

        if student_id is not None:
            per_test.append(
                AnalyticsTestBreakdownOut(
                    test_id=test.id,
                    test_title=test.title,
                    assignment_id=assignment.id,
                    session_status=session.status,
                    average_score=avg,
                    violation_score=violation,
                    eval_count=len(evals),
                )
            )

    risk.sort(key=lambda r: r.violation_score, reverse=True)

    if student_id is not None:
        scoped_test_count = len(per_test)
    elif email_filter is not None:
        scoped_test_count = len({test.id for _, test, _ in rows})
    else:
        scoped_test_count = len(tests)

    return TeacherCodingAnalyticsOut(
        test_count=scoped_test_count,
        participation=participation,
        score_distribution=score_buckets,
        verdict_mix=[AnalyticsBucketOut(label=k, count=v) for k, v in verdict_counts.items()],
        proctor_risk=risk[:12],
        violation_threshold=threshold,
        scored_attempt_count=scored_attempt_count,
        student_id=student_id,
        student_name=focus_name if student_id is not None else None,
        student_email=focus_email if student_id is not None else None,
        per_test=per_test,
    )


@results_router.get("/students", response_model=list[StudentResultSummaryOut])
def teacher_result_students(
    student_emails: str | None = None,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    """Students assigned to any of this teacher's tests (includes not started)."""
    email_filter = _parse_email_filter(student_emails)
    if email_filter is not None and not email_filter:
        return []

    rows = (
        db.query(TestAssignment, User, CodingTest)
        .join(CodingTest, CodingTest.id == TestAssignment.coding_test_id)
        .join(User, User.id == TestAssignment.student_id)
        .filter(CodingTest.created_by_id == teacher.id)
        .all()
    )
    by_student: dict[int, dict] = {}
    for assignment, student, _test in rows:
        if email_filter is not None and (student.email or "").strip().lower() not in email_filter:
            continue
        entry = by_student.setdefault(
            student.id,
            {
                "student_id": student.id,
                "student_name": student.full_name,
                "student_email": student.email,
                "assignment_count": 0,
                "started_count": 0,
                "submitted_count": 0,
            },
        )
        entry["assignment_count"] += 1
        session = _get_active_session(db, assignment.id)
        if session:
            entry["started_count"] += 1
            if session.status == SessionStatus.SUBMITTED:
                entry["submitted_count"] += 1
    return [
        StudentResultSummaryOut(**entry)
        for entry in sorted(by_student.values(), key=lambda e: e["student_name"].lower())
    ]


@results_router.get("/students/{student_id}/attempts", response_model=list[AttemptResultOut])
def teacher_student_attempts(
    student_id: int,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    """All tests this teacher assigned to the student (includes not started)."""
    rows = (
        db.query(TestAssignment, CodingTest)
        .join(CodingTest, CodingTest.id == TestAssignment.coding_test_id)
        .filter(
            CodingTest.created_by_id == teacher.id,
            TestAssignment.student_id == student_id,
        )
        .order_by(CodingTest.id.asc())
        .all()
    )
    if not rows:
        student = db.query(User).filter(User.id == student_id).first()
        if not student:
            raise HTTPException(status_code=404, detail="Student not found")
        return []

    student = db.query(User).filter(User.id == student_id).first()
    out: list[AttemptResultOut] = []
    for assignment, test in rows:
        session = _get_active_session(db, assignment.id)
        evals = _session_evals(db, session) if session else []
        avg = round(sum(e.total_score for e in evals) / len(evals), 2) if evals else None
        out.append(
            AttemptResultOut(
                assignment_id=assignment.id,
                student_id=student_id,
                student_name=student.full_name if student else "?",
                student_email=student.email if student else "?",
                session_id=session.id if session else None,
                session_status=session.status if session else None,
                violation_score=session.violation_score if session else None,
                evals=evals,
                average_score=avg,
                test_id=test.id,
                test_title=test.title,
                is_published_results=bool(test.is_published_results),
            )
        )
    return out


@results_router.patch("/evals/{eval_run_id}", response_model=EvalOut)
def teacher_update_eval(
    eval_run_id: int,
    payload: EvalUpdateRequest,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    ev = db.query(EvalRun).filter(EvalRun.id == eval_run_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Eval not found")
    sub = db.query(CodeSubmission).filter(CodeSubmission.id == ev.submission_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Submission not found")
    session = db.query(TestSession).filter(TestSession.id == sub.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    test = session.assignment.coding_test
    if test.created_by_id != teacher.id:
        raise HTTPException(status_code=403, detail="Not your test")
    if test.is_published_results:
        raise HTTPException(
            status_code=400,
            detail="Results are published; grades cannot be changed",
        )

    q = db.query(Question).filter(Question.id == sub.question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    score = float(payload.total_score)
    verdict = (payload.verdict or "").strip().upper() or _verdict_from_score(score)
    if verdict not in {"PASS", "BORDERLINE", "FAIL", "ERROR"}:
        verdict = _verdict_from_score(score)

    ev.total_score = round(score, 2)
    ev.feedback = payload.feedback.strip()
    ev.verdict = verdict
    # Keep rubric breakdown roughly consistent for display
    scores = dict(ev.scores or {})
    scores["teacher_override"] = True
    scores["correctness"] = score
    ev.scores = scores
    flag_modified(ev, "scores")
    db.commit()
    db.refresh(ev)

    return EvalOut(
        eval_run_id=ev.id,
        submission_id=sub.id,
        question_id=q.id,
        question_title=q.title,
        bloom_level=resolve_bloom(q),
        language=sub.language,
        code=sub.code,
        total_score=ev.total_score,
        verdict=ev.verdict,
        feedback=ev.feedback,
        scores=ev.scores or {},
    )


@results_router.post("/tests/{test_id}/publish")
def publish_results(
    test_id: int,
    db: Session = Depends(get_db),
    teacher: User = Depends(require_teacher),
):
    test = db.query(CodingTest).filter(CodingTest.id == test_id, CodingTest.created_by_id == teacher.id).first()
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    test.is_published_results = True
    db.commit()
    return {"ok": True, "is_published_results": True}
