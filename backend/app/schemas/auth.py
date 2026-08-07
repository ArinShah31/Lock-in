from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.user import UserRole


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole
    institution_id: int | None = None
    department_id: int | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class GoogleAuthRequest(BaseModel):
    id_token: str = Field(min_length=20)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    role: UserRole
    is_active: bool
    coding_platform_enabled: bool = False
    avatar_url: str | None = None
    institution_id: int | None = None
    department_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


class CodingPlatformToggleRequest(BaseModel):
    enabled: bool


class AuthResponse(BaseModel):
    user: UserOut
    tokens: TokenPair
