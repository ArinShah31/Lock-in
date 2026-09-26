"""Seed demo teacher, student, questions, and a progressive test."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.database import Base, SessionLocal, engine
from app.core.security import get_password_hash
from app.models import (
    BloomLevel,
    TheoryTest,
    TheoryTestQuestion,
    SubjectArea,
    Question,
    QuestionType,
    User,
    UserRole,
)
from app.routers.auth_teacher import _invite_code
from app.services.bloom import difficulty_from_bloom, normalize_rubric
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
        for title, lang, bloom, prompt, starter, rubric in STARTER_QUESTIONS:
            existing = (
                db.query(Question)
                .filter(Question.created_by_id == teacher.id, Question.title == title)
                .first()
            )
            if existing:
                created_ids[(lang, bloom)] = existing.id
                continue
            q = Question(
                title=title,
                prompt_markdown=prompt,
                model_answer=starter,
                subject=lang,
                bloom_level=bloom,
                difficulty=difficulty_from_bloom(bloom),
                question_type=QuestionType.SYLLABUS,
                rubric_json=normalize_rubric(rubric),
                created_by_id=teacher.id,
            )
            db.add(q)
            db.flush()
            created_ids[(lang, bloom)] = q.id

        test = db.query(TheoryTest).filter(TheoryTest.title == "Python Progressive Demo").first()
        if not test:
            test = TheoryTest(
                title="Python Progressive Demo",
                duration_minutes=45,
                created_by_id=teacher.id,
                invite_code=_invite_code(db),
                is_published_results=False,
            )
            db.add(test)
            db.flush()
            general_bloom = [
                BloomLevel.APPLY,
                BloomLevel.ANALYZE,
                BloomLevel.CREATE,
            ]
            for order, bloom in enumerate(general_bloom, start=1):
                db.add(
                    TheoryTestQuestion(
                        theory_test_id=test.id,
                        question_id=created_ids[(SubjectArea.PYTHON, bloom)],
                        order_index=order,
                        required_difficulty=difficulty_from_bloom(bloom),
                    )
                )

        db.commit()
        print("Seeded teacher@example.com / student@example.com password DemoPass123")
        print(f"Demo test invite code: {test.invite_code}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
