from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.core.database import get_db
from app.core.security import get_password_hash
from app.models.institution import Department, Institution
from app.models.user import User, UserRole
from app.schemas.auth import UserOut
from app.schemas.user import CreateUserRequest

router = APIRouter(prefix="/users", tags=["users"])

TEACHER_ROLES = {UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER}


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: CreateUserRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    institution_id: int | None = None
    department_id: int | None = None

    if current_user.role == UserRole.SUPER_ADMIN:
        if payload.role != UserRole.INSTITUTION_ADMIN:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Super Admin can only create Institution Admin accounts",
            )
        if payload.institution_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="institution_id is required")
        institution = db.query(Institution).filter(Institution.id == payload.institution_id).first()
        if not institution or not institution.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or inactive institution")
        institution_id = payload.institution_id

    elif current_user.role == UserRole.INSTITUTION_ADMIN:
        if payload.role != UserRole.HOD:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Institution Admin can only create HOD accounts",
            )
        if payload.department_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="department_id is required")
        department = db.query(Department).filter(Department.id == payload.department_id).first()
        if not department or not department.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or inactive department")
        if department.institution_id != current_user.institution_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Department not in your institution")
        institution_id = current_user.institution_id
        department_id = payload.department_id

    elif current_user.role == UserRole.HOD:
        if payload.role not in TEACHER_ROLES:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="HOD can only create Class Teacher or Subject Teacher accounts",
            )
        if current_user.department_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="HOD has no department assigned")
        institution_id = current_user.institution_id
        department_id = current_user.department_id

    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions to create users")

    user = User(
        full_name=payload.full_name,
        email=payload.email.lower(),
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
        institution_id=institution_id,
        department_id=department_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(User).filter(User.is_active.is_(True))

    if current_user.role == UserRole.SUPER_ADMIN:
        return query.order_by(User.id).all()

    if current_user.role == UserRole.INSTITUTION_ADMIN:
        if not current_user.institution_id:
            return []
        return query.filter(User.institution_id == current_user.institution_id).order_by(User.id).all()

    if current_user.role == UserRole.HOD:
        if not current_user.department_id:
            return []
        return query.filter(User.department_id == current_user.department_id).order_by(User.id).all()

    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions to list users")
