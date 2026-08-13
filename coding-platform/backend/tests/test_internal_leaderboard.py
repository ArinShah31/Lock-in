import unittest
from unittest.mock import MagicMock, patch

from app.routers.internal import _coding_points_for_student


class _Eval:
    def __init__(self, total_score: float):
        self.total_score = total_score


class CodingLeaderboardInternalTests(unittest.TestCase):
    @patch("app.routers.internal._session_evals")
    @patch("app.routers.internal._get_active_session")
    def test_coding_points_for_student_sums_latest_test_averages(
        self,
        mock_get_session,
        mock_session_evals,
    ):
        db = MagicMock()

        assignment_a = MagicMock(id=1, coding_test_id=10, student_id=5)
        assignment_b = MagicMock(id=2, coding_test_id=20, student_id=5)
        db.query.return_value.filter.return_value.all.return_value = [assignment_a, assignment_b]

        session_a = MagicMock(id=100)
        session_b = MagicMock(id=200)

        def fake_get_active_session(_db, assignment_id):
            return session_a if assignment_id == 1 else session_b

        def fake_session_evals(_db, session):
            if session is session_a:
                return [_Eval(80), _Eval(60)]
            return [_Eval(90)]

        mock_get_session.side_effect = fake_get_active_session
        mock_session_evals.side_effect = fake_session_evals

        points = _coding_points_for_student(db, 5)
        self.assertEqual(points, 160)

    def test_coding_points_for_student_no_assignments(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.return_value = []
        self.assertEqual(_coding_points_for_student(db, 1), 0)
