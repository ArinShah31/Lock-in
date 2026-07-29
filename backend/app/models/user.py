from enum import Enum

from sqlalchemy import Boolean, Enum as SqlEnum, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class UserRole(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    HOD = "HOD"
    CLASS_TEACHER = "CLASS_TEACHER"
    SUBJECT_TEACHER = "SUBJECT_TEACHER"
    STUDENT = "STUDENT"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(SqlEnum(UserRole), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
