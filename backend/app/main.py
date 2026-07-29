from fastapi import FastAPI

from app.api.routes.auth import router as auth_router
from app.api.routes.rbac_demo import router as rbac_router
from app.core.config import settings
from app.core.database import Base, engine

app = FastAPI(title=settings.app_name, version="1.0.0")


@app.on_event("startup")
def on_startup():
    # For initial scaffolding; replace with Alembic migrations in production.
    Base.metadata.create_all(bind=engine)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(auth_router, prefix="/api/v1")
app.include_router(rbac_router, prefix="/api/v1")
