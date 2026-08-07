"""Seed a class-teacher login, classroom, and dummy data for local testing.

Primary login (use this):
  email:    classteacher@astra.demo
  password: DemoPass123

Also creates a peer classroom with an analytics grant so the Analytics tab
has inbound shared data ready to open.
"""

from __future__ import annotations

import secrets
import string
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.core.database import Base, SessionLocal, engine
from app.core.security import get_password_hash
from app.models import (
    Assignment,
    AssignmentSubmission,
    Classroom,
    ClassroomAnalyticsGrant,
    ClassroomAnnouncement,
    ClassroomCourse,
    ClassroomStudent,
    ClassroomTeacher,
    Department,
    Institution,
    MembershipStatus,
    Subject,
    User,
)
from app.models.user import UserRole

DEMO_PASSWORD = "DemoPass123"
ALPHABET = string.ascii_uppercase + string.digits


def _unique_code(db, model, field: str, length: int) -> str:
    existing = {row[0] for row in db.query(getattr(model, field)).all() if row[0]}
    for _ in range(50):
        code = "".join(secrets.choice(ALPHABET) for _ in range(length))
        if code not in existing:
            return code
    raise RuntimeError(f"Could not generate unique {field}")


def _get_or_create_user(
    db,
    *,
    email: str,
    full_name: str,
    role: UserRole,
    institution_id: int | None,
    department_id: int | None,
    coding_platform_enabled: bool = False,
) -> User:
    user = db.query(User).filter(User.email == email.lower()).first()
    if user:
        user.full_name = full_name
        user.role = role
        user.hashed_password = get_password_hash(DEMO_PASSWORD)
        user.is_active = True
        user.institution_id = institution_id
        user.department_id = department_id
        user.coding_platform_enabled = coding_platform_enabled
        return user
    user = User(
        full_name=full_name,
        email=email.lower(),
        hashed_password=get_password_hash(DEMO_PASSWORD),
        role=role,
        is_active=True,
        institution_id=institution_id,
        department_id=department_id,
        coding_platform_enabled=coding_platform_enabled,
    )
    db.add(user)
    db.flush()
    return user


def _get_or_create_classroom(
    db,
    *,
    institution_id: int,
    department_id: int,
    class_teacher_id: int,
    name: str,
    code: str,
    description: str,
) -> Classroom:
    classroom = (
        db.query(Classroom)
        .filter(
            Classroom.institution_id == institution_id,
            Classroom.code == code.upper(),
        )
        .first()
    )
    if classroom:
        classroom.name = name
        classroom.class_teacher_id = class_teacher_id
        classroom.department_id = department_id
        classroom.description = description
        classroom.is_active = True
        classroom.academic_year = "2025-26"
        if not classroom.analytics_share_code:
            classroom.analytics_share_code = _unique_code(db, Classroom, "analytics_share_code", 8)
        return classroom

    classroom = Classroom(
        institution_id=institution_id,
        department_id=department_id,
        class_teacher_id=class_teacher_id,
        name=name,
        code=code.upper(),
        join_code=_unique_code(db, Classroom, "join_code", 5),
        analytics_share_code=_unique_code(db, Classroom, "analytics_share_code", 8),
        academic_year="2025-26",
        description=description,
        is_active=True,
    )
    db.add(classroom)
    db.flush()
    return classroom


def _ensure_membership(db, classroom_id: int, student_id: int) -> None:
    existing = (
        db.query(ClassroomStudent)
        .filter(
            ClassroomStudent.classroom_id == classroom_id,
            ClassroomStudent.student_id == student_id,
        )
        .first()
    )
    if existing:
        existing.status = MembershipStatus.APPROVED
        existing.is_active = True
        return
    db.add(
        ClassroomStudent(
            classroom_id=classroom_id,
            student_id=student_id,
            status=MembershipStatus.APPROVED,
            is_active=True,
        )
    )


def _ensure_teacher_link(db, classroom_id: int, teacher_id: int, subject_label: str) -> None:
    existing = (
        db.query(ClassroomTeacher)
        .filter(
            ClassroomTeacher.classroom_id == classroom_id,
            ClassroomTeacher.teacher_id == teacher_id,
            ClassroomTeacher.subject_label == subject_label,
        )
        .first()
    )
    if existing:
        existing.is_active = True
        return
    db.add(
        ClassroomTeacher(
            classroom_id=classroom_id,
            teacher_id=teacher_id,
            subject_label=subject_label,
            is_active=True,
        )
    )


