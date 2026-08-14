from collections.abc import Iterable

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import TokenType, decode_token
from app.models.user import User, UserRole

bearer_scheme = HTTPBearer(auto_error=True)
bearer_optional = HTTPBearer(auto_error=False)


def _user_from_access_token(token: str, db: Session) -> User:
    try:
        payload = decode_token(token)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid. Please sign in again.",
        )

    if payload.get("type") != TokenType.ACCESS.value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token type")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    return _user_from_access_token(credentials.credentials, db)


def get_media_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_optional),
    access_token: str | None = Query(None),
    db: Session = Depends(get_db),
) -> User:
    """Allow <img>/<video> tags to authenticate with ?access_token=."""
    raw = (credentials.credentials if credentials else None) or (access_token or "").strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return _user_from_access_token(raw, db)


def require_roles(allowed_roles: Iterable[UserRole]):
    allowed_set = set(allowed_roles)

    def role_checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_set:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return role_checker


def ensure_institution_access(user: User, institution_id: int) -> None:
    if user.role == UserRole.SUPER_ADMIN:
        return
    if user.institution_id != institution_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a member of this institution")
