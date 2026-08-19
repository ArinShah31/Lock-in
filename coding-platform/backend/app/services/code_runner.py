"""Sandboxed code runner for student visible/hidden test cases."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from typing import Any

from app.core.config import settings
from app.models import Language


SUPPORTED_LANGUAGES = {Language.PYTHON, Language.JAVASCRIPT, Language.JAVA, Language.CPP}


class CodeRunnerError(Exception):
    pass


def _normalize_output(text: str | bytes) -> str:
    """Canonical output for pass/fail comparison."""
    if isinstance(text, bytes):
        text = text.decode("utf-8", errors="replace")
    elif not isinstance(text, str):
        text = str(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return text.rstrip()


def _truncate(text: str, max_chars: int | None = None) -> str:
    if isinstance(text, bytes):
        text = text.decode("utf-8", errors="replace")
    elif not isinstance(text, str):
        text = str(text)
    limit = max_chars or settings.code_runner_truncated_error_chars
    if len(text) > limit:
        return text[:limit] + "\n[truncated]"
    return text


def _cap(text: str, max_bytes: int | None = None) -> str:
    if isinstance(text, bytes):
        text = text.decode("utf-8", errors="replace")
    limit = max_bytes or settings.code_runner_max_output_bytes
    encoded = text.encode("utf-8", errors="replace")
    if len(encoded) > limit:
        cut = encoded[:limit]
        return cut.decode("utf-8", errors="replace") + "\n[output truncated]"
    return text


def _python_cmd() -> str | None:
    for candidate in ["python3", "python"]:
        path = shutil.which(candidate)
        if not path:
            continue
        try:
            result = subprocess.run(
                [path, "-c", "print('coding_runner_ok')"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            if result.returncode == 0 and "coding_runner_ok" in result.stdout:
                return path
        except Exception:
            continue
    return None


def _check_language_support(language: Language) -> str | None:
    if language not in SUPPORTED_LANGUAGES:
        return f"Language {language.value} is not supported for test-case execution."
    if language == Language.PYTHON and not _python_cmd():
        return "Python runtime is not available."
    if language == Language.JAVASCRIPT and not shutil.which("node"):
        return "Node.js runtime is not available."
    if language == Language.JAVA and (not shutil.which("javac") or not shutil.which("java")):
        return "Java compiler/runtime is not available."
    if language == Language.CPP and not shutil.which("g++"):
        return "C++ compiler is not available."
    return None


def _write_file(code: str, work_dir: str, filename: str) -> str:
    path = os.path.join(work_dir, filename)
    with open(path, "w", encoding="utf-8") as f:
        f.write(code)
    return path


def _run_command(cmd: list[str], stdin: str, work_dir: str) -> tuple[str, str, int]:
    try:
        proc = subprocess.run(
            cmd,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=settings.code_runner_timeout_seconds,
            cwd=work_dir,
        )
        return proc.stdout, proc.stderr, proc.returncode
    except subprocess.TimeoutExpired:
        return "", f"Time limit exceeded ({settings.code_runner_timeout_seconds}s)", -1
    except FileNotFoundError as e:
        return "", str(e), -1


def _prepare_python(code: str, work_dir: str) -> tuple[list[str], str | None]:
    path = _write_file(code, work_dir, "solution.py")
    cmd = _python_cmd()
    if not cmd:
        return [], "Python runtime is not available."
    return [cmd, path], None


def _prepare_javascript(code: str, work_dir: str) -> tuple[list[str], str | None]:
    path = _write_file(code, work_dir, "solution.js")
    return ["node", path], None


def _prepare_java(code: str, work_dir: str) -> tuple[list[str], str | None]:
    path = _write_file(code, work_dir, "Solution.java")
    _, stderr, rc = _run_command(["javac", path], "", work_dir)
    if rc != 0:
        return [], _truncate(_cap(stderr or "Compilation failed"))
    return ["java", "-cp", work_dir, "Solution"], None


def _prepare_cpp(code: str, work_dir: str) -> tuple[list[str], str | None]:
    path = _write_file(code, work_dir, "solution.cpp")
    binary = os.path.join(work_dir, "solution_bin")
    _, stderr, rc = _run_command(["g++", "-std=c++17", "-o", binary, path], "", work_dir)
    if rc != 0:
        return [], _truncate(_cap(stderr or "Compilation failed"))
    return [binary], None


_DISPATCH = {
    Language.PYTHON: _prepare_python,
    Language.JAVASCRIPT: _prepare_javascript,
    Language.JAVA: _prepare_java,
    Language.CPP: _prepare_cpp,
}


def run_test_cases(
    code: str,
    language: Language,
    test_cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Run every test case in an isolated temp directory.

    Returns a list of result dicts matching TestCaseResult.
    """
    support_error = _check_language_support(language)
    if support_error:
        return [
            {
                "id": tc.get("id", 0),
                "description": tc.get("description", ""),
                "passed": False,
                "actual_output": "",
                "expected_output": tc.get("expected_output", ""),
                "error": support_error,
            }
            for tc in test_cases
        ]

    if not test_cases:
        return []

    work_dir = tempfile.mkdtemp(prefix="coding_run_")
    try:
        cmd, compile_error = _DISPATCH[language](code, work_dir)
        if compile_error:
            return [
                {
                    "id": tc.get("id", 0),
                    "description": tc.get("description", ""),
                    "passed": False,
                    "actual_output": "",
                    "expected_output": tc.get("expected_output", ""),
                    "error": compile_error,
                }
                for tc in test_cases
            ]

        results: list[dict[str, Any]] = []
        for tc in test_cases:
            tc_id = tc.get("id", 0)
            description = tc.get("description", "")
            expected = tc.get("expected_output", "")
            stdin = _normalize_output(tc.get("input", ""))

            stdout, stderr, rc = _run_command(cmd, stdin, work_dir)
            actual = _normalize_output(stdout)
            expected_norm = _normalize_output(expected)
            passed = rc == 0 and actual == expected_norm

            error = None
            if not passed:
                if rc != 0:
                    error = _truncate(_cap(stderr or stdout or "Runtime error"))
                else:
                    error = _truncate(
                        _cap(f"Output mismatch.\nGot: {actual}\nExpected: {expected_norm}")
                    )

            results.append(
                {
                    "id": tc_id,
                    "description": description,
                    "passed": passed,
                    "actual_output": actual,
                    "expected_output": expected_norm,
                    "error": error,
                }
            )
        return results
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
