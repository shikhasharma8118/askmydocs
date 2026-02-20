import uuid

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from models.database import User, get_db
from services.jwt_handler import verify_token

security = HTTPBearer()


def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> str:
    token = credentials.credentials
    payload = verify_token(token)
    user_id = payload.get("sub")

    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid token structure")

    return user_id


def get_current_user(
    user_id: str = Depends(get_current_user_id),
    db: Session = Depends(get_db),
) -> User:
    try:
        user_uuid = uuid.UUID(user_id)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid token structure") from exc

    user = db.query(User).filter(User.id == user_uuid).first()

    if user is None:
        raise HTTPException(status_code=404, detail="User not found")

    return user
