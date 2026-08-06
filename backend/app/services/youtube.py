"""YouTube Data API helpers for subtopic video auto-pick."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import httpx

from app.core.config import settings

YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"


def extract_youtube_id(url_or_id: str | None) -> str | None:
    if not url_or_id:
        return None
    value = url_or_id.strip()
    if re.fullmatch(r"[\w-]{11}", value):
        return value
    parsed = urlparse(value)
    if "youtu.be" in parsed.netloc:
        vid = parsed.path.lstrip("/").split("/")[0]
        return vid if re.fullmatch(r"[\w-]{11}", vid) else None
    if "youtube.com" in parsed.netloc:
        qs = parse_qs(parsed.query)
        if "v" in qs and qs["v"]:
            vid = qs["v"][0]
            return vid if re.fullmatch(r"[\w-]{11}", vid) else None
        parts = parsed.path.split("/")
        if "embed" in parts:
            idx = parts.index("embed")
            if idx + 1 < len(parts) and re.fullmatch(r"[\w-]{11}", parts[idx + 1]):
                return parts[idx + 1]
    return None


def search_youtube_video(*, query: str) -> tuple[str | None, str | None]:
    """Return (video_id, title) or (None, None)."""
    key = settings.youtube_api_key.strip()
    if not key:
        return None, None
    params = {
        "part": "snippet",
        "type": "video",
        "maxResults": 1,
        "q": query[:100],
        "key": key,
        "safeSearch": "moderate",
        "videoEmbeddable": "true",
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(YOUTUBE_SEARCH_URL, params=params)
            response.raise_for_status()
            data = response.json()
    except Exception:  # noqa: BLE001
        return None, None
    items = data.get("items") or []
    if not items:
        return None, None
    item = items[0]
    video_id = (item.get("id") or {}).get("videoId")
    title = (item.get("snippet") or {}).get("title")
    if not video_id:
        return None, None
    return str(video_id), str(title) if title else None
