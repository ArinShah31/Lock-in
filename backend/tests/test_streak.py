import unittest
from datetime import date, timedelta

from app.services.streak import compute_streak, current_streak_from_dates, longest_consecutive_run


class StreakCalculationTests(unittest.TestCase):
    def test_empty_dates(self):
        result = compute_streak(set(), today=date(2026, 3, 10))
        self.assertEqual(result["current_streak"], 0)
        self.assertEqual(result["best_streak"], 0)
        self.assertIsNone(result["last_active_date"])

    def test_consecutive_current_streak_from_today(self):
        today = date(2026, 3, 10)
        active = {today - timedelta(days=i) for i in range(5)}
        result = compute_streak(active, today=today)
        self.assertEqual(result["current_streak"], 5)
        self.assertEqual(result["best_streak"], 5)

    def test_current_streak_continues_from_yesterday_if_not_active_today(self):
        today = date(2026, 3, 10)
        active = {today - timedelta(days=i) for i in range(1, 4)}
        result = compute_streak(active, today=today)
        self.assertEqual(result["current_streak"], 3)

    def test_missed_day_resets_current_streak(self):
        today = date(2026, 3, 10)
        active = {today - timedelta(days=3), today - timedelta(days=2)}
        result = compute_streak(active, today=today)
        self.assertEqual(result["current_streak"], 0)
        self.assertEqual(result["best_streak"], 2)

    def test_best_streak_preserved_after_gap(self):
        active = {
            date(2026, 3, 1),
            date(2026, 3, 2),
            date(2026, 3, 3),
            date(2026, 3, 10),
            date(2026, 3, 11),
        }
        result = compute_streak(active, today=date(2026, 3, 11))
        self.assertEqual(result["current_streak"], 2)
        self.assertEqual(result["best_streak"], 3)

    def test_duplicate_same_day_counts_once(self):
        today = date(2026, 3, 10)
        active = {today}
        self.assertEqual(current_streak_from_dates(active, today=today), 1)

    def test_longest_consecutive_run(self):
        dates = [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 4), date(2026, 1, 5), date(2026, 1, 6)]
        self.assertEqual(longest_consecutive_run(dates), 3)

    def test_week_dates_length(self):
        result = compute_streak({date(2026, 3, 10)}, today=date(2026, 3, 10))
        self.assertEqual(len(result["week_dates"]), 7)


if __name__ == "__main__":
    unittest.main()
