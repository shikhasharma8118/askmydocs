from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class UserCreate(BaseModel):
    """Request model for creating a new user."""

    email: str
    display_name: str
    firebase_uid: str


class UserResponse(BaseModel):
    """Response model for returning user data."""

    id: str
    email: str
    display_name: str
    created_at: datetime

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def serialize_id(cls, value: Any) -> str:
        if isinstance(value, UUID):
            return str(value)
        return str(value)


class DocumentUpload(BaseModel):
    """Request model for validating document upload input."""

    filename: str


class DocumentResponse(BaseModel):
    """Response model for returning document metadata."""

    id: str
    filename: str
    mime_type: str = "application/octet-stream"
    file_size_bytes: int = 0
    status: str
    summary: str | None = None
    summary_generated_at: datetime | None = None
    uploaded_at: datetime
    supabase_url: str

    model_config = {"from_attributes": True}

    @field_validator("id", mode="before")
    @classmethod
    def serialize_id(cls, value: Any) -> str:
        if isinstance(value, UUID):
            return str(value)
        return str(value)


class QuestionRequest(BaseModel):
    """Request model for asking a question about a document."""

    question: str = Field(min_length=1)
    document_id: Optional[str] = None


class AnswerResponse(BaseModel):
    """Response model for returning AI-generated answers and sources."""

    answer: str
    sources: List[Dict[str, Any]]


class TokenResponse(BaseModel):
    """Response model for returning JWT authentication tokens."""

    access_token: str
    token_type: str = "bearer"


class AuthResponse(TokenResponse):
    """Response model for returning JWT and authenticated user profile."""

    user: UserResponse


class FirebaseTokenRequest(BaseModel):
    """Request model for exchanging a Firebase token."""

    firebase_token: str


class DocumentPreviewResponse(BaseModel):
    """Response model for returning preview content for a stored document."""

    id: str
    filename: str
    mime_type: str
    preview_type: str
    content: str | None = None
    file_url: str | None = None


class DocumentSummaryResponse(BaseModel):
    """Response model for returning a stored document summary."""

    id: str
    filename: str
    summary: str | None = None
    summary_generated_at: datetime | None = None
