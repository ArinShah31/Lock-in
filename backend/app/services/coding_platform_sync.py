"""Sync ASTRA users into the coding-platform service."""

from __future__ import annotations

import logging

import httpx

from app.core.config import settings
from app.models.user import User, UserRole

logger = logging.getLogger(__name__)

SYNCABLE_ROLES = {UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER, UserRole.STUDENT}


def map_coding_role(role: UserRole) -> str | None:
    if role in {UserRole.CLASS_TEACHER, UserRole.SUBJECT_TEACHER}:
        return "TEACHER"
    if role == UserRole.STUDENT:
        return "STUDENT"
    return None


def sync_user_to_coding_platform(user: User) -> bool:
    """Upsert user into coding-platform. Returns True on success."""
    coding_role = map_coding_role(user.role)
    if not coding_role:
        return False
    if not settings.coding_sync_secret or not settings.coding_platform_api_url:
        logger.warning("coding sync skipped: missing CODING_SYNC_SECRET or CODING_PLATFORM_API_URL")
        return False

    url = f"{settings.coding_platform_api_url.rstrip('/')}/auth/sync-user"
    payload = {
        "full_name": user.full_name,
        "email": user.email,
        "hashed_password": user.hashed_password,
        "role": coding_role,
        "is_active": user.is_active,
    }
    headers = {"X-Coding-Sync-Secret": settings.coding_sync_secret}
    try:
        with httpx.Client(timeout=8.0) as client:
            res = client.post(url, json=payload, headers=headers)
            if res.status_code >= 400:
                logger.warning(
                    "coding sync failed for %s: %s %s",
                    user.email,
                    res.status_code,
                    res.text[:300],
                )
                return False
            return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("coding sync error for %s: %s", user.email, exc)
        return False
