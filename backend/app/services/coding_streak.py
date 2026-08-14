from __future__ import annotations

import logging
from datetime import datetime

import httpx
from pydantic import BaseModel, Field

from app.core.config import settings

logger = logging.getLogger(__name__)


class CodingStreakItem(BaseModel):
    key: str
    title: str
    available_at: datetime
    completed_at: datetime | None = None


class CodingStreakEventsResponse(BaseModel):
    items: list[CodingStreakItem] = Field(default_factory=list)


def fetch_coding_streak_items(email: str) -> list[CodingStreakItem]:
    """Return coding test streak events for a student email. Fail open with empty list."""
    cleaned = email.strip().lower()
    if not cleaned:
        return []
    if not settings.coding_sync_secret or not settings.coding_platform_api_url:
        return []

    url = f"{settings.coding_platform_api_url.rstrip('/')}/internal/streak-events"
    headers = {"X-Coding-Sync-Secret": settings.coding_sync_secret}
    try:
        with httpx.Client(timeout=8.0) as client:
            response = client.post(url, json={"email": cleaned}, headers=headers)
            if response.status_code >= 400:
                logger.warning(
                    "coding streak fetch failed: %s %s",
                    response.status_code,
                    response.text[:300],
                )
                return []
            payload = CodingStreakEventsResponse.model_validate(response.json())
            return payload.items
    except Exception as exc:  # noqa: BLE001
        logger.warning("coding streak fetch error: %s", exc)
        return []
