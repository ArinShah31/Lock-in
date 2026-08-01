from datetime import datetime, timezone
from pathlib import Path
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.classrooms import (
    _ensure_view_access,
    _get_classroom_or_404,
)
from app.core.database import get_db
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.user import User, UserRole
from app.schemas.assignment import (
    AssignmentOut,
    AssignmentSubmissionOut,
    GradeSubmissionRequest,
)

router = APIRouter(tags=["assignments"])

ASSIGNMENT_UPLOAD_DIR = Path("uploads/assignments")
SUBMISSION_UPLOAD_DIR = Path("uploads/submissions")
ASSIGNMENT_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SUBMISSION_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _ensure_class_teacher(user: User, classroom: Classroom) -> None:
    if classroom.class_teacher_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the class teacher can manage assignments",
        )


def _is_approved_student(db: Session, classroom_id: int, student_id: int) -> bool:
    return (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
        )
        .first()
        is not None
    )


def _save_upload(upload_dir: Path, file: UploadFile) -> tuple[str, str, str, int, str]:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File name required")
    extension = Path(file.filename).suffix
    stored_name = f"{uuid.uuid4()}{extension}"
    destination = upload_dir / stored_name
    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    size = destination.stat().st_size
    mime = file.content_type or "application/octet-stream"
    return file.filename, stored_name, str(destination).replace("\\", "/"), size, mime


def _submission_out(
    submission: AssignmentSubmission,
    student: User | None = None,
) -> AssignmentSubmissionOut:
    return AssignmentSubmissionOut(
        id=submission.id,
        assignment_id=submission.assignment_id,
        student_id=submission.student_id,
        file_name=submission.file_name,
        file_path=submission.file_path,
        file_size=submission.file_size,
        mime_type=submission.mime_type,
        submitted_at=submission.submitted_at,
        is_late=submission.is_late,
        marks=submission.marks,
        feedback=submission.feedback,
        graded_at=submission.graded_at,
        graded_by=submission.graded_by,
        student_full_name=student.full_name if student else None,
        student_email=student.email if student else None,
        is_graded=submission.graded_at is not None,
    )


def _assignment_out(
    assignment: Assignment,
    *,
    submitted_count: int | None = None,
    graded_count: int | None = None,
    my_submission: AssignmentSubmissionOut | None = None,
) -> AssignmentOut:
    return AssignmentOut(
        id=assignment.id,
        classroom_id=assignment.classroom_id,
        created_by=assignment.created_by,
        title=assignment.title,
        instructions=assignment.instructions,
        max_marks=assignment.max_marks,
        due_at=assignment.due_at,
        file_name=assignment.file_name,
        file_path=assignment.file_path,
        file_size=assignment.file_size,
        mime_type=assignment.mime_type,
        is_active=assignment.is_active,
        created_at=assignment.created_at,
        submitted_count=submitted_count,
        graded_count=graded_count,
        my_submission=my_submission,
    )


def _get_assignment_or_404(db: Session, assignment_id: int) -> Assignment:
    assignment = db.query(Assignment).filter(Assignment.id == assignment_id).first()
    if not assignment or not assignment.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return assignment


def _parse_due_at(value: str) -> datetime:
    try:
        due = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid due_at. Use ISO datetime.",
        ) from exc
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    return due


