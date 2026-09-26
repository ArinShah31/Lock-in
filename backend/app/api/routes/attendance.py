from io import BytesIO

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.routes.classrooms import _ensure_view_access, _get_classroom_or_404
from app.core.database import get_db
from app.models.attendance import AttendanceRecord, AttendanceSession
from app.models.classroom import Classroom
from app.models.subject import Subject
from app.models.user import User, UserRole
from app.schemas.attendance import (
    AttendanceMark,
    AttendanceSessionCreate,
    AttendanceSessionOut,
    AttendanceSessionUpdate,
    AttendanceStudent,
    AttendanceSummaryOut,
    MyAttendanceOut,
    MyLecture,
    MySubjectAttendance,
    StudentSummaryRow,
    SubjectAttendanceOut,
    SubjectPercent,
    SummarySubject,
)
from app.services.attendance import approved_students, load_snapshot
from app.services.attendance_excel import build_workbook, rebuild_workbook, workbook_path

router = APIRouter(tags=["attendance"])

TEACHER_ROLES = (UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER)
XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


# --------------------------------------------------------------------------- access


def _is_teacher(user: User) -> bool:
    return user.role in TEACHER_ROLES


def _get_subject_in_classroom(db: Session, classroom: Classroom, subject_id: int) -> Subject:
    subject = (
        db.query(Subject)
        .filter(Subject.id == subject_id, Subject.classroom_id == classroom.id)
        .first()
    )
    if not subject or not subject.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")
    return subject


def _can_write(user: User, subject: Subject, classroom: Classroom) -> bool:
    """A subject's own teacher, or the classroom's class teacher, may mark attendance."""
    return _is_teacher(user) and (
        subject.teacher_id == user.id or classroom.class_teacher_id == user.id
    )


def _readable_subject_ids(db: Session, user: User, classroom: Classroom) -> set[int] | None:
    """None = every subject in the classroom (class teacher); else the teacher's own."""
    if not _is_teacher(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teachers only")
    if classroom.class_teacher_id == user.id:
        return None
    return {
        row[0]
        for row in db.query(Subject.id).filter(
            Subject.classroom_id == classroom.id,
            Subject.teacher_id == user.id,
            Subject.is_active.is_(True),
        )
    }


def _ensure_can_read_subject(
    db: Session, user: User, classroom: Classroom, subject: Subject
) -> None:
    allowed = _readable_subject_ids(db, user, classroom)
    if allowed is not None and subject.id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your subject")


def _ensure_can_write(user: User, subject: Subject, classroom: Classroom) -> None:
    if not _can_write(user, subject, classroom):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the subject's teacher or the class teacher can mark attendance",
        )


# --------------------------------------------------------------------------- helpers


def _session_out(session: AttendanceSession) -> AttendanceSessionOut:
    return AttendanceSessionOut(
        id=session.id,
        subject_id=session.subject_id,
        held_on=session.held_on,
        title=session.title,
        marks=[
            AttendanceMark(student_id=r.student_id, present=r.present)
            for r in sorted(session.records, key=lambda r: r.student_id)
        ],
    )


def _validated_marks(db: Session, classroom_id: int, marks: list[AttendanceMark]) -> dict[int, bool]:
    """Every approved student gets a mark (unlisted students default to absent)."""
    roster = {s.id for s in approved_students(db, classroom_id)}
    result = {sid: False for sid in roster}
    for mark in marks:
        if mark.student_id not in roster:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Student {mark.student_id} is not an approved member of this classroom",
            )
        result[mark.student_id] = mark.present
    return result


def _ensure_unique(
    db: Session, subject_id: int, held_on, title: str, exclude_id: int | None = None
) -> None:
    q = db.query(AttendanceSession).filter(
        AttendanceSession.subject_id == subject_id,
        AttendanceSession.held_on == held_on,
        AttendanceSession.title == title,
    )
    if exclude_id is not None:
        q = q.filter(AttendanceSession.id != exclude_id)
    if q.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A lecture with this date and title already exists for the subject",
        )


