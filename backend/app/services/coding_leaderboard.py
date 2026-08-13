from __future__ import annotations

import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


def fetch_coding_leaderboard_scores(emails: list[str]) -> dict[str, int]:
    """Return lowercase email -> coding XP. Fail open with empty dict on errors."""
    cleaned = [email.strip().lower() for email in emails if email and email.strip()]
    if not cleaned:
        return {}
    if not settings.coding_sync_secret or not settings.coding_platform_api_url:
        return {}

    url = f"{settings.coding_platform_api_url.rstrip('/')}/internal/leaderboard-scores"
    headers = {"X-Coding-Sync-Secret": settings.coding_sync_secret}
    try:
        with httpx.Client(timeout=8.0) as client:
            response = client.post(url, json={"emails": cleaned}, headers=headers)
            if response.status_code >= 400:
                logger.warning(
                    "coding leaderboard fetch failed: %s %s",
                    response.status_code,
                    response.text[:300],
                )
                return {}
            payload = response.json()
            scores = payload.get("scores") or []
            return {
                str(item.get("email", "")).strip().lower(): int(item.get("coding_points") or 0)
                for item in scores
                if item.get("email")
            }
    except Exception as exc:  # noqa: BLE001
        logger.warning("coding leaderboard fetch error: %s", exc)
        return {}
