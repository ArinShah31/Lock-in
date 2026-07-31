from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.models.classroom import Classroom, ClassroomStudent, ClassroomTeacher, MembershipStatus
from app.models.subject import Subject, SubjectMaterial
from app.models.user import User, UserRole
from app.schemas.subject import (
    SubjectCreate,
    SubjectMaterialCreate,
    SubjectMaterialOut,
    SubjectOut,
    SubjectUpdate,
    SyllabusUpdate,
)

router = APIRouter(tags=["subjects"])


def _get_classroom_or_404(db: Session, classroom_id: int) -> Classroom:
    classroom = db.query(Classroom).filter(Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classroom not found")
    return classroom


def _get_subject_or_404(db: Session, subject_id: int) -> Subject:
    subject = db.query(Subject).filter(Subject.id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Subject not found")
    return subject


def _user_can_view_classroom(db: Session, user: User, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if user.institution_id != classroom.institution_id:
        return False
    if user.role == UserRole.HOD:
        if classroom.department_id is None or user.department_id is None:
            return True
        return user.department_id == classroom.department_id
    if user.role == UserRole.CLASS_TEACHER and classroom.class_teacher_id == user.id:
        return True
    if user.role == UserRole.SUBJECT_TEACHER:
        assigned = (
            db.query(ClassroomTeacher)
            .filter(
                ClassroomTeacher.classroom_id == classroom.id,
                ClassroomTeacher.teacher_id == user.id,
                ClassroomTeacher.is_active.is_(True),
            )
            .first()
        )
        owns_subject = (
            db.query(Subject)
            .filter(
                Subject.classroom_id == classroom.id,
                Subject.teacher_id == user.id,
                Subject.is_active.is_(True),
            )
            .first()
        )
        return assigned is not None or owns_subject is not None
    if user.role == UserRole.STUDENT:
        return (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom.id,
                ClassroomStudent.student_id == user.id,
                ClassroomStudent.is_active.is_(True),
                ClassroomStudent.status == MembershipStatus.APPROVED,
            )
            .first()
            is not None
        )
    return False


def _user_can_manage_classroom(user: User, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    return user.role == UserRole.CLASS_TEACHER and classroom.class_teacher_id == user.id


def _user_can_edit_subject(user: User, subject: Subject, classroom: Classroom) -> bool:
    if user.role == UserRole.SUPER_ADMIN:
        return True
    if user.role == UserRole.CLASS_TEACHER and classroom.class_teacher_id == user.id:
        return True
    return user.role == UserRole.SUBJECT_TEACHER and subject.teacher_id == user.id


def _sync_classroom_teacher(db: Session, subject: Subject) -> None:
    existing = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == subject.classroom_id,
            ClassroomTeacher.teacher_id == subject.teacher_id,
            ClassroomTeacher.subject_label == subject.code,
        )
        .first()
    )
    if existing:
        existing.is_active = True
        existing.subject_id = subject.id
        return

    db.add(
        ClassroomTeacher(
            classroom_id=subject.classroom_id,
            teacher_id=subject.teacher_id,
            subject_id=subject.id,
            subject_label=subject.code,
        )
    )


@router.post("/subjects", response_model=SubjectOut, status_code=status.HTTP_201_CREATED)
def create_subject(
    payload: SubjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles([UserRole.SUPER_ADMIN, UserRole.CLASS_TEACHER])),
):
    classroom = _get_classroom_or_404(db, payload.classroom_id)
    if not _user_can_manage_classroom(current_user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage this classroom")

    teacher = db.query(User).filter(User.id == payload.teacher_id).first()
    if not teacher or teacher.role != UserRole.SUBJECT_TEACHER or not teacher.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid subject teacher")
    if teacher.institution_id != classroom.institution_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Teacher must belong to the same institution",
        )

    code = payload.code.upper()
    existing = (
        db.query(Subject)
        .filter(Subject.classroom_id == payload.classroom_id, Subject.code == code)
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subject code already exists in classroom")

    subject = Subject(
        classroom_id=payload.classroom_id,
        teacher_id=payload.teacher_id,
        name=payload.name,
        code=code,
        description=payload.description,
    )
    db.add(subject)
    db.flush()
    _sync_classroom_teacher(db, subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.get("/classrooms/{classroom_id}/subjects", response_model=list[SubjectOut])
def list_classroom_subjects(
    classroom_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    classroom = _get_classroom_or_404(db, classroom_id)
    if not _user_can_view_classroom(db, current_user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this classroom")

    query = db.query(Subject).filter(Subject.classroom_id == classroom_id, Subject.is_active.is_(True))

    if current_user.role == UserRole.STUDENT:
        query = query.filter(Subject.is_published.is_(True))
    elif current_user.role == UserRole.SUBJECT_TEACHER:
        query = query.filter(
            (Subject.teacher_id == current_user.id) | (Subject.is_published.is_(True))
        )

    return query.order_by(Subject.id).all()


@router.get("/subjects", response_model=list[SubjectOut])
def list_my_subjects(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.SUPER_ADMIN:
        return db.query(Subject).order_by(Subject.id).all()

    if current_user.role == UserRole.SUBJECT_TEACHER:
        return (
            db.query(Subject)
            .filter(Subject.teacher_id == current_user.id, Subject.is_active.is_(True))
            .order_by(Subject.id)
            .all()
        )

    if current_user.role == UserRole.CLASS_TEACHER:
        classroom_ids = [
            row.id
            for row in db.query(Classroom.id).filter(Classroom.class_teacher_id == current_user.id).all()
        ]
        if not classroom_ids:
            return []
        return (
            db.query(Subject)
            .filter(Subject.classroom_id.in_(classroom_ids), Subject.is_active.is_(True))
            .order_by(Subject.id)
            .all()
        )

    if current_user.role == UserRole.STUDENT:
        classroom_ids = [
            row.classroom_id
            for row in db.query(ClassroomStudent.classroom_id)
            .filter(
                ClassroomStudent.student_id == current_user.id,
                ClassroomStudent.is_active.is_(True),
                ClassroomStudent.status == MembershipStatus.APPROVED,
            )
            .all()
        ]
        if not classroom_ids:
            return []
        return (
            db.query(Subject)
            .filter(
                Subject.classroom_id.in_(classroom_ids),
                Subject.is_active.is_(True),
                Subject.is_published.is_(True),
            )
            .order_by(Subject.id)
            .all()
        )

    if current_user.role == UserRole.HOD and current_user.institution_id is not None:
        classroom_query = db.query(Classroom.id).filter(Classroom.institution_id == current_user.institution_id)
        if current_user.department_id is not None:
            classroom_query = classroom_query.filter(
                (Classroom.department_id == current_user.department_id) | (Classroom.department_id.is_(None))
            )
        classroom_ids = [row.id for row in classroom_query.all()]
        if not classroom_ids:
            return []
        return (
            db.query(Subject)
            .filter(Subject.classroom_id.in_(classroom_ids), Subject.is_active.is_(True))
            .order_by(Subject.id)
            .all()
        )

    return []


@router.get("/subjects/{subject_id}", response_model=SubjectOut)
def get_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_view_classroom(db, current_user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this subject")

    if current_user.role == UserRole.STUDENT and not subject.is_published:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subject is not published")

    if (
        current_user.role == UserRole.SUBJECT_TEACHER
        and subject.teacher_id != current_user.id
        and not subject.is_published
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this subject")

    return subject


@router.patch("/subjects/{subject_id}", response_model=SubjectOut)
def update_subject(
    subject_id: int,
    payload: SubjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_edit_subject(current_user, subject, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot edit this subject")

    updates = payload.model_dump(exclude_unset=True)

    # Subject teachers cannot reassign teacher or deactivate unless they own and class teacher/admin does it
    if current_user.role == UserRole.SUBJECT_TEACHER:
        forbidden = {"teacher_id", "is_active"}
        if forbidden.intersection(updates.keys()):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Subject teachers cannot reassign teacher or deactivate subject",
            )

    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].upper()
        conflict = (
            db.query(Subject)
            .filter(
                Subject.classroom_id == subject.classroom_id,
                Subject.code == new_code,
                Subject.id != subject_id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subject code already exists")
        updates["code"] = new_code

    if "teacher_id" in updates and updates["teacher_id"] is not None:
        teacher = db.query(User).filter(User.id == updates["teacher_id"]).first()
        if not teacher or teacher.role != UserRole.SUBJECT_TEACHER or not teacher.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid subject teacher")
        if teacher.institution_id != classroom.institution_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Teacher must belong to the same institution",
            )

    for field, value in updates.items():
        setattr(subject, field, value)

    _sync_classroom_teacher(db, subject)
    db.commit()
    db.refresh(subject)
    return subject


@router.delete("/subjects/{subject_id}", response_model=SubjectOut)
def deactivate_subject(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_manage_classroom(current_user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot deactivate this subject")

    subject.is_active = False
    subject.is_published = False
    db.commit()
    db.refresh(subject)
    return subject


@router.put("/subjects/{subject_id}/syllabus", response_model=SubjectOut)
def update_syllabus(
    subject_id: int,
    payload: SyllabusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_edit_subject(current_user, subject, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot update syllabus")

    if payload.syllabus_text is not None:
        subject.syllabus_text = payload.syllabus_text
    if payload.syllabus_file_url is not None:
        subject.syllabus_file_url = payload.syllabus_file_url

    db.commit()
    db.refresh(subject)
    return subject


@router.post(
    "/subjects/{subject_id}/materials",
    response_model=SubjectMaterialOut,
    status_code=status.HTTP_201_CREATED,
)
def add_material(
    subject_id: int,
    payload: SubjectMaterialCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_edit_subject(current_user, subject, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot add materials")

    if not payload.file_url and not payload.content_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide file_url or content_text",
        )

    material = SubjectMaterial(
        subject_id=subject_id,
        uploaded_by=current_user.id,
        title=payload.title,
        material_type=payload.material_type.upper(),
        file_url=payload.file_url,
        content_text=payload.content_text,
    )
    db.add(material)
    db.commit()
    db.refresh(material)
    return material


@router.get("/subjects/{subject_id}/materials", response_model=list[SubjectMaterialOut])
def list_materials(
    subject_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_view_classroom(db, current_user, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this subject")

    if current_user.role == UserRole.STUDENT and not subject.is_published:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Subject is not published")

    return (
        db.query(SubjectMaterial)
        .filter(SubjectMaterial.subject_id == subject_id, SubjectMaterial.is_active.is_(True))
        .order_by(SubjectMaterial.id.desc())
        .all()
    )


@router.delete("/subjects/{subject_id}/materials/{material_id}", response_model=SubjectMaterialOut)
def remove_material(
    subject_id: int,
    material_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subject = _get_subject_or_404(db, subject_id)
    classroom = _get_classroom_or_404(db, subject.classroom_id)

    if not _user_can_edit_subject(current_user, subject, classroom):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot remove materials")

    material = (
        db.query(SubjectMaterial)
        .filter(
            SubjectMaterial.id == material_id,
            SubjectMaterial.subject_id == subject_id,
            SubjectMaterial.is_active.is_(True),
        )
        .first()
    )
    if not material:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")

    material.is_active = False
    db.commit()
    db.refresh(material)
    return material
