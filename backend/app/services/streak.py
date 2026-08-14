"""UTC calendar-day learning streak calculation from activity dates."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone


def to_utc_date(value: datetime) -> date:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).date()


def longest_consecutive_run(sorted_dates: list[date]) -> int:
    if not sorted_dates:
        return 0
    best = 1
    current = 1
    for index in range(1, len(sorted_dates)):
        if sorted_dates[index] == sorted_dates[index - 1] + timedelta(days=1):
            current += 1
            best = max(best, current)
        elif sorted_dates[index] != sorted_dates[index - 1]:
            current = 1
    return best


def current_streak_from_dates(active_dates: set[date], *, today: date) -> int:
    if not active_dates:
        return 0
    if today in active_dates:
        anchor = today
    elif (today - timedelta(days=1)) in active_dates:
        anchor = today - timedelta(days=1)
    else:
        return 0

    streak = 0
    cursor = anchor
    while cursor in active_dates:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def compute_streak(active_dates: set[date], *, today: date | None = None) -> dict:
    today = today or datetime.now(timezone.utc).date()
    sorted_dates = sorted(active_dates)

    week_dates = []
    for offset in range(6, -1, -1):
        day = today - timedelta(days=offset)
        week_dates.append({"date": day.isoformat(), "active": day in active_dates})

    if not sorted_dates:
        return {
            "current_streak": 0,
            "best_streak": 0,
            "last_active_date": None,
            "week_dates": week_dates,
        }

    return {
        "current_streak": current_streak_from_dates(active_dates, today=today),
        "best_streak": longest_consecutive_run(sorted_dates),
        "last_active_date": sorted_dates[-1].isoformat(),
        "week_dates": week_dates,
    }
