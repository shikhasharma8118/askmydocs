from typing import Any

import google.generativeai as genai

from config import settings

_MODEL = None
_MODEL_NAME = "gemini-1.5-flash"


def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    if not settings.GEMINI_API_KEY:
        return None

    genai.configure(api_key=settings.GEMINI_API_KEY)
    _MODEL = genai.GenerativeModel(_MODEL_NAME)
    return _MODEL


def generate_answer_with_gemini(
    question: str,
    sources: list[dict[str, Any]],
    document_name: str | None = None,
) -> str | None:
    """Generate an answer using Gemini from selected document snippets."""

    if not sources:
        return None

    model = _get_model()
    if model is None:
        return None

    context_lines = []
    for source in sources:
        page = source.get("page")
        snippet = str(source.get("snippet", "")).strip()
        if snippet:
            context_lines.append(f"[Page {page}] {snippet}")

    if not context_lines:
        return None

    document_label = document_name or "the selected PDF"
    prompt = (
        f"You are answering questions from {document_label}.\n"
        "Rules:\n"
        "1) Use only the provided context.\n"
        "2) Summarize clearly in plain language.\n"
        "3) Do not include page numbers or citations in the answer text.\n"
        "4) If context is insufficient, say that briefly and state what is missing.\n\n"
        f"Question: {question}\n\n"
        "Context:\n"
        f"{chr(10).join(context_lines)}"
    )

    try:
        response = model.generate_content(prompt, request_options={"timeout": 20})
    except Exception:
        return None

    text = getattr(response, "text", None)
    if not isinstance(text, str):
        return None

    cleaned = text.strip()
    return cleaned if cleaned else None


def extract_text_from_image(file_bytes: bytes, mime_type: str) -> str | None:
    """Use Gemini to OCR/extract text from an image file."""

    model = _get_model()
    if model is None:
        return None

    prompt = (
        "Extract all readable text from this image. "
        "Return only extracted text with line breaks where natural."
    )

    try:
        response = model.generate_content(
            [
                prompt,
                {"mime_type": mime_type or "image/png", "data": file_bytes},
            ],
            request_options={"timeout": 30},
        )
    except Exception:
        return None

    text = getattr(response, "text", None)
    if not isinstance(text, str):
        return None

    cleaned = text.strip()
    return cleaned if cleaned else None


def describe_image_context(file_bytes: bytes, mime_type: str) -> str | None:
    """Generate a brief factual description of image contents when OCR text is limited."""

    model = _get_model()
    if model is None:
        return None

    prompt = (
        "Describe the important visual content in this image in concise factual text "
        "so it can be used for question answering."
    )

    try:
        response = model.generate_content(
            [
                prompt,
                {"mime_type": mime_type or "image/png", "data": file_bytes},
            ],
            request_options={"timeout": 30},
        )
    except Exception:
        return None

    text = getattr(response, "text", None)
    if not isinstance(text, str):
        return None

    cleaned = text.strip()
    return cleaned if cleaned else None
