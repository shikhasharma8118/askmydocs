import re
from typing import Any

from google import genai
from google.genai import types

from config import settings

_CLIENT = None
_MODEL_NAME = "gemini-3-flash-preview"
_MAX_SUMMARY_CHARS = 18000
_MAX_ANSWER_CONTEXT_CHARS = 9000


def _get_client():
    global _CLIENT
    if _CLIENT is not None:
        return _CLIENT

    if not settings.GEMINI_API_KEY:
        return None

    _CLIENT = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _CLIENT


def _extract_response_text(response: Any) -> str | None:
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    candidates = getattr(response, "candidates", None)
    if not candidates:
        return None

    parts: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        if content is None:
            continue
        for part in getattr(content, "parts", []) or []:
            value = getattr(part, "text", None)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())

    if not parts:
        return None
    return "\n".join(parts).strip()


def _limit_text_chunks(chunks: list[str], max_chars: int) -> str:
    if not chunks:
        return ""

    cleaned = [chunk.strip() for chunk in chunks if isinstance(chunk, str) and chunk.strip()]
    if not cleaned:
        return ""

    selected: list[str] = []
    current = 0
    for chunk in cleaned:
        if current >= max_chars:
            break
        remaining = max_chars - current
        piece = chunk[:remaining].strip()
        if not piece:
            continue
        selected.append(piece)
        current += len(piece) + 1

    return "\n".join(selected).strip()


def _heuristic_document_summary(text_chunks: list[str], document_filename: str) -> str | None:
    joined = _limit_text_chunks(text_chunks, 12000)
    if not joined:
        return None

    normalized = re.sub(r"\s+", " ", joined).strip()
    if not normalized:
        return None

    def _extract_value(label: str, max_len: int = 180) -> str | None:
        pattern = rf"{re.escape(label)}\s*[:\-]\s*(.+?)(?=\s+[A-Z][A-Za-z ]{{2,30}}\s*[:\-]|\s+\d+\.\s+[A-Z]|$)"
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if not match:
            return None
        value = re.sub(r"\s+", " ", match.group(1)).strip(" .,-;:")
        if not value:
            return None
        return value[:max_len]

    heading_matches = re.findall(r"(?:^|\s)(\d{1,2}\.\s+[A-Z][^.]{4,80})", normalized)
    headings = [re.sub(r"\s+", " ", h).strip(" .") for h in heading_matches][:5]

    objective = _extract_value("Objective", 240)
    deadline = _extract_value("Deadline", 120)
    deliverables = _extract_value("Deliverables", 180)
    tech_stack = _extract_value("Tech Stack", 200)
    task_type = _extract_value("Task Type", 120)

    first_sentence = re.split(r"(?<=[.!?])\s+", normalized)[0].strip()
    first_sentence = first_sentence[:180] if first_sentence else ""

    topic_from_name = re.sub(r"[_\-]+", " ", (document_filename or "")).strip()
    topic_from_name = re.sub(r"\.[A-Za-z0-9]+$", "", topic_from_name).strip()
    main_topic = objective or headings[0] if headings else first_sentence
    if not main_topic:
        main_topic = topic_from_name or "Document summary"
    if topic_from_name and topic_from_name.lower() not in (main_topic or "").lower():
        main_topic = f"{topic_from_name}: {main_topic}"

    key_points: list[str] = []
    if task_type:
        key_points.append(f"Task Type: {task_type}")
    if tech_stack:
        key_points.append(f"Tech Stack: {tech_stack}")
    for heading in headings:
        if heading not in key_points:
            key_points.append(heading)
        if len(key_points) >= 5:
            break

    if not key_points:
        fragments = re.split(r"\s+(?=[A-Z][a-z]+\s)", normalized)
        for fragment in fragments:
            cleaned = fragment.strip(" .,-;:")
            if len(cleaned) < 30:
                continue
            key_points.append(cleaned[:180])
            if len(key_points) >= 4:
                break

    details: list[str] = []
    if deadline:
        details.append(f"Deadline: {deadline}")
    if deliverables:
        details.append(f"Deliverables: {deliverables}")
    if objective:
        details.append(f"Objective: {objective}")
    if not details:
        details.append("Structured AI summary was unavailable; this summary was generated from extracted text.")

    key_points_text = "\n".join(f"- {point}" for point in key_points[:5])
    details_text = "\n".join(f"- {point}" for point in details[:4])
    return (
        "Main Topic:\n"
        f"{main_topic}\n\n"
        "Key Points:\n"
        f"{key_points_text}\n\n"
        "Important Details:\n"
        f"{details_text}"
    )


