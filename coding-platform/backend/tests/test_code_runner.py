import unittest

from app.models import Language
from app.services.code_runner import _normalize_output, run_test_cases


class CodeRunnerTests(unittest.TestCase):
    def test_python_addition_passes(self):
        code = "a = int(input())\nb = int(input())\nprint(a + b)"
        cases = [
            {"id": 1, "description": "Basic", "input": "5\n3", "expected_output": "8", "is_visible": True},
            {"id": 2, "description": "Zero", "input": "0\n0", "expected_output": "0", "is_visible": True},
        ]
        results = run_test_cases(code, Language.PYTHON, cases)
        self.assertEqual(len(results), 2)
        self.assertTrue(all(r["passed"] for r in results))

    def test_python_output_mismatch_fails(self):
        code = "a = int(input())\nb = int(input())\nprint(a - b)"
        cases = [
            {"id": 1, "description": "Basic", "input": "5\n3", "expected_output": "8", "is_visible": True},
        ]
        results = run_test_cases(code, Language.PYTHON, cases)
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0]["passed"])
        self.assertIn("Got:", results[0]["error"])

    def test_python_runtime_error(self):
        code = "print(1 / 0)"
        cases = [
            {"id": 1, "description": "Error", "input": "", "expected_output": "0", "is_visible": True},
        ]
        results = run_test_cases(code, Language.PYTHON, cases)
        self.assertFalse(results[0]["passed"])
        self.assertIsNotNone(results[0]["error"])

    def test_javascript_runs(self):
        code = "const fs = require('fs');\nconst input = fs.readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number);\nconsole.log(input[0] + input[1]);"
        cases = [
            {"id": 1, "description": "Basic", "input": "5 3", "expected_output": "8", "is_visible": True},
        ]
        results = run_test_cases(code, Language.JAVASCRIPT, cases)
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]["passed"])

    def test_empty_test_cases(self):
        results = run_test_cases("print(1)", Language.PYTHON, [])
        self.assertEqual(results, [])

    def test_unsupported_language(self):
        results = run_test_cases("print(1)", Language.HTML, [
            {"id": 1, "description": "X", "input": "", "expected_output": "", "is_visible": True},
        ])
        self.assertFalse(results[0]["passed"])
        self.assertIn("not supported", results[0]["error"])


class NormalizeOutputTests(unittest.TestCase):
    def test_crlf_and_trailing_whitespace(self):
        self.assertEqual(_normalize_output("Hello\r\nWorld\r\n\n\t "), "Hello\nWorld")

    def test_bytes_input(self):
        self.assertEqual(_normalize_output(b"Hello\n"), "Hello")


if __name__ == "__main__":
    unittest.main()
