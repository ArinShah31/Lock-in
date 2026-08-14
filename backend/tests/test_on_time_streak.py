import unittest
from datetime import datetime, timedelta, timezone

from app.services.on_time_streak import (
    DEFAULT_DUE_DAYS,
    StreakWorkItem,
    classify_item,
    compute_on_time_streak,
    default_due_at,
)


def _dt(days: int = 0, hours: int = 0) -> datetime:
    base = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
    return base + timedelta(days=days, hours=hours)


class DefaultDueTests(unittest.TestCase):
    def test_default_due_is_two_days_after_available(self):
        available = _dt()
        self.assertEqual(default_due_at(available), available + timedelta(days=DEFAULT_DUE_DAYS))


class ClassifyItemTests(unittest.TestCase):
    def test_pending_before_due(self):
        item = StreakWorkItem(
            key="a",
            title="A",
            available_at=_dt(),
            due_at=_dt(days=2),
            completed_at=None,
        )
        self.assertEqual(classify_item(item, _dt(days=1)), "pending")

    def test_missed_after_due_without_submission(self):
        item = StreakWorkItem(
            key="a",
            title="A",
            available_at=_dt(),
            due_at=_dt(days=2),
            completed_at=None,
        )
        self.assertEqual(classify_item(item, _dt(days=3)), "missed")

    def test_on_time_submission(self):
        item = StreakWorkItem(
            key="a",
            title="A",
            available_at=_dt(),
            due_at=_dt(days=2),
            completed_at=_dt(days=1),
        )
        self.assertEqual(classify_item(item, _dt(days=3)), "on_time")

    def test_late_submission(self):
        item = StreakWorkItem(
            key="a",
            title="A",
            available_at=_dt(),
            due_at=_dt(days=2),
            completed_at=_dt(days=3),
        )
        self.assertEqual(classify_item(item, _dt(days=4)), "late")

    def test_force_late_flag(self):
        item = StreakWorkItem(
            key="a",
            title="A",
            available_at=_dt(),
            due_at=_dt(days=5),
            completed_at=_dt(days=1),
            force_late=True,
        )
        self.assertEqual(classify_item(item, _dt(days=6)), "late")


class ComputeStreakTests(unittest.TestCase):
    def test_consecutive_on_time_increments(self):
        items = [
            StreakWorkItem("a", "A", _dt(), _dt(days=2), _dt(days=1)),
            StreakWorkItem("b", "B", _dt(), _dt(days=4), _dt(days=3)),
        ]
        streak, last_break = compute_on_time_streak(items, now=_dt(days=10))
        self.assertEqual(streak, 2)
        self.assertIsNone(last_break)

    def test_late_submission_resets_and_restarts(self):
        items = [
            StreakWorkItem("a", "A", _dt(), _dt(days=2), _dt(days=1)),
            StreakWorkItem("b", "B", _dt(), _dt(days=4), _dt(days=5)),
            StreakWorkItem("c", "C", _dt(), _dt(days=6), _dt(days=5, hours=12)),
            StreakWorkItem("d", "D", _dt(), _dt(days=8), _dt(days=7)),
        ]
        streak, last_break = compute_on_time_streak(items, now=_dt(days=10))
        self.assertEqual(streak, 2)
        self.assertIsNotNone(last_break)
        self.assertEqual(last_break.reason, "late")
        self.assertEqual(last_break.title, "B")

    def test_missed_deadline_resets_streak(self):
        items = [
            StreakWorkItem("a", "A", _dt(), _dt(days=2), _dt(days=1)),
            StreakWorkItem("b", "B", _dt(), _dt(days=4), None),
            StreakWorkItem("c", "C", _dt(), _dt(days=6), _dt(days=5)),
        ]
        streak, last_break = compute_on_time_streak(items, now=_dt(days=10))
        self.assertEqual(streak, 1)
        self.assertEqual(last_break.reason, "missed")
        self.assertEqual(last_break.title, "B")

    def test_future_items_do_not_affect_streak(self):
        items = [
            StreakWorkItem("a", "A", _dt(), _dt(days=2), _dt(days=1)),
            StreakWorkItem("b", "B", _dt(days=10), _dt(days=12), None),
        ]
        streak, last_break = compute_on_time_streak(items, now=_dt(days=5))
        self.assertEqual(streak, 1)
        self.assertIsNone(last_break)

    def test_explicit_due_overrides_default_window(self):
        available = _dt()
        explicit_due = _dt(days=7)
        item = StreakWorkItem(
            key="assignment:1",
            title="Report",
            available_at=available,
            due_at=explicit_due,
            completed_at=_dt(days=3),
        )
        self.assertEqual(classify_item(item, _dt(days=8)), "on_time")
        self.assertEqual(default_due_at(available), _dt(days=2))


if __name__ == "__main__":
    unittest.main()