def _get_session_or_404(db: Session, session_id: int) -> AttendanceSession:
    session = db.query(AttendanceSession).filter(AttendanceSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lecture not found")
    return session


# --------------------------------------------------------------------------- teacher routes


@router.post(
    "/classrooms/{classroom_id}/subjects/{subject_id}/attendance",
    response_model=AttendanceSessionOut,
    status_code=status.HTTP_201_CREATED,
)
def create_session(
    classroom_id: int,
    subject_id: int,
    payload: AttendanceSessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    subject = _get_subject_in_classroom(db, classroom, subject_id)
    _ensure_can_write(current_user, subject, classroom)
    title = payload.title.strip()
    _ensure_unique(db, subject.id, payload.held_on, title)
    marks = _validated_marks(db, classroom.id, payload.marks)

    session = AttendanceSession(
        classroom_id=classroom.id,
        subject_id=subject.id,
        held_on=payload.held_on,
        title=title,
        created_by=current_user.id,
    )
    session.records = [AttendanceRecord(student_id=sid, present=p) for sid, p in marks.items()]
    db.add(session)
    db.commit()
    db.refresh(session)
    rebuild_workbook(db, classroom.id)
    return _session_out(session)


@router.put("/attendance/sessions/{session_id}", response_model=AttendanceSessionOut)
def update_session(
    session_id: int,
    payload: AttendanceSessionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(db, session_id)
    classroom = _get_classroom_or_404(db, session.classroom_id)
    _ensure_view_access(db, current_user, classroom)
    subject = _get_subject_in_classroom(db, classroom, session.subject_id)
    _ensure_can_write(current_user, subject, classroom)

    held_on = payload.held_on or session.held_on
    title = session.title if payload.title is None else payload.title.strip()
    if held_on != session.held_on or title != session.title:
        _ensure_unique(db, subject.id, held_on, title, exclude_id=session.id)
    if payload.marks is not None:
        marks = _validated_marks(db, classroom.id, payload.marks)
        # Update in place: replacing the rows would INSERT before the DELETE and
        # trip uq_attendance_record.
        existing = {r.student_id: r for r in session.records}
        for sid, present in marks.items():
            if sid in existing:
                existing[sid].present = present
            else:
                session.records.append(AttendanceRecord(student_id=sid, present=present))
        for sid, record in existing.items():
            if sid not in marks:
                session.records.remove(record)
    session.held_on = held_on
    session.title = title
    db.commit()
    db.refresh(session)
    rebuild_workbook(db, classroom.id)
    return _session_out(session)


@router.delete("/attendance/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = _get_session_or_404(db, session_id)
    classroom = _get_classroom_or_404(db, session.classroom_id)
    _ensure_view_access(db, current_user, classroom)
    subject = _get_subject_in_classroom(db, classroom, session.subject_id)
    _ensure_can_write(current_user, subject, classroom)
    db.delete(session)
    db.commit()
    rebuild_workbook(db, classroom.id)


@router.get(
    "/classrooms/{classroom_id}/subjects/{subject_id}/attendance",
    response_model=SubjectAttendanceOut,
)
def get_subject_attendance(
    classroom_id: int,
    subject_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    subject = _get_subject_in_classroom(db, classroom, subject_id)
    _ensure_can_read_subject(db, current_user, classroom, subject)
    sessions = (
        db.query(AttendanceSession)
        .filter(AttendanceSession.subject_id == subject.id)
        .order_by(AttendanceSession.held_on.desc(), AttendanceSession.id.desc())
        .all()
    )
    return SubjectAttendanceOut(
        subject_id=subject.id,
        subject_name=subject.name,
        subject_code=subject.code,
        can_edit=_can_write(current_user, subject, classroom),
        students=[
            AttendanceStudent(id=s.id, full_name=s.full_name, email=s.email)
            for s in approved_students(db, classroom.id)
        ],
        sessions=[_session_out(s) for s in sessions],
    )


@router.get("/classrooms/{classroom_id}/attendance/summary", response_model=AttendanceSummaryOut)
def get_summary(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    snap = load_snapshot(db, classroom.id, _readable_subject_ids(db, current_user, classroom))
    rows = []
    for student in snap.students:
        per_subject, final = snap.student_stats(student.id)
        rows.append(
            StudentSummaryRow(
                student_id=student.id,
                full_name=student.full_name,
                email=student.email,
                subjects=[
                    SubjectPercent(subject_id=sid, **stats) for sid, stats in per_subject.items()
                ],
                final_percent=final,
            )
        )
    return AttendanceSummaryOut(
        subjects=[SummarySubject(id=s.id, name=s.name, code=s.code) for s in snap.subjects],
        rows=rows,
    )


@router.get("/classrooms/{classroom_id}/attendance/export.xlsx")
def export_workbook(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    allowed = _readable_subject_ids(db, current_user, classroom)
    filename = f"attendance_{classroom.code}.xlsx"
    if allowed is None:
        path = workbook_path(classroom.id)
        if not path.exists():
            rebuild_workbook(db, classroom.id)
        if path.exists():
            return FileResponse(path, media_type=XLSX_MEDIA, filename=filename)
    # Subject teachers get a workbook limited to their own subjects (not persisted).
    buf = BytesIO()
    build_workbook(load_snapshot(db, classroom.id, allowed)).save(buf)
    return Response(
        content=buf.getvalue(),
        media_type=XLSX_MEDIA,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --------------------------------------------------------------------------- student route


@router.get("/me/classrooms/{classroom_id}/attendance", response_model=MyAttendanceOut)
def my_attendance(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.STUDENT:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Students only")
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    snap = load_snapshot(db, classroom.id)
    per_subject, final = snap.student_stats(current_user.id)
    by_id = {s.id: s for s in snap.sessions}
    out = []
    for subject in snap.subjects:
        lectures = []
        for session_id in snap.sessions_by_subject.get(subject.id, []):
            mark = snap.marks.get((session_id, current_user.id))
            if mark is None:
                continue
            sess = by_id[session_id]
            lectures.append(
                MyLecture(session_id=sess.id, held_on=sess.held_on, title=sess.title, present=mark)
            )
        lectures.reverse()
        out.append(
            MySubjectAttendance(
                subject_id=subject.id,
                subject_name=subject.name,
                subject_code=subject.code,
                lectures=lectures,
                **per_subject[subject.id],
            )
        )
    return MyAttendanceOut(subjects=out, final_percent=final)
