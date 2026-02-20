import re
import uuid
from pathlib import Path

from supabase import create_client

from config import settings

UPLOADS_DIR = Path(__file__).resolve().parents[1] / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_filename(filename: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", filename).strip("._")
    return cleaned or "document.bin"


def upload_file_to_storage(file_bytes: bytes, filename: str, user_id: str, mime_type: str) -> str:
    """Upload a file to Supabase Storage and fallback to local storage if needed."""

    safe_filename = _sanitize_filename(filename)
    unique_name = f"{uuid.uuid4()}-{safe_filename}"

    try:
        client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
        storage_path = f"{user_id}/{unique_name}"
        client.storage.from_(settings.SUPABASE_BUCKET).upload(
            storage_path,
            file_bytes,
            {"content-type": mime_type or "application/octet-stream", "upsert": "false"},
        )
        return client.storage.from_(settings.SUPABASE_BUCKET).get_public_url(storage_path)
    except Exception:
        local_name = f"{user_id}-{unique_name}"
        local_path = UPLOADS_DIR / local_name
        local_path.write_bytes(file_bytes)
        return f"/uploads/{local_name}"
