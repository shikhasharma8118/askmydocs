import json
import os

import firebase_admin
from fastapi import HTTPException, status
from firebase_admin import auth, credentials

from config import settings


def _get_firebase_app():
    """Initialize Firebase Admin app once and reuse it."""

    try:
        return firebase_admin.get_app()
    except ValueError:
        # Try JSON env variable first (for production/Render)
        service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        if service_account_json:
            service_account_dict = json.loads(service_account_json)
            cred = credentials.Certificate(service_account_dict)
        else:
            # Fall back to file path (for local development)
            cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        return firebase_admin.initialize_app(cred)


def verify_firebase_token(firebase_token: str) -> dict:
    """Verify Firebase ID token and return decoded payload."""

    token = (firebase_token or "").strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase token is required.",
        )

    try:
        app = _get_firebase_app()
        decoded = auth.verify_id_token(token, app=app)
        if not isinstance(decoded, dict):
            raise ValueError("Invalid token payload")
        return decoded
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Firebase token.",
        ) from exc
