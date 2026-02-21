import json
import re
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pdfplumber
from PyPDF2 import PdfReader
from xml.etree import ElementTree

from services.gemini_service import describe_image_context, extract_text_from_image

INDEX_DIR = Path(__file__).resolve().parents[1] / "indexes"
INDEX_DIR.mkdir(parents=True, exist_ok=True)


def _clean_text(value: str) -> str:
    collapsed = re.sub(r"\s+", " ", value or "").strip()
    return collapsed


def _extract_pdf_pages(file_bytes: bytes) -> list[dict[str, str | int]]:
    reader = PdfReader(BytesIO(file_bytes))
    plumber_pages: list[str] = []
    try:
        with pdfplumber.open(BytesIO(file_bytes)) as pdf:
            plumber_pages = [(_clean_text(page.extract_text() or "")) for page in pdf.pages]
    except Exception:
        plumber_pages = []

    pages: list[dict[str, str | int]] = []
    for idx, page in enumerate(reader.pages, start=1):
        text = _clean_text(page.extract_text() or "")
        if not text and idx - 1 < len(plumber_pages):
            text = plumber_pages[idx - 1]
        if text:
            pages.append({"page": idx, "text": text})
    return pages


def _extract_docx_text(file_bytes: bytes) -> str:
    try:
        with ZipFile(BytesIO(file_bytes)) as docx:
            xml_content = docx.read("word/document.xml")
    except Exception:
        return ""

    try:
        root = ElementTree.fromstring(xml_content)
    except Exception:
        return ""

    texts = []
    for node in root.iter():
        if node.tag.endswith("}t") and node.text:
            texts.append(node.text)
    return _clean_text(" ".join(texts))


def _extract_text_file(file_bytes: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return _clean_text(file_bytes.decode(encoding))
        except Exception:
            continue
    return ""


def _build_pages_for_generic_text(text: str) -> list[dict[str, str | int]]:
    if not text:
        return []
    chunks = [text[i : i + 2500] for i in range(0, len(text), 2500)]
    return [{"page": idx + 1, "text": chunk} for idx, chunk in enumerate(chunks) if chunk.strip()]


def build_document_index(document_id: str, file_bytes: bytes, filename: str, mime_type: str) -> int:
    """Extract text from supported file types and persist a simple index."""

    lower_name = (filename or "").lower()
    lower_mime = (mime_type or "").lower()
    pages: list[dict[str, str | int]] = []

    try:
        if lower_name.endswith(".pdf") or "pdf" in lower_mime:
            pages = _extract_pdf_pages(file_bytes)
        elif lower_name.endswith(".docx") or "wordprocessingml" in lower_mime:
            text = _extract_docx_text(file_bytes)
            pages = _build_pages_for_generic_text(text)
        elif lower_mime.startswith("image/") or lower_name.endswith((".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff")):
            extracted = extract_text_from_image(file_bytes, lower_mime)
            if extracted:
                pages = [{"page": 1, "text": _clean_text(extracted)}]
            else:
                described = describe_image_context(file_bytes, lower_mime)
                if described:
                    pages = [{"page": 1, "text": _clean_text(described)}]
                else:
                    pages = [
                        {
                            "page": 1,
                            "text": "Image uploaded successfully. No readable text was detected in this image.",
                        }
                    ]
        elif lower_name.endswith((".txt", ".md", ".csv", ".json", ".py", ".js", ".ts", ".html", ".css", ".xml", ".yaml", ".yml", ".log")):
            text = _extract_text_file(file_bytes)
            pages = _build_pages_for_generic_text(text)
        else:
            text = _extract_text_file(file_bytes)
            pages = _build_pages_for_generic_text(text)
    except Exception as e:
        print(f"ERROR building index: {e}")
        pages = []

    payload = {"document_id": document_id, "filename": filename, "mime_type": mime_type, "pages": pages}
    (INDEX_DIR / f"{document_id}.json").write_text(json.dumps(payload, ensure_ascii=True), encoding="utf-8")
    return len(pages)


def load_document_index(document_id: str) -> list[dict[str, str | int]]:
    index_path = INDEX_DIR / f"{document_id}.json"
    if not index_path.exists():
        return []

    data = json.loads(index_path.read_text(encoding="utf-8"))
    pages = data.get("pages")
    return pages if isinstance(pages, list) else []


def delete_document_index(document_id: str) -> None:
    index_path = INDEX_DIR / f"{document_id}.json"
    if index_path.exists():
        index_path.unlink()