def _ensure_assignment(
    db,
    *,
    classroom_id: int,
    created_by: int,
    title: str,
    max_marks: float,
    days_ago_due: int,
) -> Assignment:
    assignment = (
        db.query(Assignment)
        .filter(Assignment.classroom_id == classroom_id, Assignment.title == title)
        .first()
    )
    now = datetime.now(timezone.utc)
    if assignment:
        assignment.max_marks = max_marks
        assignment.due_at = now + timedelta(days=days_ago_due)
        assignment.is_active = True
        assignment.instructions = assignment.instructions or f"Dummy assignment: {title}"
        return assignment
    assignment = Assignment(
        classroom_id=classroom_id,
        created_by=created_by,
        title=title,
        instructions=f"Dummy assignment: {title}",
        max_marks=max_marks,
        due_at=now + timedelta(days=days_ago_due),
        is_active=True,
    )
    db.add(assignment)
    db.flush()
    return assignment


def _ensure_submission(
    db,
    *,
    assignment: Assignment,
    student_id: int,
    marks: float | None,
    days_ago: int,
) -> None:
    existing = (
        db.query(AssignmentSubmission)
        .filter(
            AssignmentSubmission.assignment_id == assignment.id,
            AssignmentSubmission.student_id == student_id,
        )
        .first()
    )
    submitted_at = datetime.now(timezone.utc) - timedelta(days=days_ago)
    stored = f"seed_{assignment.id}_{student_id}.pdf"
    if existing:
        existing.marks = marks
        existing.submitted_at = submitted_at
        existing.graded_at = submitted_at + timedelta(hours=2) if marks is not None else None
        existing.graded_by = assignment.created_by if marks is not None else None
        return
    db.add(
        AssignmentSubmission(
            assignment_id=assignment.id,
            student_id=student_id,
            file_name=f"{assignment.title.replace(' ', '_').lower()}.pdf",
            stored_name=stored,
            file_path=f"uploads/seed/{stored}",
            file_size=12_345,
            mime_type="application/pdf",
            submitted_at=submitted_at,
            is_late=False,
            marks=marks,
            feedback="Looks good — keep practicing." if marks is not None else None,
            graded_at=submitted_at + timedelta(hours=2) if marks is not None else None,
            graded_by=assignment.created_by if marks is not None else None,
        )
    )


def _ensure_analytics_grant(
    db,
    *,
    viewer_classroom_id: int,
    source_classroom_id: int,
    granted_by_user_id: int,
) -> None:
    grant = (
        db.query(ClassroomAnalyticsGrant)
        .filter(
            ClassroomAnalyticsGrant.viewer_classroom_id == viewer_classroom_id,
            ClassroomAnalyticsGrant.source_classroom_id == source_classroom_id,
        )
        .first()
    )
    if not grant:
        db.add(
            ClassroomAnalyticsGrant(
                viewer_classroom_id=viewer_classroom_id,
                source_classroom_id=source_classroom_id,
                granted_by_user_id=granted_by_user_id,
                is_active=True,
            )
        )
    else:
        grant.is_active = True
        grant.granted_by_user_id = granted_by_user_id


