from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import ensure_institution_access, get_current_user, require_roles
from app.core.database import get_db
from app.models.institution import Department, Institution
from app.models.user import User, UserRole
from app.schemas.institution import (
    DepartmentCreate,
    DepartmentOut,
    DepartmentUpdate,
    InstitutionCreate,
    InstitutionOut,
    InstitutionUpdate,
)

router = APIRouter(tags=["institutions"])


@router.post("/institutions", response_model=InstitutionOut, status_code=status.HTTP_201_CREATED)
def create_institution(
    payload: InstitutionCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    existing = db.query(Institution).filter(Institution.code == payload.code.upper()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Institution code already exists")

    institution = Institution(
        name=payload.name,
        code=payload.code.upper(),
        address=payload.address,
    )
    db.add(institution)
    db.commit()
    db.refresh(institution)
    return institution


@router.get("/institutions", response_model=list[InstitutionOut])
def list_institutions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.SUPER_ADMIN:
        return db.query(Institution).order_by(Institution.id).all()

    if not current_user.institution_id:
        return []

    institution = db.query(Institution).filter(Institution.id == current_user.institution_id).first()
    return [institution] if institution else []


@router.get("/institutions/{institution_id}", response_model=InstitutionOut)
def get_institution(
    institution_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    institution = db.query(Institution).filter(Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution not found")

    ensure_institution_access(current_user, institution_id)
    return institution


@router.patch("/institutions/{institution_id}", response_model=InstitutionOut)
def update_institution(
    institution_id: int,
    payload: InstitutionUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    institution = db.query(Institution).filter(Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution not found")

    updates = payload.model_dump(exclude_unset=True)
    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].upper()
        conflict = (
            db.query(Institution)
            .filter(Institution.code == new_code, Institution.id != institution_id)
            .first()
        )
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Institution code already exists")
        updates["code"] = new_code

    for field, value in updates.items():
        setattr(institution, field, value)

    db.commit()
    db.refresh(institution)
    return institution


@router.delete("/institutions/{institution_id}", response_model=InstitutionOut)
def deactivate_institution(
    institution_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    institution = db.query(Institution).filter(Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution not found")

    institution.is_active = False
    db.commit()
    db.refresh(institution)
    return institution


@router.post(
    "/institutions/{institution_id}/departments",
    response_model=DepartmentOut,
    status_code=status.HTTP_201_CREATED,
)
def create_department(
    institution_id: int,
    payload: DepartmentCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    institution = db.query(Institution).filter(Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution not found")
    if not institution.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Institution is inactive")

    existing = (
        db.query(Department)
        .filter(
            Department.institution_id == institution_id,
            Department.code == payload.code.upper(),
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department code already exists")

    department = Department(
        institution_id=institution_id,
        name=payload.name,
        code=payload.code.upper(),
    )
    db.add(department)
    db.commit()
    db.refresh(department)
    return department


@router.get("/institutions/{institution_id}/departments", response_model=list[DepartmentOut])
def list_departments(
    institution_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    institution = db.query(Institution).filter(Institution.id == institution_id).first()
    if not institution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Institution not found")

    ensure_institution_access(current_user, institution_id)
    return (
        db.query(Department)
        .filter(Department.institution_id == institution_id)
        .order_by(Department.id)
        .all()
    )


@router.patch("/departments/{department_id}", response_model=DepartmentOut)
def update_department(
    department_id: int,
    payload: DepartmentUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    updates = payload.model_dump(exclude_unset=True)
    if "code" in updates and updates["code"] is not None:
        new_code = updates["code"].upper()
        conflict = (
            db.query(Department)
            .filter(
                Department.institution_id == department.institution_id,
                Department.code == new_code,
                Department.id != department_id,
            )
            .first()
        )
        if conflict:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Department code already exists")
        updates["code"] = new_code

    for field, value in updates.items():
        setattr(department, field, value)

    db.commit()
    db.refresh(department)
    return department


@router.delete("/departments/{department_id}", response_model=DepartmentOut)
def deactivate_department(
    department_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    department = db.query(Department).filter(Department.id == department_id).first()
    if not department:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Department not found")

    department.is_active = False
    db.commit()
    db.refresh(department)
    return department
