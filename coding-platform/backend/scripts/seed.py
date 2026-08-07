"""Seed demo teacher, student, questions, and a 3-question test."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.database import Base, SessionLocal, engine
from app.core.security import get_password_hash
from app.models import (
    CodingTest,
    CodingTestQuestion,
    Difficulty,
    Language,
    Question,
    User,
    UserRole,
)
from app.routers.auth_teacher import _invite_code
from app.services.question_bank import STARTER_QUESTIONS

DEMO_PASSWORD = "DemoPass123"


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        teacher = db.query(User).filter(User.email == "teacher@example.com").first()
        if not teacher:
            teacher = User(
                full_name="Demo Teacher",
                email="teacher@example.com",
                hashed_password=get_password_hash(DEMO_PASSWORD),
                role=UserRole.TEACHER,
            )
            db.add(teacher)
            db.flush()

        student = db.query(User).filter(User.email == "student@example.com").first()
        if not student:
            student = User(
                full_name="Demo Student",
                email="student@example.com",
                hashed_password=get_password_hash(DEMO_PASSWORD),
                role=UserRole.STUDENT,
            )
            db.add(student)
            db.flush()

        created_ids: dict[tuple, int] = {}
        for title, lang, diff, qtype, prompt, starter in STARTER_QUESTIONS:
            existing = (
                db.query(Question)
                .filter(Question.created_by_id == teacher.id, Question.title == title)
                .first()
            )
            if existing:
                created_ids[(lang, diff)] = existing.id
                continue
            q = Question(
                title=title,
                prompt_markdown=prompt,
                starter_code=starter,
                language=lang,
                difficulty=diff,
                question_type=qtype,
                created_by_id=teacher.id,
            )
            db.add(q)
            db.flush()
            created_ids[(lang, diff)] = q.id

        test = db.query(CodingTest).filter(CodingTest.title == "Python Progressive Demo").first()
        if not test:
            test = CodingTest(
                title="Python Progressive Demo",
                duration_minutes=45,
                created_by_id=teacher.id,
                invite_code=_invite_code(db),
                is_published_results=False,
            )
            db.add(test)
            db.flush()
            for order, diff in [(1, Difficulty.EASY), (2, Difficulty.MEDIUM), (3, Difficulty.HARD)]:
                db.add(
                    CodingTestQuestion(
                        coding_test_id=test.id,
                        question_id=created_ids[(Language.PYTHON, diff)],
                        order_index=order,
                        required_difficulty=diff,
                    )
                )

        db.commit()
        print("Seeded teacher@example.com / student@example.com password DemoPass123")
        print(f"Demo test invite code: {test.invite_code}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
