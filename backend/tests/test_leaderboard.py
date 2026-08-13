from app.services.leaderboard import (
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


def test_initials():
    assert _initials("Ada Lovelace") == "AL"
    assert _initials("Cher") == "CH"


def test_attempt_activity_key():
    quiz = _Attempt(1, "QUIZ", 3, 80, {}, 1)
    assert _attempt_activity_key(quiz) == "quiz:3"
    scenario = _Attempt(1, "SCENARIO", 2, 90, {"scenario_id": "s1"}, 1)
    assert _attempt_activity_key(scenario) == "scenario:s1"


def test_latest_practice_scores_keeps_newest():
    attempts = [
        _Attempt(1, "QUIZ", 1, 50, {}, 1),
        _Attempt(1, "QUIZ", 1, 90, {}, 2),
    ]
    latest = _latest_practice_scores(attempts)
    assert latest[1]["quiz:1"].score == 90
