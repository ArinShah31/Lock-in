from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import ensure_institution_access, get_current_user, require_roles
from app.core.database import get_db
from app.models.classroom import Classroom, ClassroomAnnouncement, ClassroomStudent, ClassroomTeacher
from app.models.institution import Department, Institution
from app.models.user import User, UserRole
from app.schemas.classroom import (
    AddStudentRequest,
    AnnouncementCreate,
    AnnouncementOut,
    AssignTeacherRequest,
    ClassroomCreate,
    ClassroomOut,
    ClassroomStudentOut,
    ClassroomTeacherOut,
    ClassroomUpdate,
)

router = APIRouter(prefix="/classrooms", tags=["classrooms"])


def _get_classroom_or_404(db: Session, classroom_id: int) -> Classroom:
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found")
    return classroom


def _user_can_view_classroom(db: Session, user: User, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if user.institution_id != classroom.institution_id:
        return False
    if user.role == UserRole.HOD:
        if classroom.department_id is None:
            return True
        return user.department_id == classroom.department_id or user.department_id is None
    if user.role == UserRole.CLASS_TEACHER and classroom.class_teacher_id == user.id:
        return True
    if user.role == UserRole.SUBJECT_TEACHER:
        return (
            db.query(ClassroomTeacher)
            .filter(
                ClassroomTeacher.classroom_id == classroom.id,
                ClassroomTeacher.teacher_id == user.id,
                ClassroomTeacher.is_active.is_(True),
            )
            .first()
            is not None
        )
    if user.role == UserRole.STUDENT:
        return (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom.id,
                ClassroomStudent.student_id == user.id,
                ClassroomStudent.is_active.is_(True),
            )
            .first()
            is not None
        )
    return False


def _user_can_manage_classroom(user: User, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    return user.role == UserRole.CLASS_TEACHER and classroom.class_teacher_id == user.id


def _ensure_view_access(db: Session, user: User, classroom: Classroom) -> None:
    if not _user_can_view_classroom(db, user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this classroom")


def _ensure_manage_access(user: User, classroom: Classroom) -> None:
    if not _user_can_manage_classroom(user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage this classroom")


@router.post("", response_model=ClassroomOut, status_code=status.HTTP_201_CREATED)
def create_classroom(
    payload: ClassroomCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([UserRole.SUPER_ADMIN, UserRole.CLASS_TEACHER])),
):
    institution = db.query(Institution).filter(Institution.id == payload.institution_id).first()
    if not institution or not institution.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or inactive institution")

    if current_user.role == UserRole.CLASS_TEACHER:
        ensure_institution_access(current_user, payload.institution_id)

    if payload.department_id is not None:
        department = db.query(Department).filter(Department.id == payload.department_id).first()
        if not department or not department.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or inactive department")
        if department.institution_id != payload.institution_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Department does not belong to the given institution",
            )

    existing = (
        db.query(Classroom)
        .filter(
            Classroom.institution_id == payload.institution_id,
            Classroom.code == payload.code.upper(),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Classroom code already exists")

    if current_user.role == UserRole.CLASS_TEACHER:
        class_teacher_id = current_user.id
    else:
        if payload.class_teacher_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="class_teacher_id is required when SUPER_ADMIN creates a classroom",
            )
        teacher = db.query(User).filter(User.id == payload.class_teacher_id).first()
        if not teacher or teacher.role != UserRole.CLASS_TEACHER or not teacher.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid class teacher")
        if teacher.institution_id != payload.institution_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Class teacher must belong to the same institution",
            )
        class_teacher_id = teacher.id

    classroom = Classroom(
        institution_id=payload.institution_id,
        department_id=payload.department_id,
        class_teacher_id=class_teacher_id,
        name=payload.name,
        code=payload.code.upper(),
        academic_year=payload.academic_year,
        description=payload.description,
    )
    db.add(classroom)
    db.commit()
    db.refresh(classroom)
    return classroom


@router.get("", response_model=list[ClassroomOut])
def list_classrooms(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(Classroom)

    if current_user.role == UserRole.SUPER_ADMIN:
        return query.order_by(Classroom.id).all()

    if current_user.institution_id is None:
        return []

    query = query.filter(Classroom.institution_id == current_user.institution_id)

    if current_user.role == UserRole.HOD:
        if current_user.department_id is not None:
            query = query.filter(
                (Classroom.department_id == current_user.department_id) | (Classroom.department_id.is_(None))
            )
        return query.order_by(Classroom.id).all()

    if current_user.role == UserRole.CLASS_TEACHER:
        return query.filter(Classroom.class_teacher_id == current_user.id).order_by(Classroom.id).all()

    if current_user.role == UserRole.SUBJECT_TEACHER:
        classroom_ids = [
            row.classroom_id
            for row in db.query(ClassroomTeacher.classroom_id)
            .filter(
                ClassroomTeacher.teacher_id == current_user.id,
                ClassroomTeacher.is_active.is_(True),
            )
            .all()
        ]
        if not classroom_ids:
            return []
        return query.filter(Classroom.id.in_(classroom_ids)).order_by(Classroom.id).all()

    if current_user.role == UserRole.STUDENT:
        classroom_ids = [
            row.classroom_id
            for row in db.query(ClassroomStudent.classroom_id)
            .filter(
                ClassroomStudent.student_id == current_user.id,
                ClassroomStudent.is_active.is_(True),
            )
            .all()
        ]
        if not classroom_ids:
            return []
        return query.filter(Classroom.id.in_(classroom_ids)).order_by(Classroom.id).all()

    return []


@router.get("/{classroom_id}", response_model=ClassroomOut)
def get_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    return classroom


@router.patch("/{classroom_id}", response_model=ClassroomOut)
def update_classroom(
    classroom_id: int,
    payload: ClassroomUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)

    updates = payload.model_dump(exclude_unset=True)

    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].upper()
        conflict = (
            db.query(Classroom)
            .filter(
                Classroom.institution_id == classroom.institution_id,
                Classroom.code == new_code,
                Classroom.id != classroom_id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Classroom code already exists")
        updates["code"] = new_code

    if "department_id" in updates and updates["department_id"] is not None:
        department = db.query(Department).filter(Department.id == updates["department_id"]).first()
        if not department or department.institution_id != classroom.institution_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid department")

    if "class_teacher_id" in updates and updates["class_teacher_id"] is not None:
        if current_user.role != UserRole.SUPER_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only SUPER_ADMIN can reassign class teacher",
            )
        teacher = db.query(User).filter(User.id == updates["class_teacher_id"]).first()
        if not teacher or teacher.role != UserRole.CLASS_TEACHER or not teacher.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid class teacher")
        if teacher.institution_id != classroom.institution_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Class teacher must belong to the same institution",
            )

    for field, value in updates.items():
        setattr(classroom, field, value)

    db.commit()
    db.refresh(classroom)
    return classroom


@router.delete("/{classroom_id}", response_model=ClassroomOut)
def deactivate_classroom(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)
    classroom.is_active = False
    db.commit()
    db.refresh(classroom)
    return classroom


@router.post(
    "/{classroom_id}/students",
    response_model=ClassroomStudentOut,
    status_code=status.HTTP_201_CREATED,
)
def add_student(
    classroom_id: int,
    payload: AddStudentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)

    student = db.query(User).filter(User.id == payload.student_id).first()
    if not student or student.role != UserRole.STUDENT or not student.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid student")
    if student.institution_id != classroom.institution_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Student must belong to the same institution",
        )

    existing = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == payload.student_id,
        )
        .first()
    )
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Student already enrolled")
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing

    membership = ClassroomStudent(classroom_id=classroom_id, student_id=payload.student_id)
    db.add(membership)
    db.commit()
    db.refresh(membership)
    return membership