@router.post(
    "/classrooms/{classroom_id}/assignments",
    response_model=AssignmentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_assignment(
    classroom_id: int,
    title: str = Form(...),
    max_marks: float = Form(...),
    due_at: str = Form(...),
    instructions: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)

    if max_marks <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="max_marks must be > 0")

    cleaned_instructions = instructions.strip() if instructions else None
    has_file = file is not None and bool(file.filename)
    if not cleaned_instructions and not has_file:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide instructions and/or an attachment",
        )

    file_name = stored_name = file_path = mime_type = None
    file_size = None
    if has_file and file is not None:
        file_name, stored_name, file_path, file_size, mime_type = _save_upload(
            ASSIGNMENT_UPLOAD_DIR, file
        )

    assignment = Assignment(
        classroom_id=classroom_id,
        created_by=current_user.id,
        title=title.strip(),
        instructions=cleaned_instructions,
        max_marks=max_marks,
        due_at=_parse_due_at(due_at),
        file_name=file_name,
        stored_name=stored_name,
        file_path=file_path,
        file_size=file_size,
        mime_type=mime_type,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return _assignment_out(assignment, submitted_count=0, graded_count=0)


@router.get("/classrooms/{classroom_id}/assignments", response_model=list[AssignmentOut])
def list_assignments(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)

    assignments = (
        db.query(Assignment)
        .filter(Assignment.classroom_id == classroom_id, Assignment.is_active.is_(True))
        .order_by(Assignment.due_at.asc())
        .all()
    )

    is_teacher = classroom.class_teacher_id == current_user.id
    results: list[AssignmentOut] = []
    for assignment in assignments:
        submitted_count = graded_count = None
        my_submission = None
        if is_teacher:
            subs = (
                db.query(AssignmentSubmission)
                .filter(AssignmentSubmission.assignment_id == assignment.id)
                .all()
            )
            submitted_count = len(subs)
            graded_count = sum(1 for s in subs if s.graded_at is not None)
        elif current_user.role == UserRole.STUDENT:
            sub = (
                db.query(AssignmentSubmission)
                .filter(
                    AssignmentSubmission.assignment_id == assignment.id,
                    AssignmentSubmission.student_id == current_user.id,
                )
                .first()
            )
            if sub:
                my_submission = _submission_out(sub, current_user)
        results.append(
            _assignment_out(
                assignment,
                submitted_count=submitted_count,
                graded_count=graded_count,
                my_submission=my_submission,
            )
        )
    return results


@router.get("/assignments/{assignment_id}", response_model=AssignmentOut)
def get_assignment(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = _get_assignment_or_404(db, assignment_id)
    classroom = _get_classroom_or_404(db, assignment.classroom_id)
    _ensure_view_access(db, current_user, classroom)

    submitted_count = graded_count = None
    my_submission = None
    if classroom.class_teacher_id == current_user.id:
        subs = (
            db.query(AssignmentSubmission)
            .filter(AssignmentSubmission.assignment_id == assignment.id)
            .all()
        )
        submitted_count = len(subs)
        graded_count = sum(1 for s in subs if s.graded_at is not None)
    elif current_user.role == UserRole.STUDENT:
        sub = (
            db.query(AssignmentSubmission)
            .filter(
                AssignmentSubmission.assignment_id == assignment.id,
                AssignmentSubmission.student_id == current_user.id,
            )
            .first()
        )
        if sub:
            my_submission = _submission_out(sub, current_user)

    return _assignment_out(
        assignment,
        submitted_count=submitted_count,
        graded_count=graded_count,
        my_submission=my_submission,
    )


@router.post(
    "/assignments/{assignment_id}/submissions",
    response_model=AssignmentSubmissionOut,
    status_code=status.HTTP_201_CREATED,
)
async def submit_assignment(
    assignment_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only students can submit")

    assignment = _get_assignment_or_404(db, assignment_id)
    classroom = _get_classroom_or_404(db, assignment.classroom_id)
    _ensure_view_access(db, current_user, classroom)

    if not _is_approved_student(db, classroom.id, current_user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only approved classroom students can submit",
        )

    existing = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment.id,
            AssignmentSubmission.student_id == current_user.id,
        )
        .first()
    )
    if existing and existing.graded_at is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submission is locked after grading",
        )

    now = datetime.now(timezone.utc)
    due = assignment.due_at
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    is_late = now > due

    file_name, stored_name, file_path, file_size, mime_type = _save_upload(
        SUBMISSION_UPLOAD_DIR, file
    )

    if existing:
        old_path = Path(existing.file_path)
        if old_path.exists():
            old_path.unlink(missing_ok=True)
        existing.file_name = file_name
        existing.stored_name = stored_name
        existing.file_path = file_path
        existing.file_size = file_size
        existing.mime_type = mime_type
        existing.submitted_at = now
        existing.is_late = is_late
        db.commit()
        db.refresh(existing)
        return _submission_out(existing, current_user)

    submission = AssignmentSubmission(
        assignment_id=assignment.id,
        student_id=current_user.id,
        file_name=file_name,
        stored_name=stored_name,
        file_path=file_path,
        file_size=file_size,
        mime_type=mime_type,
        submitted_at=now,
        is_late=is_late,
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)
    return _submission_out(submission, current_user)


@router.get(
    "/assignments/{assignment_id}/submissions",
    response_model=list[AssignmentSubmissionOut],
)
def list_submissions(
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = _get_assignment_or_404(db, assignment_id)
    classroom = _get_classroom_or_404(db, assignment.classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)

    submissions = (
        db.query(AssignmentSubmission)
        .filter(AssignmentSubmission.assignment_id == assignment.id)
        .order_by(AssignmentSubmission.submitted_at.desc())
        .all()
    )
    student_ids = [s.student_id for s in submissions]
    students = {
        u.id: u for u in db.query(User).filter(User.id.in_(student_ids)).all()
    } if student_ids else {}
    return [_submission_out(s, students.get(s.student_id)) for s in submissions]


@router.patch(
    "/assignments/{assignment_id}/submissions/{student_id}",
    response_model=AssignmentSubmissionOut,
)
def grade_submission(
    assignment_id: int,
    student_id: int,
    payload: GradeSubmissionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = _get_assignment_or_404(db, assignment_id)
    classroom = _get_classroom_or_404(db, assignment.classroom_id)
    _ensure_view_access(db, current_user, classroom)
    _ensure_class_teacher(current_user, classroom)

    if payload.marks > assignment.max_marks:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"marks cannot exceed max_marks ({assignment.max_marks})",
        )

    submission = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment.id,
            AssignmentSubmission.student_id == student_id,
        )
        .first()
    )
    if not submission:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    submission.marks = payload.marks
    submission.feedback = payload.feedback.strip() if payload.feedback else None
    submission.graded_at = datetime.now(timezone.utc)
    submission.graded_by = current_user.id
    db.commit()
    db.refresh(submission)

    student = db.query(User).filter(User.id == student_id).first()
    return _submission_out(submission, student)
