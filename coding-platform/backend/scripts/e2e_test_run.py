"""Quick end-to-end smoke test for the test-case runner feature."""

import json
import time
import urllib.request

BASE = "http://127.0.0.1:8010/api/v1"

SUFFIX = str(int(time.time() * 1000) % 1_000_000)


def post(path: str, body: dict, auth: str | None = None) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if auth:
        req.add_header("Authorization", f"Bearer {auth}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        print(f"POST {path} failed: {e.code}")
        print(e.read().decode())
        raise


def get(path: str, auth: str) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        headers={"Authorization": f"Bearer {auth}"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def main() -> None:
    teacher_email = f"smoke_teacher_{SUFFIX}@example.com"
    student_email = f"smoke_student_{SUFFIX}@example.com"
    password = "password123"

    # Register teacher and student.
    teacher = post("/auth/register", {
        "full_name": "Smoke Teacher",
        "email": teacher_email,
        "password": password,
        "role": "TEACHER",
    })
    student = post("/auth/register", {
        "full_name": "Smoke Student",
        "email": student_email,
        "password": password,
        "role": "STUDENT",
    })

    teacher_token = post("/auth/login", {"email": teacher_email, "password": password})["access_token"]
    student_token = post("/auth/login", {"email": student_email, "password": password})["access_token"]

    # Create a Python question with test cases.
    question = post("/teacher/questions", {
        "title": "Smoke addition",
        "prompt_markdown": "Read two integers and print their sum.",
        "starter_code": "a = int(input())\nb = int(input())\nprint(a + b)",
        "language": "python",
        "bloom_level": "APPLY",
        "rubric": [{"name": "Correctness", "description": "", "weight": 100, "max_points": 100}],
        "test_cases": [
            {"id": 1, "description": "Basic", "input": "5\n3", "expected_output": "8", "is_visible": True},
            {"id": 2, "description": "Zero", "input": "0\n0", "expected_output": "0", "is_visible": True},
            {"id": 3, "description": "Hidden", "input": "10\n20", "expected_output": "30", "is_visible": False},
        ],
    }, teacher_token)
    assert question["test_cases"], "Question should have test cases"

    # Create a test, assign student, start session.
    test = post("/teacher/tests", {"title": "Smoke Test", "duration_minutes": 30, "question_ids": [question["id"]]}, teacher_token)
    post(f"/teacher/tests/{test['id']}/assign", {"student_email": student_email}, teacher_token)
    assignments = get("/student/assignments", student_token)
    assignment = next(a for a in assignments if a["coding_test_id"] == test["id"])
    session = post(f"/student/assignments/{assignment['id']}/start", {}, student_token)

    # Fetch exam questions — only visible cases should be present.
    exam_questions = get(f"/student/sessions/{session['id']}/questions", student_token)
    assert len(exam_questions) == 1
    visible = exam_questions[0]["test_cases"]
    assert len(visible) == 2, f"Expected 2 visible cases, got {len(visible)}"
    assert all(tc["is_visible"] for tc in visible), "All returned cases should be visible"

    # Run code — should pass all visible cases.
    run_result = post(f"/student/sessions/{session['id']}/run", {
        "question_id": question["id"],
        "code": question["starter_code"],
        "language": "python",
    }, student_token)
    assert run_result["ran_count"] == 2
    assert all(r["passed"] for r in run_result["results"]), "Starter code should pass visible cases"

    # Run failing code.
    fail_result = post(f"/student/sessions/{session['id']}/run", {
        "question_id": question["id"],
        "code": "print(0)",
        "language": "python",
    }, student_token)
    assert any(not r["passed"] for r in fail_result["results"]), "Wrong code should fail"

    print("E2E smoke test passed")


if __name__ == "__main__":
    main()
