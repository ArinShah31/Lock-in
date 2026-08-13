"""Add 5 test student accounts to the primary demo classroom for leaderboard testing."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.database import SessionLocal
from app.core.security import get_password_hash
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.user import User, UserRole

TEACHER_EMAIL = "teacher@example.com"
DEMO_PASSWORD = "DemoPass123"

STUDENTS = [
    ("lbstudent1@example.com", "Alex Rivera"),
    ("lbstudent2@example.com", "Jordan Lee"),
    ("lbstudent3@example.com", "Taylor Brooks"),
    ("lbstudent4@example.com", "Morgan Chen"),
    ("lbstudent5@example.com", "Riley Patel"),
]


def main() -> None:
    db = SessionLocal()
    try:
        teacher = db.query(User).filter(User.email == TEACHER_EMAIL.lower()).first()
        if not teacher:
            raise SystemExit(f"Teacher not found: {TEACHER_EMAIL}")

        classroom = (
            db.query(Classroom)
            .filter(Classroom.class_teacher_id == teacher.id, Classroom.is_active.is_(True))
            .order_by(Classroom.id.desc())
            .first()
        )
        if not classroom:
            raise SystemExit(f"No active classroom for {TEACHER_EMAIL}")

        created: list[User] = []
        for email, full_name in STUDENTS:
            user = db.query(User).filter(User.email == email.lower()).first()
            if not user:
                user = User(
                    full_name=full_name,
                    email=email.lower(),
                    hashed_password=get_password_hash(DEMO_PASSWORD),
                    role=UserRole.STUDENT,
                    is_active=True,
                    institution_id=classroom.institution_id,
                    department_id=classroom.department_id,
                    coding_platform_enabled=False,
                )
                db.add(user)
                db.flush()
                created.append(user)
            else:
                user.full_name = full_name
                user.hashed_password = get_password_hash(DEMO_PASSWORD)
                user.role = UserRole.STUDENT
                user.is_active = True
                user.institution_id = classroom.institution_id
                user.department_id = classroom.department_id

            membership = (
                db.query(ClassroomStudent)
                .filter(
                    ClassroomStudent.classroom_id == classroom.id,
                    ClassroomStudent.student_id == user.id,
                )
                .first()
            )
            if membership:
                membership.status = MembershipStatus.APPROVED
                membership.is_active = True
            else:
                db.add(
                    ClassroomStudent(
                        classroom_id=classroom.id,
                        student_id=user.id,
                        status=MembershipStatus.APPROVED,
                        is_active=True,
                    )
                )

        db.commit()

        print("=" * 60)
        print("Leaderboard test students")
        print("=" * 60)
        print(f"Teacher:   {teacher.email} / {DEMO_PASSWORD}")
        print(f"Classroom: {classroom.name} [{classroom.code}] (id={classroom.id})")
        print(f"Join code: {classroom.join_code}")
        print(f"Password for all students below: {DEMO_PASSWORD}")
        print()
        for email, full_name in STUDENTS:
            print(f"  - {email}  ({full_name})")
        print()
        print(f"New accounts created: {len(created)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
