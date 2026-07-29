from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class TokenType(str, Enum):
    ACCESS = "access"
    REFRESH = "refresh"


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def _create_token(subject: str, role: str, token_type: TokenType, expires_delta: timedelta) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    payload: dict[str, Any] = {"sub": subject, "role": role, "type": token_type.value, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(subject: str, role: str) -> str:
    return _create_token(
        subject=subject,
        role=role,
        token_type=TokenType.ACCESS,
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_refresh_token(subject: str, role: str) -> str:
    return _create_token(
        subject=subject,
        role=role,
        token_type=TokenType.REFRESH,
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
    )


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Invalid token") from exc
