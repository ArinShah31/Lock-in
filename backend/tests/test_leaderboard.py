import unittest
from unittest.mock import patch

from app.services.coding_leaderboard import fetch_coding_leaderboard_scores
from app.services.leaderboard import (
    _StudentPoints,
    _attempt_activity_key,
    _initials,
    _latest_practice_scores,
)


class _Attempt:
    def __init__(self, user_id, attempt_type, chapter_number, score, payload, created_at):
        self.user_id = user_id
        self.attempt_type = attempt_type
        self.chapter_number = chapter_number
        self.score = score
        self.payload = payload
        self.created_at = created_at


class LeaderboardHelperTests(unittest.TestCase):
    def test_initials(self):
        self.assertEqual(_initials("Ada Lovelace"), "AL")
        self.assertEqual(_initials("Cher"), "CH")

    def test_attempt_activity_key(self):
        quiz = _Attempt(1, "QUIZ", 3, 80, {}, 1)
        self.assertEqual(_attempt_activity_key(quiz), "quiz:3")
        scenario = _Attempt(1, "SCENARIO", 2, 90, {"scenario_id": "s1"}, 1)
        self.assertEqual(_attempt_activity_key(scenario), "scenario:s1")

    def test_latest_practice_scores_keeps_newest(self):
        attempts = [
            _Attempt(1, "QUIZ", 1, 50, {}, 1),
            _Attempt(1, "QUIZ", 1, 90, {}, 2),
        ]
        latest = _latest_practice_scores(attempts)
        self.assertEqual(latest[1]["quiz:1"].score, 90)

    def test_student_points_total_includes_coding(self):
        row = _StudentPoints(
            student_id=1,
            full_name="Ada Lovelace",
            email="ada@example.com",
            quiz_points=40,
            exam_points=30,
            coding_points=25,
        )
        self.assertEqual(row.total_points, 95)


class CodingLeaderboardFetchTests(unittest.TestCase):
    @patch("app.services.coding_leaderboard.httpx.Client")
    def test_fetch_coding_leaderboard_scores_fail_open(self, mock_client_cls):
        mock_client_cls.return_value.__enter__.return_value.post.side_effect = RuntimeError("down")
        self.assertEqual(fetch_coding_leaderboard_scores(["student@example.com"]), {})

    @patch("app.services.coding_leaderboard.settings")
    def test_fetch_coding_leaderboard_scores_missing_config(self, settings):
        settings.coding_sync_secret = ""
        settings.coding_platform_api_url = ""
        self.assertEqual(fetch_coding_leaderboard_scores(["student@example.com"]), {})
