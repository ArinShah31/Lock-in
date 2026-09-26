from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy.orm import Session
import secrets

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.models.user import User, UserRole
from app.schemas.auth import (
    AuthResponse,
    GoogleAuthRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
    UserOut,
)
from app.schemas.profile import ChangePasswordRequest, ProfileOut, UpdateMeRequest
from app.services.avatar_upload import read_avatar_bytes, save_avatar_file, validate_avatar_upload
from app.services.coding_platform_sync import sync_user_to_coding_platform
from app.services.theory_platform_sync import sync_user_to_theory_platform
from app.services.profile import build_user_profile

router = APIRouter(prefix="/auth", tags=["auth"])


PROVISIONED_ROLES = {
    UserRole.SUPER_ADMIN,
    UserRole.INSTITUTION_ADMIN,
    UserRole.HOD,
    UserRole.CLASS_TEACHER,
    UserRole.SUBJECT_TEACHER,
}


def _issue_auth_response(user: User) -> AuthResponse:
    tokens = TokenPair(
        access_token=create_access_token(subject=str(user.id), role=user.role.value),
        refresh_token=create_refresh_token(subject=str(user.id), role=user.role.value),
    )
    return AuthResponse(user=UserOut.model_validate(user), tokens=tokens)


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user_count = db.query(User).count()
    if payload.role in PROVISIONED_ROLES:
        if payload.role == UserRole.SUPER_ADMIN and user_count == 0:
            pass  # bootstrap first Super Admin
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This role must be created by an administrator",
            )

    if payload.role == UserRole.SUPER_ADMIN and user_count == 0:
        if payload.institution_id is not None or payload.department_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="SUPER_ADMIN cannot be assigned to an institution or department",
            )

    user = User(
        full_name=payload.full_name,
        email=payload.email.lower(),
        hashed_password=get_password_hash(payload.password),
        role=payload.role,
        institution_id=None if payload.role == UserRole.STUDENT else payload.institution_id,
        department_id=None if payload.role == UserRole.STUDENT else payload.department_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    sync_user_to_coding_platform(user)
    sync_user_to_theory_platform(user)

    return _issue_auth_response(user)


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")

    sync_user_to_coding_platform(user)
    sync_user_to_theory_platform(user)

    return _issue_auth_response(user)


@router.post("/google", response_model=AuthResponse)
def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    if not settings.google_client_id.strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Sign-In is not configured",
        )

    try:
        claims = google_id_token.verify_oauth2_token(
            payload.id_token,
            google_requests.Request(),
            settings.google_client_id.strip(),
        )
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token")

    if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token issuer")

    email = (claims.get("email") or "").strip().lower()
    google_sub = claims.get("sub")
    if not email or not google_sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google account missing email")
    if not claims.get("email_verified", False):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google email is not verified")

    full_name = (claims.get("name") or email.split("@")[0]).strip()[:120]
    avatar_url = (claims.get("picture") or None)
    if avatar_url:
        avatar_url = str(avatar_url)[:512]

    user = db.query(User).filter(User.google_sub == google_sub).first()
    if not user:
        user = db.query(User).filter(User.email == email).first()

    if user:
        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is inactive")
        user.google_sub = google_sub
        if full_name:
            user.full_name = full_name
        if avatar_url:
            user.avatar_url = avatar_url
    else:
        user = User(
            full_name=full_name or "Student User",
            email=email,
            hashed_password=get_password_hash(secrets.token_urlsafe(48)),
            role=UserRole.STUDENT,
            avatar_url=avatar_url,
            google_sub=google_sub,
            institution_id=None,
            department_id=None,
        )
        db.add(user)

    db.commit()
    db.refresh(user)
    sync_user_to_coding_platform(user)
    sync_user_to_theory_platform(user)

    return _issue_auth_response(user)


@router.post("/refresh", response_model=TokenPair)
def refresh_tokens(payload: RefreshRequest, db: Session = Depends(get_db)):
    token_payload = decode_token(payload.refresh_token)
    if token_payload.get("type") != TokenType.REFRESH.value:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token type")

    user_id = token_payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = db.query(User).filter(User.id == int(user_id)).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return TokenPair(
        access_token=create_access_token(subject=str(user.id), role=user.role.value),
        refresh_token=create_refresh_token(subject=str(user.id), role=user.role.value),
    )


@router.get("/me", response_model=UserOut)
def me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Keep coding-platform identity in sync whenever the session is restored.
    sync_user_to_coding_platform(current_user)
    sync_user_to_theory_platform(current_user)
    return UserOut.model_validate(current_user)


@router.get("/me/profile", response_model=ProfileOut)
def my_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return ProfileOut.model_validate(build_user_profile(db, current_user))


@router.patch("/me", response_model=UserOut)
def update_me(
    payload: UpdateMeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.full_name = payload.full_name.strip()
    db.commit()
    db.refresh(current_user)
    sync_user_to_coding_platform(current_user)
    sync_user_to_theory_platform(current_user)
    return UserOut.model_validate(current_user)


@router.post("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = await read_avatar_bytes(file)
    mime_type = validate_avatar_upload(file, data)
    previous_avatar_url = current_user.avatar_url
    current_user.avatar_url = save_avatar_file(
        user_id=current_user.id,
        data=data,
        mime_type=mime_type,
        previous_avatar_url=previous_avatar_url,
    )
    db.commit()
    db.refresh(current_user)
    sync_user_to_coding_platform(current_user)
    sync_user_to_theory_platform(current_user)
    return UserOut.model_validate(current_user)


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(payload.current_password, current_user.hashed_password):
        if current_user.google_sub:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This account uses Google Sign-In and does not have a usable password for change.",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password",
        )

    current_user.hashed_password = get_password_hash(payload.new_password)
    db.commit()
    return None
