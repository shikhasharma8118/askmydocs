import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from middleware.auth_middleware import get_current_user
from models.database import Document, User, get_db
from models.schemas import DocumentPreviewResponse, DocumentResponse, DocumentSummaryResponse
from services.document_index import build_document_index, delete_document_index, load_document_index
from services.gemini_service import generate_document_summary
from services.storage import upload_file_to_storage

router = APIRouter(prefix="/documents", tags=["documents"])


def _basic_summary_from_chunks(text_chunks: list[str], filename: str) -> str | None:
    cleaned = [chunk.strip() for chunk in text_chunks if isinstance(chunk, str) and chunk.strip()]
    if not cleaned:
        return None

    preview = " ".join(cleaned)[:1600].strip()
    if not preview:
        return None

    return (
        f"Main Topic:\n{filename or 'Document'}\n\n"
        "Key Points:\n"
        f"- {preview}\n\n"
        "Important Details:\n"
        "- This summary was generated from extracted text because AI summary was unavailable."
    )


def _resolve_preview_type(mime_type: str, filename: str) -> str:
    lower_mime = (mime_type or "").lower()
    lower_name = (filename or "").lower()
    if lower_mime.startswith("image/") or lower_name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff")):
        return "image"
    if lower_mime == "application/pdf" or lower_name.endswith(".pdf"):
        return "pdf"
    if lower_name.endswith(".docx") or "wordprocessingml.document" in lower_mime:
        return "docx"
    if lower_mime.startswith("text/") or lower_name.endswith(
        (".txt", ".md", ".csv", ".json", ".py", ".js", ".ts", ".html", ".css", ".xml", ".yaml", ".yml", ".log")
    ):
        return "text"
    return "unsupported"


@router.post("/upload", response_model=DocumentResponse)
def upload_document(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentResponse:
    """Upload a document for the authenticated user."""

    filename = file.filename or ""

    file_bytes = file.file.read()
    if not file_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    try:
        mime_type = (file.content_type or "application/octet-stream").strip()
        document_url = upload_file_to_storage(file_bytes, filename, str(current_user.id), mime_type)
        document = Document(
            user_id=current_user.id,
            filename=filename,
            mime_type=mime_type,
            supabase_url=document_url,
            file_size_bytes=len(file_bytes),
            status="processing",
        )
        db.add(document)
        db.flush()

        indexed_pages = build_document_index(str(document.id), file_bytes, filename, mime_type)
        document.status = "indexed" if indexed_pages > 0 else "error"
        if indexed_pages > 0:
            pages = load_document_index(str(document.id))
            text_chunks = [str(page.get("text", "")).strip() for page in pages if str(page.get("text", "")).strip()]
            summary = generate_document_summary(text_chunks, filename)
            document.summary = summary or _basic_summary_from_chunks(text_chunks, filename)
            if document.summary:
                document.summary_generated_at = datetime.utcnow()

        db.commit()
        db.refresh(document)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save document metadata.",
        ) from exc
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to index document: {exc}",
        ) from exc
    finally:
        file.file.close()

    return DocumentResponse.model_validate(document)


@router.get("/{document_id}/preview", response_model=DocumentPreviewResponse)
def preview_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentPreviewResponse:
    """Return preview content for a selected document."""

    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document id.",
        ) from exc

    document = (
        db.query(Document)
        .filter(Document.id == doc_uuid, Document.user_id == current_user.id)
        .first()
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    preview_type = _resolve_preview_type(document.mime_type, document.filename)
    content = None
    if preview_type == "text":
        pages = load_document_index(str(document.id))
        snippets = [str(page.get("text", "")) for page in pages[:8] if str(page.get("text", "")).strip()]
        content = "\n\n".join(snippets)[:12000] if snippets else None

    return DocumentPreviewResponse(
        id=str(document.id),
        filename=document.filename,
        mime_type=document.mime_type or "application/octet-stream",
        preview_type=preview_type,
        content=content,
        file_url=document.supabase_url,
    )


@router.get("/{document_id}/summary", response_model=DocumentSummaryResponse)
def get_document_summary(
    document_id: str,
    refresh: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DocumentSummaryResponse:
    """Return the stored summary for a selected document."""

    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document id.",
        ) from exc

    document = (
        db.query(Document)
        .filter(Document.id == doc_uuid, Document.user_id == current_user.id)
        .first()
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    stale_fallback = "This summary was generated from extracted text because AI summary was unavailable."
    needs_refresh = refresh or not document.summary or stale_fallback in str(document.summary or "")

    if needs_refresh:
        pages = load_document_index(str(document.id))
        text_chunks = [str(page.get("text", "")).strip() for page in pages if str(page.get("text", "")).strip()]
        if text_chunks:
            summary = generate_document_summary(text_chunks, document.filename)
            document.summary = summary or _basic_summary_from_chunks(text_chunks, document.filename)
            if document.summary:
                document.summary_generated_at = datetime.utcnow()
                db.commit()
                db.refresh(document)

    return DocumentSummaryResponse(
        id=str(document.id),
        filename=document.filename,
        summary=document.summary,
        summary_generated_at=document.summary_generated_at,
    )


@router.get("/recent", response_model=list[DocumentResponse])
def list_recent_documents(
    limit: int = 12,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DocumentResponse]:
    """Return the authenticated user's most recently uploaded documents."""

    safe_limit = min(max(limit, 1), 50)
    documents = (
        db.query(Document)
        .filter(Document.user_id == current_user.id)
        .order_by(Document.uploaded_at.desc())
        .limit(safe_limit)
        .all()
    )
    return [DocumentResponse.model_validate(document) for document in documents]


@router.get("", response_model=list[DocumentResponse])
def list_documents(
    search: str | None = None,
    status_filter: str | None = None,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[DocumentResponse]:
    """Return the authenticated user's documents with optional filters."""

    safe_limit = min(max(limit, 1), 200)
    query = db.query(Document).filter(Document.user_id == current_user.id)

    if search:
        query = query.filter(Document.filename.ilike(f"%{search.strip()}%"))
    if status_filter:
        query = query.filter(Document.status == status_filter.strip().lower())

    documents = query.order_by(Document.uploaded_at.desc()).limit(safe_limit).all()
    return [DocumentResponse.model_validate(document) for document in documents]


@router.delete("/{document_id}")
def delete_document(
    document_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    """Delete an uploaded document record for the authenticated user."""

    try:
        doc_uuid = uuid.UUID(document_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document id.",
        ) from exc

    document = (
        db.query(Document)
        .filter(Document.id == doc_uuid, Document.user_id == current_user.id)
        .first()
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    try:
        delete_document_index(str(document.id))
        db.delete(document)
        db.commit()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete document.",
        ) from exc

    return {"status": "deleted"}
