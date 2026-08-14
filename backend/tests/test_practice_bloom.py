import unittest

from app.api.routes.practice import _question_out_list


class PracticeQuestionBloomTests(unittest.TestCase):
    def test_question_out_list_includes_bloom_level(self):
        items = [
            {
                "question": "Apply the formula to solve for x.",
                "options": ["2", "4", "6", "8"],
                "bloom_level": "APPLY",
            }
        ]
        result = _question_out_list(items)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].bloom_level, "APPLY")

    def test_question_out_list_infers_bloom_when_missing(self):
        items = [
            {
                "question": "List the planets in our solar system.",
                "options": ["Mercury, Venus, Earth", "Only Earth", "Only Mars", "None"],
            }
        ]
        result = _question_out_list(items)
        self.assertEqual(result[0].bloom_level, "REMEMBER")


if __name__ == "__main__":
    unittest.main()
