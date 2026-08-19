from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.auth import router as auth_router
from app.api.routes.classrooms import router as classrooms_router
from app.api.routes.coding_platform import router as coding_platform_router
from app.api.routes.theory_platform import router as theory_platform_router
from app.api.routes.institutions import router as institutions_router
from app.api.routes.rbac_demo import router as rbac_router
from app.api.routes.subjects import router as subjects_router
from app.api.routes.users import router as users_router
from app.api.routes.content import router as content_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.ai import router as ai_router
from app.api.routes.classroom_course_builder import router as course_builder_router
from app.api.routes.practice import router as practice_router
from app.api.routes.streak import router as streak_router
from app.api.routes.presentations import router as presentations_router
from app.core.config import settings
from app.core.database import Base, engine
from sqlalchemy import inspect, text
from app.models import (  # noqa: F401
    Assignment,
    AssignmentSubmission,
    Classroom,
    ClassroomAnalyticsGrant,
    ClassroomAnnouncement,
    ClassroomContent,
    ClassroomCourse,
    ClassroomStudent,
    ClassroomTeacher,
    ContentType,
    CourseBuildJob,
    CourseChapterAttempt,
    CourseChapterLock,
    MockExam,
    MockExamAttempt,
    PracticeAssessmentLock,
    ClassroomPresentation,
    PresentationSlide,
    Department,
    Institution,
    Subject,
    SubjectMaterial,
    User,
)

app = FastAPI(title=settings.app_name, version="1.0.0")

app.mount(
    "/uploads",
    StaticFiles(directory="uploads"),
    name="uploads",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5180",
        "http://127.0.0.1:5180",
        "http://localhost:5181",
        "http://127.0.0.1:5181",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # For initial scaffolding; replace with Alembic migrations in production.
    Base.metadata.create_all(bind=engine)
    _ensure_sqlite_columns()
    # Course generation runs in background threads; reloads/crashes orphan RUNNING rows.
    from app.services.classroom_course_builder import fail_orphaned_jobs

    cleared = fail_orphaned_jobs()
    if cleared:
        print(f"[course-builder] marked {cleared} orphaned job(s) as FAILED")
    from app.services.presentation_jobs import fail_orphaned_video_jobs

    video_cleared = fail_orphaned_video_jobs()
    if video_cleared:
        print(f"[presentations] marked {video_cleared} orphaned video job(s) as FAILED")

    try:
        from app.ai.vectorstore.service import create_collection

        create_collection()
        print(f"[qdrant] collection ready: {settings.qdrant_collection}")
    except Exception as exc:  # noqa: BLE001
        print(f"[qdrant] startup skipped: {exc}")


def _ensure_sqlite_columns():
    """Add columns introduced after initial create_all (SQLite has no ALTER via metadata)."""
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if "users" in tables:
        cols = {c["name"] for c in inspector.get_columns("users")}
        if "coding_platform_enabled" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN coding_platform_enabled BOOLEAN NOT NULL DEFAULT 0"
                    )
                )
        if "theory_platform_enabled" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN theory_platform_enabled BOOLEAN NOT NULL DEFAULT 0"
                    )
                )
        if "avatar_url" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN avatar_url VARCHAR(512)"))
        if "google_sub" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"
                    )
                )
    if "classroom_students" in tables:
        cols = {c["name"] for c in inspector.get_columns("classroom_students")}
        if "decided_at" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE classroom_students ADD COLUMN decided_at DATETIME"))
    if "classrooms" in tables:
        cols = {c["name"] for c in inspector.get_columns("classrooms")}
        if "analytics_share_code" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text("ALTER TABLE classrooms ADD COLUMN analytics_share_code VARCHAR(12)")
                )
    if "classroom_presentations" in tables:
        cols = {c["name"] for c in inspector.get_columns("classroom_presentations")}
        if "video_path" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE classroom_presentations ADD COLUMN video_path VARCHAR(500)"
                    )
                )
        if "progress_message" not in cols:
            with engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE classroom_presentations ADD COLUMN progress_message VARCHAR(255)"
                    )
                )
    _backfill_analytics_share_codes()


def _backfill_analytics_share_codes():
    """Give every classroom an analytics share code (additive, idempotent)."""
    import secrets
    import string

    from sqlalchemy.orm import Session

    from app.models.classroom import Classroom as ClassroomModel

    alphabet = string.ascii_uppercase + string.digits
    with Session(engine) as session:
        missing = (
            session.query(ClassroomModel)
            .filter(
                (ClassroomModel.analytics_share_code.is_(None))
                | (ClassroomModel.analytics_share_code == "")
            )
            .all()
        )
        if not missing:
            return
        existing = {
            row[0]
            for row in session.query(ClassroomModel.analytics_share_code)
            .filter(ClassroomModel.analytics_share_code.isnot(None))
            .all()
        }
        for classroom in missing:
            for _ in range(50):
                code = "".join(secrets.choice(alphabet) for _ in range(8))
                if code not in existing:
                    existing.add(code)
                    classroom.analytics_share_code = code
                    break
        session.commit()
        print(f"[analytics-share] backfilled {len(missing)} classroom share code(s)")


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(auth_router, prefix="/api/v1")
app.include_router(institutions_router, prefix="/api/v1")
app.include_router(classrooms_router, prefix="/api/v1")
app.include_router(subjects_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(rbac_router, prefix="/api/v1")
app.include_router(content_router, prefix="/api/v1")
app.include_router(assignments_router, prefix="/api/v1")
app.include_router(ai_router, prefix="/api/v1")
app.include_router(course_builder_router, prefix="/api/v1")
app.include_router(practice_router, prefix="/api/v1")
app.include_router(presentations_router, prefix="/api/v1")
app.include_router(coding_platform_router, prefix="/api/v1")
app.include_router(theory_platform_router, prefix="/api/v1")
app.include_router(streak_router, prefix="/api/v1")