def generate_answer_with_gemini(
    question: str,
    sources: list[dict[str, Any]],
    document_name: str | None = None,
) -> str | None:
    """Generate an answer using Gemini from selected document snippets."""

    if not sources:
        return None

    client = _get_client()
    if client is None:
        return None

    context_lines = []
    current_chars = 0
    for source in sources:
        page = source.get("page")
        snippet = str(source.get("snippet", "")).strip()
        if snippet:
            line = f"[Page {page}] {snippet}"
            if current_chars + len(line) > _MAX_ANSWER_CONTEXT_CHARS:
                break
            context_lines.append(line)
            current_chars += len(line) + 1

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
        response = client.models.generate_content(model=_MODEL_NAME, contents=prompt)
    except Exception:
        return None

    return _extract_response_text(response)


def generate_document_summary(
    text_chunks: list[str], document_filename: str
) -> str | None:
    """Generate a structured summary for a document from extracted text chunks."""

    if not text_chunks:
        return None

    client = _get_client()
    if client is None:
        return _heuristic_document_summary(text_chunks, document_filename)

    cleaned_chunks = [chunk.strip() for chunk in text_chunks if isinstance(chunk, str) and chunk.strip()]
    if not cleaned_chunks:
        return None

    limited_text = _limit_text_chunks(cleaned_chunks, _MAX_SUMMARY_CHARS)
    if not limited_text:
        return None

    document_label = document_filename or "the document"
    prompt = (
        f"Summarize the document '{document_label}' in a clear, structured format.\n"
        "Use these exact section headings:\n"
        "Main Topic:\n"
        "Key Points:\n"
        "Important Details:\n\n"
        "Requirements:\n"
        "1) Keep the summary concise and easy to scan.\n"
        "2) Use bullet points for Key Points and Important Details.\n"
        "3) Focus only on information present in the provided document text.\n"
        "4) If content is unclear or incomplete, briefly note that in Important Details.\n\n"
        "Document Text:\n"
        f"{limited_text}"
    )

    try:
        response = client.models.generate_content(model=_MODEL_NAME, contents=prompt)
    except Exception:
        return _heuristic_document_summary(text_chunks, document_filename)

    return _extract_response_text(response) or _heuristic_document_summary(text_chunks, document_filename)


def extract_text_from_image(file_bytes: bytes, mime_type: str) -> str | None:
    """Use Gemini to OCR/extract text from an image file."""

    client = _get_client()
    if client is None:
        return None

    prompt = (
        "Extract all readable text from this image. "
        "Return only extracted text with line breaks where natural."
    )

    try:
        response = client.models.generate_content(
            model=_MODEL_NAME,
            contents=[
                prompt,
                types.Part.from_bytes(
                    data=file_bytes,
                    mime_type=mime_type or "image/png",
                ),
            ],
        )
    except Exception:
        return None

    return _extract_response_text(response)


def describe_image_context(file_bytes: bytes, mime_type: str) -> str | None:
    """Generate a brief factual description of image contents when OCR text is limited."""

    client = _get_client()
    if client is None:
        return None

    prompt = (
        "Describe the important visual content in this image in concise factual text "
        "so it can be used for question answering."
    )

    try:
        response = client.models.generate_content(
            model=_MODEL_NAME,
            contents=[
                prompt,
                types.Part.from_bytes(
                    data=file_bytes,
                    mime_type=mime_type or "image/png",
                ),
            ],
        )
    except Exception:
        return None

    return _extract_response_text(response)
