import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from config import settings
from models.database import SessionLocal, init_db
from routers.auth import router as auth_router
from routers.chats import router as chats_router
from routers.documents import router as documents_router

logger = logging.getLogger(__name__)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    """Initialize database tables when the application starts."""

    if not settings.DB_INIT_ON_STARTUP:
        logger.warning("Skipping database initialization on startup (DB_INIT_ON_STARTUP=false).")
        return

    try:
        init_db()
    except Exception:
        logger.exception("Database initialization failed during startup.")


app.include_router(auth_router)
app.include_router(chats_router)
app.include_router(documents_router)

uploads_dir = Path(__file__).resolve().parent / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/db")
def health_db() -> dict[str, str]:
    """Check database connectivity with a simple SELECT 1."""

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "database": "reachable"}
    except Exception as exc:
        logger.exception("Database health check failed.")
        return {"status": "error", "database": "unreachable", "detail": str(exc)}
    finally:
        db.close()
