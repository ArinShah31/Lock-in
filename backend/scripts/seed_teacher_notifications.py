"""Seed dummy notifications for classteacher@astra.edu."""
from __future__ import annotations

import secrets
import sys
from datetime import datetime, timezone
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
        teacher = db.query(User).filter(User.email == "classteacher@astra.edu").first()
        if not teacher:
            raise SystemExit("classteacher@astra.edu not found")

        classroom = (
            db.query(Classroom).filter(Classroom.class_teacher_id == teacher.id).first()
        )
        if not classroom:
            raise SystemExit("No classroom owned by classteacher@astra.edu")

        assignment = (
            db.query(Assignment).filter(Assignment.classroom_id == classroom.id).first()
        )
        if not assignment:
            raise SystemExit("No assignment in classroom")

        existing_ids = {
            m.student_id
            for m in db.query(ClassroomStudent)
            .filter(ClassroomStudent.classroom_id == classroom.id)
            .all()
        }
        free = (
            db.query(User)
            .filter(User.role == UserRole.STUDENT)
            .filter(~User.id.in_(existing_ids) if existing_ids else True)
            .all()
        )

        join_emails: list[str] = []
        for student in free[:3]:
            db.add(
                ClassroomStudent(
                    classroom_id=classroom.id,
                    student_id=student.id,
                    status=MembershipStatus.PENDING,
                    is_active=True,
                )
            )
            join_emails.append(student.email)

        approved = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom.id,
                ClassroomStudent.status == MembershipStatus.APPROVED,
            )
            .all()
        )
        if not approved:
            raise SystemExit("No approved students to create submissions")

        ungraded_emails: list[str] = []
        for membership in approved[:2]:
            student = db.get(User, membership.student_id)
            if not student:
                continue
            sub = (
                db.query(AssignmentSubmission)
                .filter(
                    AssignmentSubmission.assignment_id == assignment.id,
                    AssignmentSubmission.student_id == student.id,
                )
                .first()
            )
            stored = f"notif_{assignment.id}_{student.id}_{secrets.token_hex(4)}.pdf"
            if sub:
                sub.marks = None
                sub.feedback = None
                sub.graded_at = None
                sub.graded_by = None
                sub.submitted_at = datetime.now(timezone.utc)
                sub.is_late = False
            else:
                db.add(
                    AssignmentSubmission(
                        assignment_id=assignment.id,
                        student_id=student.id,
                        file_name="dummy_notification_submission.pdf",
                        stored_name=stored,
                        file_path=f"uploads/seed/{stored}",
                        file_size=12345,
                        mime_type="application/pdf",
                        submitted_at=datetime.now(timezone.utc),
                        is_late=False,
                        marks=None,
                        feedback=None,
                        graded_at=None,
                        graded_by=None,
                    )
                )
            ungraded_emails.append(student.email)

        db.commit()

        pending_n = (
            db.query(ClassroomStudent)
            .filter(
                ClassroomStudent.classroom_id == classroom.id,
                ClassroomStudent.status == MembershipStatus.PENDING,
            )
            .count()
        )
        ungraded_n = (
            db.query(AssignmentSubmission)
            .filter(
                AssignmentSubmission.assignment_id == assignment.id,
                AssignmentSubmission.graded_at.is_(None),
            )
            .count()
        )
        print(f"OK classroom={classroom.id} ({classroom.name})")
        print(f"pending_joins={pending_n} {join_emails}")
        print(f"ungraded={ungraded_n} {ungraded_emails} assignment={assignment.title!r}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
