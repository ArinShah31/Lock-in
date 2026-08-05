from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import Base, engine
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


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok", "app": settings.app_name}


app.include_router(auth_router, prefix="/api/v1")
app.include_router(teacher_router, prefix="/api/v1")
app.include_router(student_router, prefix="/api/v1")
app.include_router(results_router, prefix="/api/v1")
