from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, text

from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.models import *  # noqa: F401,F403
from app.routers.auth_teacher import router as auth_router
from app.routers.auth_teacher import teacher_router
from app.routers.student_results import results_router, student_router

app = FastAPI(title=settings.app_name, version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5180",
        "http://localhost:5180",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _ensure_question_columns() -> None:
    """Add Bloom/rubric columns introduced after the original SQLite schema."""
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if "questions" not in tables:
        return
    cols = {c["name"] for c in inspector.get_columns("questions")}
    added_bloom = "bloom_level" not in cols
    added_rubric = "rubric_json" not in cols
    with engine.begin() as conn:
        if added_bloom:
            conn.execute(text("ALTER TABLE questions ADD COLUMN bloom_level VARCHAR(20) DEFAULT 'APPLY'"))
        if added_rubric:
            conn.execute(text("ALTER TABLE questions ADD COLUMN rubric_json JSON"))
        if "source_prompt" not in cols:
            conn.execute(text("ALTER TABLE questions ADD COLUMN source_prompt TEXT"))

    from app.services.bloom import bloom_from_difficulty, normalize_rubric

    db = SessionLocal()
    try:
        rows = db.query(Question).all()
        changed = False
        for row in rows:
            if added_bloom or not getattr(row, "bloom_level", None):
                row.bloom_level = bloom_from_difficulty(row.difficulty)
                changed = True
            if added_rubric or not getattr(row, "rubric_json", None):
                row.rubric_json = normalize_rubric(None)
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    _ensure_question_columns()


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}


app.include_router(auth_router, prefix="/api/v1")
app.include_router(teacher_router, prefix="/api/v1")
app.include_router(student_router, prefix="/api/v1")
app.include_router(results_router, prefix="/api/v1")
