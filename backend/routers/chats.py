import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from middleware.auth_middleware import get_current_user
from models.database import Document, User, get_db
from models.schemas import AnswerResponse, QuestionRequest
from services.document_index import build_document_index, load_document_index
from services.document_qa import answer_question_from_index

router = APIRouter(prefix="/chats", tags=["chats"])


def _load_document_bytes(document_url: str) -> bytes:
    if document_url.startswith("/uploads/"):
        filename = document_url.split("/uploads/", 1)[1]
        local_path = Path(__file__).resolve().parents[1] / "uploads" / filename
        if not local_path.exists():
            return b""
        return local_path.read_bytes()

    try:
        with urlopen(document_url, timeout=20) as response:
            return response.read()
    except URLError:
        return b""


@router.post("/ask", response_model=AnswerResponse)
def ask_document_question(
    request: QuestionRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AnswerResponse:
    """Answer a question using indexed pages from the selected document."""

    if not request.document_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="document_id is required.",
        )

    try:
        document_uuid = uuid.UUID(request.document_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid document id.",
        ) from exc

    document = (
        db.query(Document)
        .filter(Document.id == document_uuid, Document.user_id == current_user.id)
        .first()
    )
    if document is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found.",
        )

    indexed_pages = load_document_index(str(document.id))
    if not indexed_pages:
        file_bytes = _load_document_bytes(document.supabase_url)
        if file_bytes:
            try:
                page_count = build_document_index(
                    str(document.id),
                    file_bytes,
                    document.filename,
                    document.mime_type or "application/octet-stream",
                )
                document.status = "indexed" if page_count > 0 else "error"
                db.commit()
            except Exception:
                document.status = "error"
                db.commit()

    answer, sources = answer_question_from_index(
        request.question,
        str(document.id),
        document_name=document.filename,
    )
    return AnswerResponse(answer=answer, sources=sources)