@router.get("/{classroom_id}/students", response_model=list[ClassroomStudentOut])
def list_students(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    return (
        db.query(ClassroomStudent)
        .filter(ClassroomStudent.classroom_id == classroom_id, ClassroomStudent.is_active.is_(True))
        .order_by(ClassroomStudent.id)
        .all()
    )


@router.delete("/{classroom_id}/students/{student_id}", response_model=ClassroomStudentOut)
def remove_student(
    classroom_id: int,
    student_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)

    membership = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
            ClassroomStudent.is_active.is_(True),
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Student not enrolled")

    membership.is_active = False
    db.commit()
    db.refresh(membership)
    return membership


@router.post(
    "/{classroom_id}/teachers",
    response_model=ClassroomTeacherOut,
    status_code=status.HTTP_201_CREATED,
)
def assign_teacher(
    classroom_id: int,
    payload: AssignTeacherRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)

    teacher = db.query(User).filter(User.id == payload.teacher_id).first()
    if not teacher or teacher.role != UserRole.SUBJECT_TEACHER or not teacher.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid subject teacher")
    if teacher.institution_id != classroom.institution_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher must belong to the same institution",
        )

    subject_label = payload.subject_label.upper()
    existing = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == payload.teacher_id,
            ClassroomTeacher.subject_label == subject_label,
        )
        .first()
    )
    if existing:
        if existing.is_active:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Teacher already assigned")
        existing.is_active = True
        db.commit()
        db.refresh(existing)
        return existing

    assignment = ClassroomTeacher(
        classroom_id=classroom_id,
        teacher_id=payload.teacher_id,
        subject_label=subject_label,
    )
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


@router.get("/{classroom_id}/teachers", response_model=list[ClassroomTeacherOut])
def list_teachers(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    return (
        db.query(ClassroomTeacher)
        .filter(ClassroomTeacher.classroom_id == classroom_id, ClassroomTeacher.is_active.is_(True))
        .order_by(ClassroomTeacher.id)
        .all()
    )


@router.delete("/{classroom_id}/teachers/{assignment_id}", response_model=ClassroomTeacherOut)
def remove_teacher(
    classroom_id: int,
    assignment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)

    assignment = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.id == assignment_id,
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.is_active.is_(True),
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher assignment not found")

    assignment.is_active = False
    db.commit()
    db.refresh(assignment)
    return assignment


@router.post(
    "/{classroom_id}/announcements",
    response_model=AnnouncementOut,
    status_code=status.HTTP_201_CREATED,
)
def create_announcement(
    classroom_id: int,
    payload: AnnouncementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_manage_access(current_user, classroom)

    announcement = ClassroomAnnouncement(
        classroom_id=classroom_id,
        author_id=current_user.id,
        title=payload.title,
        body=payload.body,
    )
    db.add(announcement)
    db.commit()
    db.refresh(announcement)
    return announcement


@router.get("/{classroom_id}/announcements", response_model=list[AnnouncementOut])
def list_announcements(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    _ensure_view_access(db, current_user, classroom)
    return (
        db.query(ClassroomAnnouncement)
        .filter(
            ClassroomAnnouncement.classroom_id == classroom_id,
            ClassroomAnnouncement.is_active.is_(True),
        )
        .order_by(ClassroomAnnouncement.id.desc())
        .all()
    )
