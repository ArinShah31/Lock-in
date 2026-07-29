from fastapi import APIRouter, Depends

from app.api.deps import require_roles
from app.models.user import User, UserRole
from app.schemas.auth import UserOut

router = APIRouter(prefix="/rbac", tags=["rbac"])


@router.get("/admin-only")
def admin_only(
    current_user: User = Depends(require_roles([UserRole.SUPER_ADMIN])),
):
    return {"message": "Welcome Super Admin", "user": UserOut.model_validate(current_user)}


@router.get("/faculty-only")
def faculty_only(
    current_user: User = Depends(
        require_roles([UserRole.HOD, UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER, UserRole.SUPER_ADMIN])
    ),
):
    return {"message": "Welcome Faculty", "user": UserOut.model_validate(current_user)}


@router.get("/student-or-faculty")
def student_or_faculty(
    current_user: User = Depends(
        require_roles(
            [
                UserRole.SUPER_ADMIN,
                UserRole.HOD,
                UserRole.CLASS_TEACHER,
                UserRole.SUBJECT_TEACHER,
                UserRole.STUDENT,
            ]
        )
    ),
):
    return {"message": "Access granted", "user": UserOut.model_validate(current_user)}
