import unittest

from app.services.practice_gemini import parse_quiz_questions, parse_scenarios


class ScenarioParsingTests(unittest.TestCase):
    def test_parse_scenarios_requires_five_questions(self):
        raw = [
            {
                "title": "Factory spill",
                "situation": "A chemical plant reports a minor leak near the storage tanks.",
                "questions": [
                    {
                        "question": f"Question {index}?",
                        "options": [
                            "Evacuate and notify supervisors immediately",
                            "Ignore the leak and continue work",
                            "Open all storage valves to release pressure",
                            "Wait until the next weekly inspection",
                        ],
                        "correct_answer": "Evacuate and notify supervisors immediately",
                    }
                    for index in range(1, 6)
                ],
            }
        ]
        scenarios = parse_scenarios(raw, chapter_number=2)
        self.assertEqual(len(scenarios), 1)
        self.assertEqual(scenarios[0]["id"], "chapter-2-scenario-1")
        self.assertEqual(len(scenarios[0]["questions"]), 5)

    def test_parse_quiz_questions_rejects_invalid_options(self):
        items = [
            {
                "question": "What is mitosis?",
                "options": ["A", "B", "C", "D"],
                "correct_answer": "B",
            }
        ]
        self.assertEqual(parse_quiz_questions(items), [])

    def test_parse_quiz_questions_accepts_full_text_options(self):
        items = [
            {
                "question": "What is mitosis?",
                "options": [
                    "Cell division producing identical daughter cells",
                    "Protein synthesis in the ribosome",
                    "Energy production in mitochondria",
                    "DNA replication only",
                ],
                "correct_answer": "Cell division producing identical daughter cells",
            }
        ]
        parsed = parse_quiz_questions(items)
        self.assertEqual(len(parsed), 1)


if __name__ == "__main__":
    unittest.main()
