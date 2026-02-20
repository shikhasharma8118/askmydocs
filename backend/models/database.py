import uuid
from datetime import datetime
from typing import Any, Generator

from fastapi import HTTPException, status
from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, create_engine, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session, declarative_base, relationship, sessionmaker

from config import settings


def _normalize_database_url(database_url: str) -> str:
    """Normalize DATABASE_URL for SQLAlchemy/psycopg2 compatibility."""

    cleaned_url = database_url.strip().strip('"').strip("'")
    if "?" not in cleaned_url:
        return cleaned_url

    base_url, query_string = cleaned_url.split("?", 1)
    query_parts = [part for part in query_string.split("&") if part and part != "pgbouncer=true"]

    if not query_parts:
        return base_url

    return f"{base_url}?{'&'.join(query_parts)}"


DATABASE_URL = _normalize_database_url(settings.DATABASE_URL)

connect_args: dict[str, Any] = {}
if DATABASE_URL.startswith("postgresql"):
    connect_args = {"connect_timeout": 10}

engine = create_engine(DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    """SQLAlchemy model for application users."""

    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String)
    firebase_uid = Column(String, unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    documents = relationship("Document", back_populates="user")


class Document(Base):
    """SQLAlchemy model for uploaded documents."""

    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    filename = Column(String, nullable=False)
    mime_type = Column(String, default="application/octet-stream")
    supabase_url = Column(String, nullable=False)
    file_size_bytes = Column(Integer, default=0)
    status = Column(String, default="processing")
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="documents")


def get_db() -> Generator[Session, None, None]:
    """Yield a database session and ensure it is closed after the request."""

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        yield db
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database unavailable. Check DATABASE_URL credentials.",
        ) from exc
    finally:
        db.close()


def init_db() -> None:
    """Create all database tables at application startup."""

    try:
        Base.metadata.create_all(bind=engine)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE documents "
                    "ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER DEFAULT 0"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE documents "
                    "ADD COLUMN IF NOT EXISTS mime_type VARCHAR DEFAULT 'application/octet-stream'"
                )
            )
    except SQLAlchemyError as exc:
        raise RuntimeError("Database initialization failed") from exc
