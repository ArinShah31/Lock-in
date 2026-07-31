from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes.auth import router as auth_router
from app.api.routes.classrooms import router as classrooms_router
from app.api.routes.institutions import router as institutions_router
from app.api.routes.rbac_demo import router as rbac_router
from app.api.routes.subjects import router as subjects_router
from app.api.routes.users import router as users_router
from app.api.routes.content import router as content_router
from app.core.config import settings
from app.core.database import Base, engine
from app.models import (  # noqa: F401
    Classroom,
    ClassroomAnnouncement,
    ClassroomContent,
    ClassroomStudent,
    ClassroomTeacher,
    ContentType,
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
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # For initial scaffolding; replace with Alembic migrations in production.
    Base.metadata.create_all(bind=engine)


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
