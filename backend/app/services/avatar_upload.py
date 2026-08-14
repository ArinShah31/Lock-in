"""Secure avatar upload handling."""

from __future__ import annotations

import re
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

AVATAR_DIR = Path("uploads/avatars")
MAX_AVATAR_BYTES = 2 * 1024 * 1024

ALLOWED_MIME = frozenset({"image/png", "image/jpeg", "image/webp"})
MIME_TO_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"
LOCAL_AVATAR_PREFIX = "/uploads/avatars/"


def _detect_image_mime(data: bytes) -> str | None:
    if data.startswith(PNG_SIGNATURE):
        return "image/png"
    if data.startswith(JPEG_SIGNATURE):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _sanitize_client_extension(filename: str | None) -> str | None:
    if not filename:
        return None
    name = Path(filename).name
    if ".." in name or "/" in name or "\\" in name:
        return None
    ext = Path(name).suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
        return None
    return ext


async def read_avatar_bytes(file: UploadFile) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(64 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_AVATAR_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Avatar must be {MAX_AVATAR_BYTES // (1024 * 1024)}MB or smaller",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def validate_avatar_upload(file: UploadFile, data: bytes) -> str:
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty avatar file")

    detected_mime = _detect_image_mime(data)
    if detected_mime is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid image file")

    declared_mime = (file.content_type or "").split(";")[0].strip().lower()
    if declared_mime and declared_mime not in ALLOWED_MIME:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported avatar file type")

    if declared_mime and declared_mime != detected_mime:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Avatar file content does not match declared type",
        )

    client_ext = _sanitize_client_extension(file.filename)
    if file.filename and client_ext is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid avatar filename")

    return detected_mime


def _local_avatar_path(avatar_url: str | None) -> Path | None:
    if not avatar_url or not avatar_url.startswith(LOCAL_AVATAR_PREFIX):
        return None
    filename = avatar_url.removeprefix(LOCAL_AVATAR_PREFIX)
    if not filename or not re.fullmatch(r"\d+\.(png|jpg|jpeg|webp)", filename):
        return None
    candidate = (AVATAR_DIR / filename).resolve()
    root = AVATAR_DIR.resolve()
    if not str(candidate).startswith(str(root)):
        return None
    return candidate


def save_avatar_file(*, user_id: int, data: bytes, mime_type: str, previous_avatar_url: str | None) -> str:
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    ext = MIME_TO_EXT[mime_type]
    destination = (AVATAR_DIR / f"{user_id}{ext}").resolve()
    root = AVATAR_DIR.resolve()
    if not str(destination).startswith(str(root)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid avatar path")

    destination.write_bytes(data)

    previous_path = _local_avatar_path(previous_avatar_url)
    if previous_path and previous_path.exists() and previous_path != destination:
        try:
            previous_path.unlink()
        except OSError:
            pass

    for other_ext in MIME_TO_EXT.values():
        if other_ext == ext:
            continue
        stale = (AVATAR_DIR / f"{user_id}{other_ext}").resolve()
        if stale.exists() and stale != destination:
            try:
                stale.unlink()
            except OSError:
                pass

    return f"{LOCAL_AVATAR_PREFIX}{user_id}{ext}"
