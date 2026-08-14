import unittest

from app.services.bloom import (
    BloomLevel,
    bloom_difficulty,
    infer_bloom_level,
    normalize_bloom_level,
    resolve_bloom_level,
)
from app.services.practice_gemini import parse_quiz_questions


class BloomHeuristicTests(unittest.TestCase):
    def test_infer_remember_from_define(self):
        self.assertEqual(infer_bloom_level("Define photosynthesis."), BloomLevel.REMEMBER)

    def test_infer_understand_from_explain(self):
        self.assertEqual(infer_bloom_level("Explain why the sky appears blue."), BloomLevel.UNDERSTAND)

    def test_infer_apply_from_calculate(self):
        self.assertEqual(infer_bloom_level("Calculate the area of a triangle."), BloomLevel.APPLY)

    def test_infer_analyze_from_compare(self):
        self.assertEqual(infer_bloom_level("Compare mitosis and meiosis."), BloomLevel.ANALYZE)

    def test_infer_evaluate_from_justify(self):
        self.assertEqual(infer_bloom_level("Justify the best policy option."), BloomLevel.EVALUATE)

    def test_infer_create_from_design(self):
        self.assertEqual(infer_bloom_level("Design a study plan for exam prep."), BloomLevel.CREATE)

    def test_resolve_prefers_stored_level(self):
        level = resolve_bloom_level("List the steps.", "CREATE")
        self.assertEqual(level, BloomLevel.CREATE)

    def test_normalize_rejects_invalid(self):
        self.assertIsNone(normalize_bloom_level("INVALID"))

    def test_bloom_difficulty_mapping(self):
        self.assertEqual(bloom_difficulty(BloomLevel.REMEMBER), "easier")
        self.assertEqual(bloom_difficulty(BloomLevel.APPLY), "medium")
        self.assertEqual(bloom_difficulty(BloomLevel.CREATE), "harder")


class BloomQuizParsingTests(unittest.TestCase):
    def test_parse_quiz_questions_preserves_bloom_level(self):
        items = [
            {
                "question": "Explain how osmosis works in plant cells.",
                "options": [
                    "Water moves from high to low solute concentration",
                    "Water only moves when heated",
                    "Osmosis does not occur in plants",
                    "Plants absorb only salt through osmosis",
                ],
                "correct_answer": "Water moves from high to low solute concentration",
                "bloom_level": "UNDERSTAND",
            }
        ]
        parsed = parse_quiz_questions(items)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["bloom_level"], "UNDERSTAND")

    def test_parse_quiz_questions_infers_bloom_when_missing(self):
        items = [
            {
                "question": "Compare aerobic and anaerobic respiration.",
                "options": [
                    "Aerobic uses oxygen; anaerobic does not",
                    "Both always produce the same ATP yield",
                    "Anaerobic only happens in animals",
                    "Aerobic never occurs in cells",
                ],
                "correct_answer": "Aerobic uses oxygen; anaerobic does not",
            }
        ]
        parsed = parse_quiz_questions(items)
        self.assertEqual(parsed[0]["bloom_level"], "ANALYZE")


if __name__ == "__main__":
    unittest.main()
