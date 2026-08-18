import unittest
from unittest.mock import MagicMock, patch

from app.ai.chat.exercise_context import (
    question_requests_exercise_help,
    _focus_exercise_text,
)
from app.ai.chat.service import answer_classroom_question


class ExerciseDetectionTests(unittest.TestCase):
    def test_detects_exercise_requests(self):
        self.assertTrue(
            question_requests_exercise_help(
                "from the latest document answer all the questions in the exercises"
            )
        )
        self.assertFalse(question_requests_exercise_help("summarize chapter 2"))

    def test_focuses_on_exercise_section(self):
        text = "Chapter intro.\n" * 50 + "Exercises\n1. What is soil?\n2. Define pH."
        focused = _focus_exercise_text(text, max_chars=500)
        self.assertIn("Exercises", focused)
        self.assertIn("What is soil", focused)


class ExerciseChatServiceTests(unittest.TestCase):
    @patch("app.ai.chat.service.generate_answer")
    @patch("app.ai.chat.service.collect_exercise_context")
    @patch("app.ai.chat.service.search_classroom")
    def test_exercise_question_uses_exercise_context(
        self,
        mock_search,
        mock_exercise_context,
        mock_generate,
    ):
        mock_search.return_value = []
        mock_exercise_context.return_value = [
            "[Lab Notes — full document context]\nExercises\n1. Define nitrogen fixation."
        ]
        mock_generate.return_value = MagicMock(
            document_answer="**1.** Nitrogen fixation is ...",
            additional_explanation="",
            used_document=True,
            used_general_knowledge=False,
            blocked=False,
        )

        response = answer_classroom_question(
            classroom_id=1,
            question="answer all the questions in the exercises from the latest document",
            db=MagicMock(),
        )

        mock_exercise_context.assert_called_once()
        mock_generate.assert_called_once()
        prompt = mock_generate.call_args.args[0]
        self.assertIn("Exercise and practice mode", prompt)
        self.assertIn("Nitrogen fixation", response.document_answer)


if __name__ == "__main__":
    unittest.main()
