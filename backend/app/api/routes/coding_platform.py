from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from jose import jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.classroom import Classroom, ClassroomStudent, ClassroomTeacher, MembershipStatus
from app.models.subject import Subject
from app.models.user import User, UserRole
from app.services.coding_platform_sync import SYNCABLE_ROLES, sync_user_to_coding_platform

router = APIRouter(prefix="/coding-platform", tags=["coding-platform"])


class CodingAccessOut(BaseModel):
    enabled: bool
    reason: str | None = None
    frontend_url: str


class SsoTokenOut(BaseModel):
    token: str
    frontend_url: str
    expires_in_seconds: int = 120


class CodingStudentOut(BaseModel):
    id: int
    full_name: str
    email: str


def _teacher_classroom_ids(db: Session, teacher: User) -> list[int]:
    if teacher.role == UserRole.CLASS_TEACHER:
        rows = (
            db.query(Classroom.id)
            .filter(Classroom.class_teacher_id == teacher.id, Classroom.is_active.is_(True))
            .all()
        )
        return [r[0] for r in rows]

    if teacher.role == UserRole.SUBJECT_TEACHER:
        ids: set[int] = set()
        owned = (
            db.query(Classroom.id)
            .filter(Classroom.class_teacher_id == teacher.id, Classroom.is_active.is_(True))
            .all()
        )
        ids.update(r[0] for r in owned)
        linked = (
            db.query(ClassroomTeacher.classroom_id)
            .filter(ClassroomTeacher.teacher_id == teacher.id, ClassroomTeacher.is_active.is_(True))
            .all()
        )
        ids.update(r[0] for r in linked)
        subject_rooms = (
            db.query(Subject.classroom_id)
            .filter(Subject.teacher_id == teacher.id, Subject.is_active.is_(True))
            .all()
        )
        ids.update(r[0] for r in subject_rooms)
        return sorted(ids)

    return []


def _student_has_coding_access(db: Session, student: User) -> bool:
    memberships = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.student_id == student.id,
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
        )
        .all()
    )
    if not memberships:
        return False

    classroom_ids = [m.classroom_id for m in memberships]
    classrooms = db.query(Classroom).filter(Classroom.id.in_(classroom_ids), Classroom.is_active.is_(True)).all()
    teacher_ids: set[int] = set()
    for room in classrooms:
        teacher_ids.add(room.class_teacher_id)

    subject_links = (
        db.query(ClassroomTeacher)
        .filter(ClassroomTeacher.classroom_id.in_(classroom_ids), ClassroomTeacher.is_active.is_(True))
        .all()
    )
    for link in subject_links:
        teacher_ids.add(link.teacher_id)

    subject_teachers = (
        db.query(Subject.teacher_id)
        .filter(Subject.classroom_id.in_(classroom_ids), Subject.is_active.is_(True))
        .all()
    )
    for (tid,) in subject_teachers:
        teacher_ids.add(tid)

    if not teacher_ids:
        return False

    enabled_count = (
        db.query(User)
        .filter(
            User.id.in_(teacher_ids),
            User.coding_platform_enabled.is_(True),
            User.is_active.is_(True),
        )
        .count()
    )
    return enabled_count > 0


def user_has_coding_access(db: Session, user: User) -> tuple[bool, str | None]:
    if user.role in {UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER}:
        if user.coding_platform_enabled:
            return True, None
        return False, "Ask your HOD to enable the coding platform."

    if user.role == UserRole.STUDENT:
        if _student_has_coding_access(db, user):
            return True, None
        return False, "Ask your HOD to enable the coding platform for your teachers."

    return False, "Coding platform is not available for your role."


@router.get("/access", response_model=CodingAccessOut)
def coding_access(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    enabled, reason = user_has_coding_access(db, current_user)
    return CodingAccessOut(
        enabled=enabled,
        reason=reason,
        frontend_url=settings.coding_platform_frontend_url.rstrip("/"),
    )


@router.get("/students", response_model=list[CodingStudentOut])
def list_coding_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role not in {UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teachers only")

    classroom_ids = _teacher_classroom_ids(db, current_user)
    if not classroom_ids:
        return []

    rows = (
        db.query(User)
        .join(ClassroomStudent, ClassroomStudent.student_id == User.id)
        .filter(
            ClassroomStudent.classroom_id.in_(classroom_ids),
            ClassroomStudent.status == MembershipStatus.APPROVED,
            ClassroomStudent.is_active.is_(True),
            User.role == UserRole.STUDENT,
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
        .all()
    )

    seen: set[int] = set()
    out: list[CodingStudentOut] = []
    for student in rows:
        if student.id in seen:
            continue
        seen.add(student.id)
        sync_user_to_coding_platform(student)
        out.append(
            CodingStudentOut(id=student.id, full_name=student.full_name, email=student.email)
        )
    return out


@router.post("/sso-token", response_model=SsoTokenOut)
def issue_sso_token(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    enabled, reason = user_has_coding_access(db, current_user)
    if not enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=reason or "Coding platform is not enabled",
        )
    if current_user.role not in SYNCABLE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role cannot use coding platform")

    synced = sync_user_to_coding_platform(current_user)
    if not synced:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                "Could not sync your account to the coding platform. "
                "Ensure the coding API is running and CODING_PLATFORM_API_URL / CODING_SYNC_SECRET match."
            ),
        )

    expire = datetime.now(timezone.utc) + timedelta(seconds=120)
    token = jwt.encode(
        {
            "sub": str(current_user.id),
            "email": current_user.email,
            "full_name": current_user.full_name,
            "astra_role": current_user.role.value,
            "type": "coding_sso",
            "exp": expire,
        },
        settings.coding_sso_secret,
        algorithm=settings.jwt_algorithm,
    )
    return SsoTokenOut(
        token=token,
        frontend_url=settings.coding_platform_frontend_url.rstrip("/"),
        expires_in_seconds=120,
    )
