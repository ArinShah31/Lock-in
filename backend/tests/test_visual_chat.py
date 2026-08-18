import unittest
from unittest.mock import MagicMock, patch

from app.ai.chat.service import answer_classroom_question
from app.ai.chat.visual_context import question_requests_visuals
from app.ai.document.visual_pages import select_visual_page_indices
from app.ai.guardrails import STUDENT_INSUFFICIENT_CONTEXT


class VisualQuestionDetectionTests(unittest.TestCase):
    def test_detects_diagram_and_table_questions(self):
        self.assertTrue(
            question_requests_visuals("explain the diagrams and table from the latest pdf uploaded")
        )
        self.assertTrue(question_requests_visuals("What does the flowchart show?"))
        self.assertFalse(question_requests_visuals("Summarize chapter 2 from our notes"))


class VisualPageSelectionTests(unittest.TestCase):
    def test_prefers_pages_with_visual_signals(self):
        indices = select_visual_page_indices(5, [0, 4, 1, 0, 2], max_pages=5)
        self.assertEqual(indices, [1, 4, 2, 0, 3])

    def test_includes_all_pages_when_no_signals(self):
        indices = select_visual_page_indices(4, [0, 0, 0, 0])
        self.assertEqual(indices, [0, 1, 2, 3])


class VisualChatServiceTests(unittest.TestCase):
    @patch("app.ai.chat.service.generate_visual_answer")
    @patch("app.ai.chat.service.collect_visual_pages")
    @patch("app.ai.chat.service.search_classroom")
    def test_visual_question_uses_vision_path(
        self,
        mock_search,
        mock_collect,
        mock_visual_answer,
    ):
        mock_search.return_value = []
        mock_collect.return_value = [("Soil Health.pdf — page 2", b"png-bytes", "image/png")]
        mock_visual_answer.return_value = MagicMock(
            document_answer="The table compares soil nutrients.",
            additional_explanation="",
            used_document=True,
            used_general_knowledge=False,
            blocked=False,
        )

        response = answer_classroom_question(
            classroom_id=1,
            question="explain the diagrams and table from the latest pdf uploaded",
            db=MagicMock(),
        )

        self.assertIn("table compares", response.document_answer)
        mock_visual_answer.assert_called_once()
        mock_collect.assert_called_once()

    @patch("app.ai.chat.service.generate_answer")
    @patch("app.ai.chat.service.collect_visual_pages")
    @patch("app.ai.chat.service.search_classroom")
    def test_non_visual_question_keeps_text_only_path(
        self,
        mock_search,
        mock_collect,
        mock_generate,
    ):
        mock_search.return_value = [
            MagicMock(payload={"text": "BERT is a transformer model."}, score=0.9)
        ]
        mock_generate.return_value = MagicMock(
            document_answer="BERT summary",
            additional_explanation="",
            used_document=True,
            used_general_knowledge=False,
            blocked=False,
        )

        answer_classroom_question(
            classroom_id=1,
            question="Explain BERT from our material",
            db=MagicMock(),
        )

        mock_collect.assert_not_called()
        mock_generate.assert_called_once()

    @patch("app.ai.chat.service.collect_visual_pages")
    @patch("app.ai.chat.service.search_classroom")
    def test_visual_question_without_documents_returns_helpful_message(
        self,
        mock_search,
        mock_collect,
    ):
        mock_search.return_value = []
        mock_collect.return_value = []

        response = answer_classroom_question(
            classroom_id=1,
            question="explain the table in the latest pdf",
            db=MagicMock(),
        )

        self.assertIn("couldn't find diagrams or tables", response.document_answer.lower())


class VisualBatchingTests(unittest.TestCase):
    @patch("app.ai.llm.visual._call_visual_model")
    def test_large_pdfs_use_single_call_when_under_cap(self, mock_call):
        from app.ai.llm.visual import generate_visual_answer

        mock_call.return_value = MagicMock(
            document_answer="Full answer",
            additional_explanation="",
            used_document=True,
            used_general_knowledge=False,
            blocked=False,
        )

        images = [(f"Doc — page {index}", b"bytes", "image/png") for index in range(1, 13)]
        result = generate_visual_answer("explain all diagrams", images, "")

        mock_call.assert_called_once()
        self.assertEqual(result.document_answer, "Full answer")

    @patch("app.ai.llm.visual._merge_batch_answers")
    @patch("app.ai.llm.visual._call_visual_model")
    def test_huge_pdfs_are_processed_in_batches(self, mock_call, mock_merge):
        from app.ai.llm.visual import generate_visual_answer

        mock_call.side_effect = [
            MagicMock(
                document_answer=f"Batch {index} notes",
                additional_explanation="",
                used_document=True,
                used_general_knowledge=False,
                blocked=False,
            )
            for index in range(1, 7)
        ]
        mock_merge.return_value = MagicMock(
            document_answer="Merged full answer",
            additional_explanation="",
            used_document=True,
            used_general_knowledge=False,
            blocked=False,
        )

        images = [(f"Doc — page {index}", b"bytes", "image/png") for index in range(1, 25)]
        result = generate_visual_answer("explain all diagrams", images, "")

        self.assertEqual(mock_call.call_count, 6)
        mock_merge.assert_called_once()
        self.assertEqual(result.document_answer, "Merged full answer")


if __name__ == "__main__":
    unittest.main()
