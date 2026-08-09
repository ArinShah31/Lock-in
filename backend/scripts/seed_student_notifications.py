"""Seed dummy student notifications for student@astra.edu."""
from __future__ import annotations

import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.database import SessionLocal
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.user import User, UserRole


def main() -> None:
    db = SessionLocal()
    try:
        student = db.query(User).filter(User.email == "student@astra.edu").first()
        if not student:
            raise SystemExit("student@astra.edu not found")

        # Mark existing approved membership as recently decided (join approved alert)
        approved = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.student_id == student.id,
                ClassroomStudent.status == MembershipStatus.APPROVED,
            )
            .all()
        )
        for m in approved:
            m.decided_at = datetime.now(timezone.utc)

        home = approved[0] if approved else None
        if not home:
            raise SystemExit("student has no approved classroom")

        classroom = db.get(Classroom, home.classroom_id)
        teacher_id = classroom.class_teacher_id if classroom else None

        # New assignment with no submission yet
        new_asg = (
            db.query(Assignment)
            .filter(
                Assignment.classroom_id == home.classroom_id,
                Assignment.title == "Notification Demo — Reading Response",
            )
            .first()
        )
        if not new_asg:
            new_asg = Assignment(
                classroom_id=home.classroom_id,
                created_by=teacher_id or 1,
                title="Notification Demo — Reading Response",
                instructions="Short response for notification testing.",
                max_marks=10,
                due_at=datetime.now(timezone.utc) + timedelta(days=5),
                is_active=True,
            )
            db.add(new_asg)
            db.flush()

        # Graded submission on a separate/demo assignment
        graded_asg = (
            db.query(Assignment)
            .filter(
                Assignment.classroom_id == home.classroom_id,
                Assignment.title == "Notification Demo — Graded Quiz",
            )
            .first()
        )
        if not graded_asg:
            graded_asg = Assignment(
                classroom_id=home.classroom_id,
                created_by=teacher_id or 1,
                title="Notification Demo — Graded Quiz",
                instructions="Already graded for notification demo.",
                max_marks=20,
                due_at=datetime.now(timezone.utc) - timedelta(days=1),
                is_active=True,
            )
            db.add(graded_asg)
            db.flush()

        graded_sub = (
            db.query(AssignmentSubmission)
            .filter(
                AssignmentSubmission.assignment_id == graded_asg.id,
                AssignmentSubmission.student_id == student.id,
            )
            .first()
        )
        stored = f"notif_graded_{graded_asg.id}_{student.id}_{secrets.token_hex(3)}.pdf"
        now = datetime.now(timezone.utc)
        if graded_sub:
            graded_sub.marks = 18
            graded_sub.feedback = "Nice work."
            graded_sub.graded_at = now
            graded_sub.graded_by = teacher_id
        else:
            db.add(
                AssignmentSubmission(
                    assignment_id=graded_asg.id,
                    student_id=student.id,
                    file_name="graded_demo.pdf",
                    stored_name=stored,
                    file_path=f"uploads/seed/{stored}",
                    file_size=8000,
                    mime_type="application/pdf",
                    submitted_at=now - timedelta(days=1),
                    is_late=False,
                    marks=18,
                    feedback="Nice work.",
                    graded_at=now,
                    graded_by=teacher_id,
                )
            )

        # Pending join on another classroom (if any)
        other = (
            db.query(Classroom)
            .filter(Classroom.id != home.classroom_id, Classroom.is_active.is_(True))
            .first()
        )
        pending_room = None
        if other:
            existing = (
                db.query(ClassroomStudent)
                .filter(
                    ClassroomStudent.classroom_id == other.id,
                    ClassroomStudent.student_id == student.id,
                )
                .first()
            )
            if existing:
                existing.status = MembershipStatus.PENDING
                existing.is_active = True
                existing.decided_at = None
            else:
                db.add(
                    ClassroomStudent(
                        classroom_id=other.id,
                        student_id=student.id,
                        status=MembershipStatus.PENDING,
                        is_active=True,
                    )
                )
            pending_room = other.name

        db.commit()
        print(f"OK student={student.email}")
        print(f"join_approved classrooms={[m.classroom_id for m in approved]}")
        print(f"new_assignment={new_asg.title!r}")
        print(f"graded_assignment={graded_asg.title!r} marks=18")
        print(f"pending_join={pending_room}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
