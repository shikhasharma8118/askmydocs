from fastapi import HTTPException, status
import firebase_admin
from firebase_admin import auth, credentials

from config import settings


def _get_firebase_app():
    """Initialize Firebase Admin app once and reuse it."""

    try:
        return firebase_admin.get_app()
    except ValueError:
        cred = credentials.Certificate(settings.FIREBASE_SERVICE_ACCOUNT_PATH)
        return firebase_admin.initialize_app(cred)


def verify_firebase_token(id_token: str) -> dict:
    if not isinstance(id_token, str) or not id_token.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase token is missing",
        )

    app = _get_firebase_app()

    try:
        decoded_token = auth.verify_id_token(
            id_token,
            app=app,
            check_revoked=False,
            clock_skew_seconds=60,
        )
        return {
            "uid": decoded_token.get("uid"),
            "email": decoded_token.get("email"),
            "name": decoded_token.get("name"),
        }
    except auth.ExpiredIdTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase token has expired",
        ) from exc
    except auth.RevokedIdTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Firebase token has been revoked",
        ) from exc
    except auth.InvalidIdTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Firebase token: {exc}",
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {exc}",
        ) from exc