def _seed_classroom_bundle(
    db,
    *,
    institution: Institution,
    department: Department,
    teacher: User,
    classroom_name: str,
    classroom_code: str,
    description: str,
    student_specs: list[tuple[str, str]],
    assignment_titles: tuple[str, str, str],
) -> tuple[Classroom, list[User]]:
    classroom = _get_or_create_classroom(
        db,
        institution_id=institution.id,
        department_id=department.id,
        class_teacher_id=teacher.id,
        name=classroom_name,
        code=classroom_code,
        description=description,
    )
    _ensure_teacher_link(db, classroom.id, teacher.id, "GENERAL")

    students: list[User] = []
    for email, name in student_specs:
        student = _get_or_create_user(
            db,
            email=email,
            full_name=name,
            role=UserRole.STUDENT,
            institution_id=institution.id,
            department_id=department.id,
            coding_platform_enabled=True,
        )
        students.append(student)
        _ensure_membership(db, classroom.id, student.id)

    subject = (
        db.query(Subject)
        .filter(Subject.classroom_id == classroom.id, Subject.code == "DSA")
        .first()
    )
    if not subject:
        subject = Subject(
            classroom_id=classroom.id,
            teacher_id=teacher.id,
            name="Data Structures",
            code="DSA",
            description="Arrays, trees, graphs, and complexity.",
            syllabus_text="Week 1-4: Arrays & Linked Lists\nWeek 5-8: Trees & Heaps\nWeek 9-12: Graphs",
            is_published=True,
            is_active=True,
        )
        db.add(subject)
        db.flush()

    welcome_title = f"Welcome to {classroom.code}"
    announcement = (
        db.query(ClassroomAnnouncement)
        .filter(
            ClassroomAnnouncement.classroom_id == classroom.id,
            ClassroomAnnouncement.title == welcome_title,
        )
        .first()
    )
    if not announcement:
        db.add(
            ClassroomAnnouncement(
                classroom_id=classroom.id,
                author_id=teacher.id,
                title=welcome_title,
                body="Dummy announcement for class-teacher / analytics testing.",
                is_active=True,
            )
        )

    course = db.query(ClassroomCourse).filter(ClassroomCourse.classroom_id == classroom.id).first()
    if not course:
        db.add(
            ClassroomCourse(
                classroom_id=classroom.id,
                created_by_id=teacher.id,
                title="Intro to Data Structures",
                syllabus_text="Seeded syllabus for demo.",
                source_content_ids=[],
                content={
                    "chapters": [
                        {
                            "title": "Arrays & Complexity",
                            "subtopics": ["Big-O basics", "Two-pointer patterns"],
                        }
                    ]
                },
                is_published=True,
                is_active=True,
            )
        )
    else:
        course.is_published = True
        course.is_active = True

    a1 = _ensure_assignment(
        db,
        classroom_id=classroom.id,
        created_by=teacher.id,
        title=assignment_titles[0],
        max_marks=20,
        days_ago_due=-3,
    )
    a2 = _ensure_assignment(
        db,
        classroom_id=classroom.id,
        created_by=teacher.id,
        title=assignment_titles[1],
        max_marks=25,
        days_ago_due=4,
    )
    a3 = _ensure_assignment(
        db,
        classroom_id=classroom.id,
        created_by=teacher.id,
        title=assignment_titles[2],
        max_marks=30,
        days_ago_due=10,
    )

    submission_plan = [
        (a1, students[0], 18.0, 5),
        (a1, students[1], 15.0, 4),
        (a1, students[2], 20.0, 6),
        (a1, students[3], 12.0, 3),
        (a2, students[0], 22.0, 2),
        (a2, students[1], None, 1),
        (a2, students[2], 19.0, 2),
        (a3, students[0], 27.0, 1),
        (a3, students[4], 24.0, 1),
    ]
    for assignment, student, marks, days_ago in submission_plan:
        _ensure_submission(
            db,
            assignment=assignment,
            student_id=student.id,
            marks=marks,
            days_ago=days_ago,
        )

    return classroom, students


def _seed_astra_demo_college(db) -> None:
    institution = db.query(Institution).filter(Institution.code == "ASTRADEMO").first()
    if not institution:
        institution = Institution(
            name="Astra Demo College",
            code="ASTRADEMO",
            address="Demo Campus",
            is_active=True,
        )
        db.add(institution)
        db.flush()

    department = (
        db.query(Department)
        .filter(Department.institution_id == institution.id, Department.code == "CSE")
        .first()
    )
    if not department:
        department = Department(
            institution_id=institution.id,
            name="Computer Science",
            code="CSE",
            is_active=True,
        )
        db.add(department)
        db.flush()

    teacher = _get_or_create_user(
        db,
        email="classteacher@astra.demo",
        full_name="Priya Sharma",
        role=UserRole.CLASS_TEACHER,
        institution_id=institution.id,
        department_id=department.id,
        coding_platform_enabled=True,
    )
    peer_teacher = _get_or_create_user(
        db,
        email="peerteacher@astra.demo",
        full_name="Arjun Mehta",
        role=UserRole.CLASS_TEACHER,
        institution_id=institution.id,
        department_id=department.id,
        coding_platform_enabled=True,
    )

    classroom, students = _seed_classroom_bundle(
        db,
        institution=institution,
        department=department,
        teacher=teacher,
        classroom_name="Year 2 CS - Section A",
        classroom_code="Y2CSA",
        description="Primary demo classroom for class-teacher feature testing.",
        student_specs=[
            ("student1@astra.demo", "Ananya Iyer"),
            ("student2@astra.demo", "Rohan Gupta"),
            ("student3@astra.demo", "Meera Nair"),
            ("student4@astra.demo", "Kabir Singh"),
            ("student5@astra.demo", "Sara Khan"),
        ],
        assignment_titles=("Arrays worksheet", "Linked list lab", "Tree traversal quiz"),
    )

    peer_classroom, peer_students = _seed_classroom_bundle(
        db,
        institution=institution,
        department=department,
        teacher=peer_teacher,
        classroom_name="Year 2 CS - Section B",
        classroom_code="Y2CSB",
        description="Peer classroom that shares analytics with Section A.",
        student_specs=[
            ("peerstudent1@astra.demo", "Dev Patel"),
            ("peerstudent2@astra.demo", "Nina Bose"),
            ("peerstudent3@astra.demo", "Omar Ali"),
            ("peerstudent4@astra.demo", "Leah Cruz"),
            ("peerstudent5@astra.demo", "Sam Okonkwo"),
        ],
        assignment_titles=("Peer: Sorting drill", "Peer: Recursion set", "Peer: Hash maps"),
    )

    _ensure_analytics_grant(
        db,
        viewer_classroom_id=classroom.id,
        source_classroom_id=peer_classroom.id,
        granted_by_user_id=peer_teacher.id,
    )

    print("=" * 60)
    print("Astra Demo College seed")
    print("=" * 60)
    print(f"Login:     classteacher@astra.demo / {DEMO_PASSWORD}")
    print(f"Classroom: {classroom.name}  [{classroom.code}]  join={classroom.join_code}")
    print(f"Peer:      peerteacher@astra.demo / {DEMO_PASSWORD}  [{peer_classroom.code}]")
    print(f"Students:  {len(students)} in Section A, {len(peer_students)} in Section B")


