from pydantic import BaseModel, EmailStr, Field

from app.models.user import UserRole


class CreateUserRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole
    institution_id: int | None = None
    department_id: int | None = None
