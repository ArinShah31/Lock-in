from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.auth import router as auth_router
from app.api.routes.classrooms import router as classrooms_router
from app.api.routes.coding_platform import router as coding_platform_router
from app.api.routes.institutions import router as institutions_router
from app.api.routes.rbac_demo import router as rbac_router
from app.api.routes.subjects import router as subjects_router
from app.api.routes.users import router as users_router
from app.api.routes.content import router as content_router
from app.api.routes.assignments import router as assignments_router
from app.api.routes.classroom_course_builder import router as course_builder_router
from app.core.config import settings
from app.core.database import Base, engine
from sqlalchemy import inspect, text
from app.models import (  # noqa: F401
    Assignment,
    AssignmentSubmission,
    Classroom,
    ClassroomAnnouncement,
    ClassroomContent,
    ClassroomCourse,
    ClassroomStudent,
    ClassroomTeacher,
    ContentType,
    CourseBuildJob,
    CourseChapterAttempt,
    CourseChapterLock,
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


def _ensure_sqlite_columns():
    """Add columns introduced after initial create_all (SQLite has no ALTER via metadata)."""
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "users" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("users")}
    if "coding_platform_enabled" not in cols:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE users ADD COLUMN coding_platform_enabled BOOLEAN NOT NULL DEFAULT 0"
                )
            )


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
app.include_router(course_builder_router, prefix="/api/v1")
app.include_router(coding_platform_router, prefix="/api/v1")
