import io
import unittest

from fastapi import HTTPException, UploadFile
from fastapi.testclient import TestClient

from app.core.database import Base, get_db
from app.core.security import create_access_token, get_password_hash
from app.main import app
from app.models.user import User, UserRole
from app.services.avatar_upload import (
    MAX_AVATAR_BYTES,
    save_avatar_file,
    validate_avatar_upload,
)


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


class AvatarUploadServiceTests(unittest.TestCase):
    def test_validate_rejects_non_image(self):
        upload = UploadFile(filename="bad.txt", file=io.BytesIO(b"hello"))
        with self.assertRaises(HTTPException) as ctx:
            validate_avatar_upload(upload, b"hello")
        self.assertEqual(ctx.exception.status_code, 400)

    def test_validate_accepts_png(self):
        upload = UploadFile(filename="avatar.png", file=io.BytesIO(PNG_BYTES))
        mime = validate_avatar_upload(upload, PNG_BYTES)
        self.assertEqual(mime, "image/png")

    def test_save_avatar_uses_user_id_filename(self):
        url = save_avatar_file(user_id=42, data=PNG_BYTES, mime_type="image/png", previous_avatar_url=None)
        self.assertEqual(url, "/uploads/avatars/42.png")


class ProfileApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from sqlalchemy.pool import StaticPool

        cls.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
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

    def setUp(self):
        self.db = self.SessionLocal()
        self.db.query(User).delete()
        self.db.commit()

        self.student = User(
            full_name="Student User",
            email="student@example.com",
            hashed_password=get_password_hash("password123"),
            role=UserRole.STUDENT,
        )
        self.teacher = User(
            full_name="Teacher User",
            email="teacher@example.com",
            hashed_password=get_password_hash("password123"),
            role=UserRole.CLASS_TEACHER,
        )
        self.google_student = User(
            full_name="Google Student",
            email="google@example.com",
            hashed_password=get_password_hash("random-google-secret"),
            role=UserRole.STUDENT,
            google_sub="google-sub-123",
        )
        self.db.add_all([self.student, self.teacher, self.google_student])
        self.db.commit()
        self.db.refresh(self.student)
        self.db.refresh(self.teacher)
        self.db.refresh(self.google_student)

        self.student_token = create_access_token(str(self.student.id), self.student.role.value)
        self.teacher_token = create_access_token(str(self.teacher.id), self.teacher.role.value)
        self.google_token = create_access_token(str(self.google_student.id), self.google_student.role.value)

    def tearDown(self):
        self.db.close()

    def test_student_profile_requires_auth(self):
        response = self.client.get("/api/v1/auth/me/profile")
        self.assertEqual(response.status_code, 401)

    def test_student_gets_student_profile(self):
        response = self.client.get(
            "/api/v1/auth/me/profile",
            headers={"Authorization": f"Bearer {self.student_token}"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsNotNone(data["student"])
        self.assertIsNone(data["teacher"])
        self.assertEqual(data["identity"]["email"], "student@example.com")

    def test_teacher_gets_teacher_profile(self):
        response = self.client.get(
            "/api/v1/auth/me/profile",
            headers={"Authorization": f"Bearer {self.teacher_token}"},
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsNotNone(data["teacher"])
        self.assertIsNone(data["student"])

    def test_patch_me_updates_name_only(self):
        response = self.client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {self.student_token}"},
            json={"full_name": "Updated Name"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["full_name"], "Updated Name")
        self.assertEqual(response.json()["role"], "STUDENT")

    def test_patch_me_rejects_role_change(self):
        response = self.client.patch(
            "/api/v1/auth/me",
            headers={"Authorization": f"Bearer {self.student_token}"},
            json={"full_name": "Updated Name", "role": "CLASS_TEACHER"},
        )
        self.assertEqual(response.status_code, 422)

    def test_change_password_rejects_wrong_current(self):
        response = self.client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {self.student_token}"},
            json={"current_password": "wrong", "new_password": "newpassword1"},
        )
        self.assertEqual(response.status_code, 400)

    def test_change_password_success(self):
        response = self.client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {self.student_token}"},
            json={"current_password": "password123", "new_password": "newpassword1"},
        )
        self.assertEqual(response.status_code, 204)
        self.assertEqual(response.text, "")

    def test_change_password_does_not_expose_hash(self):
        response = self.client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {self.student_token}"},
            json={"current_password": "password123", "new_password": "newpassword1"},
        )
        self.assertNotIn("hashed_password", response.text)
        self.assertNotIn("password", response.text.lower())

    def test_google_account_password_change_clear_400(self):
        response = self.client.post(
            "/api/v1/auth/change-password",
            headers={"Authorization": f"Bearer {self.google_token}"},
            json={"current_password": "anything", "new_password": "newpassword1"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Google Sign-In", response.json()["detail"])

    def test_avatar_upload_requires_auth(self):
        response = self.client.post(
            "/api/v1/auth/me/avatar",
            files={"file": ("avatar.png", PNG_BYTES, "image/png")},
        )
        self.assertEqual(response.status_code, 401)

    def test_avatar_upload_rejects_invalid_type(self):
        response = self.client.post(
            "/api/v1/auth/me/avatar",
            headers={"Authorization": f"Bearer {self.student_token}"},
            files={"file": ("avatar.txt", b"not-an-image", "text/plain")},
        )
        self.assertEqual(response.status_code, 400)

    def test_avatar_upload_accepts_png(self):
        response = self.client.post(
            "/api/v1/auth/me/avatar",
            headers={"Authorization": f"Bearer {self.student_token}"},
            files={"file": ("avatar.png", PNG_BYTES, "image/png")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["avatar_url"].startswith("/uploads/avatars/"))

    def test_avatar_upload_rejects_oversized_file(self):
        huge = PNG_BYTES + (b"\x00" * (MAX_AVATAR_BYTES + 1))
        response = self.client.post(
            "/api/v1/auth/me/avatar",
            headers={"Authorization": f"Bearer {self.student_token}"},
            files={"file": ("avatar.png", huge, "image/png")},
        )
        self.assertEqual(response.status_code, 413)


if __name__ == "__main__":
    unittest.main()
