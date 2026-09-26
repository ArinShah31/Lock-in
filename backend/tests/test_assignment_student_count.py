import unittest
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.assignment import Assignment, AssignmentSubmission
from app.models.classroom import Classroom, ClassroomStudent, MembershipStatus
from app.models.institution import Institution
from app.models.user import User, UserRole


class AssignmentStudentCountTests(unittest.TestCase):
    """The teacher's due-soon reminder needs the approved-student total per classroom."""

    @classmethod
    def setUpClass(cls):
        cls.engine = create_engine(
            "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
        )
        Base.metadata.create_all(bind=cls.engine)
        cls.SessionLocal = sessionmaker(bind=cls.engine)

        def override_get_db():
            db = cls.SessionLocal()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=cls.engine)

    def _user(self, name, role, inst_id):
        u = User(
            full_name=name,
            email=f"{name.lower()}@example.com",
            hashed_password=get_password_hash("password123"),
            role=role,
            institution_id=inst_id,
        )
        self.db.add(u)
        self.db.commit()
        self.db.refresh(u)
        return u

    def _headers(self, user):
        return {"Authorization": f"Bearer {create_access_token(str(user.id), user.role.value)}"}

    def setUp(self):
        self.db = self.SessionLocal()
        for model in (
            AssignmentSubmission,
            Assignment,
            ClassroomStudent,
            Classroom,
            User,
            Institution,
        ):
            self.db.query(model).delete()
        self.db.commit()
        inst = Institution(name="Inst", code="INST")
        self.db.add(inst)
        self.db.commit()
        self.db.refresh(inst)
        self.teacher = self._user("Teacher", UserRole.CLASS_TEACHER, inst.id)
        self.alice = self._user("Alice", UserRole.STUDENT, inst.id)
        self.bob = self._user("Bob", UserRole.STUDENT, inst.id)
        self.pending = self._user("Pending", UserRole.STUDENT, inst.id)
        self.classroom = Classroom(
            institution_id=inst.id,
            class_teacher_id=self.teacher.id,
            name="CS",
            code="CS1",
            join_code="ABCDE",
        )
        self.db.add(self.classroom)
        self.db.commit()
        self.db.refresh(self.classroom)
        for student, status in (
            (self.alice, MembershipStatus.APPROVED),
            (self.bob, MembershipStatus.APPROVED),
            (self.pending, MembershipStatus.PENDING),
        ):
            self.db.add(
                ClassroomStudent(classroom_id=self.classroom.id, student_id=student.id, status=status)
            )
        assignment = Assignment(
            classroom_id=self.classroom.id,
            created_by=self.teacher.id,
            title="HW1",
            max_marks=10,
            due_at=datetime.now(timezone.utc) + timedelta(hours=24),
        )
        self.db.add(assignment)
        self.db.commit()
        self.db.refresh(assignment)
        self.db.add(
            AssignmentSubmission(
                assignment_id=assignment.id,
                student_id=self.alice.id,
                file_name="a.txt",
                stored_name="a.txt",
                file_path="x",
                file_size=1,
                mime_type="text/plain",
                submitted_at=datetime.now(timezone.utc),
                is_late=False,
            )
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_teacher_gets_approved_student_count_only(self):
        res = self.client.get(
            f"/api/v1/classrooms/{self.classroom.id}/assignments", headers=self._headers(self.teacher)
        )
        self.assertEqual(res.status_code, 200)
        row = res.json()[0]
        # 2 approved students (pending one excluded), 1 submitted -> 1 hasn't submitted.
        self.assertEqual(row["student_count"], 2)
        self.assertEqual(row["submitted_count"], 1)

    def test_student_does_not_get_student_count(self):
        res = self.client.get(
            f"/api/v1/classrooms/{self.classroom.id}/assignments", headers=self._headers(self.bob)
        )
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.json()[0]["student_count"])


if __name__ == "__main__":
    unittest.main()
