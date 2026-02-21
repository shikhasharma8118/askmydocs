from datetime import datetime, timedelta

from fastapi import HTTPException
from jose import JWTError, jwt

from config import settings


def create_access_token(user_id: str, email: str) -> str:
    expiration = datetime.utcnow() + timedelta(seconds=settings.JWT_EXPIRATION_SECONDS)
    payload = {
        "sub": user_id,
        "email": email,
        "exp": expiration,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, settings.JWT_SECRET, settings.JWT_ALGORITHM)


def verify_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
        return payload
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="Could not validate token") from exc