def _seed_demo_university_peer(db) -> None:
    """Second class teacher in the same institution as classteacher@astra.edu."""
    existing = db.query(User).filter(User.email == "classteacher@astra.edu").first()
    if not existing or existing.institution_id is None:
        print("SKIP Demo University peer: classteacher@astra.edu not found")
        return

    institution = db.query(Institution).filter(Institution.id == existing.institution_id).first()
    if not institution:
        print("SKIP Demo University peer: institution missing")
        return

    department = None
    if existing.department_id:
        department = db.query(Department).filter(Department.id == existing.department_id).first()
    if department is None:
        department = (
            db.query(Department)
            .filter(Department.institution_id == institution.id, Department.code == "CSE")
            .first()
        )
    if department is None:
        department = Department(
            institution_id=institution.id,
            name="Computer Science",
            code="CSE",
            is_active=True,
        )
        db.add(department)
        db.flush()

    peer_teacher = _get_or_create_user(
        db,
        email="peerteacher@astra.edu",
        full_name="Neha Kapoor",
        role=UserRole.CLASS_TEACHER,
        institution_id=institution.id,
        department_id=department.id,
        coding_platform_enabled=True,
    )

    peer_classroom, students = _seed_classroom_bundle(
        db,
        institution=institution,
        department=department,
        teacher=peer_teacher,
        classroom_name="Year 2 CS - Section B",
        classroom_code="Y2CSB",
        description="Peer classroom in Demo University for analytics sharing tests.",
        student_specs=[
            ("student1@astra.edu", "Ananya Iyer"),
            ("student2@astra.edu", "Rohan Gupta"),
            ("student3@astra.edu", "Meera Nair"),
            ("student4@astra.edu", "Kabir Singh"),
            ("student5@astra.edu", "Sara Khan"),
        ],
        assignment_titles=("Sorting drill", "Recursion set", "Hash map quiz"),
    )

    # Existing classteacher@astra.edu classroom (aiec) gets inbound analytics from peer
    source_rooms = (
        db.query(Classroom)
        .filter(Classroom.class_teacher_id == existing.id, Classroom.is_active.is_(True))
        .all()
    )
    for source in source_rooms:
        if not source.analytics_share_code:
            source.analytics_share_code = _unique_code(db, Classroom, "analytics_share_code", 8)
        _ensure_analytics_grant(
            db,
            viewer_classroom_id=source.id,
            source_classroom_id=peer_classroom.id,
            granted_by_user_id=peer_teacher.id,
        )
        _ensure_analytics_grant(
            db,
            viewer_classroom_id=peer_classroom.id,
            source_classroom_id=source.id,
            granted_by_user_id=existing.id,
        )

    print("=" * 60)
    print(f"Demo University peer ({institution.name})")
    print("=" * 60)
    print(f"Login:     peerteacher@astra.edu / {DEMO_PASSWORD}")
    print(f"Name:      {peer_teacher.full_name}  (CLASS_TEACHER)")
    print(f"Same inst: {institution.code} as classteacher@astra.edu")
    print(f"Classroom: {peer_classroom.name}  [{peer_classroom.code}]")
    print(f"Join code: {peer_classroom.join_code}")
    print(f"Analytics share code: {peer_classroom.analytics_share_code}")
    print("Analytics grants: linked with classteacher@astra.edu classroom(s)")
    print("Students (password DemoPass123):")
    for s in students:
        print(f"  - {s.email}  ({s.full_name})")


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        _seed_astra_demo_college(db)
        _seed_demo_university_peer(db)
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
