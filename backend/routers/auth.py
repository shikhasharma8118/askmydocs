from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from middleware.auth_middleware import get_current_user
from models.database import User, get_db
from models.schemas import AuthResponse, FirebaseTokenRequest, UserResponse
from services.firebase_auth import verify_firebase_token
from services.jwt_handler import create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


def _extract_firebase_identity(firebase_token: str) -> tuple[str, str, str]:
    """Verify Firebase token and return uid, email, and display name fallback."""

    firebase_payload = verify_firebase_token(firebase_token)
    firebase_uid = firebase_payload.get("uid")
    email = firebase_payload.get("email")
    display_name = firebase_payload.get("name")

    if not firebase_uid or not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid Firebase token payload",
        )

    fallback_name = email.split("@")[0]
    return firebase_uid, email, display_name or fallback_name


@router.post("/signup", response_model=AuthResponse)
def signup_with_firebase(
    request: FirebaseTokenRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    """Create a new user from Firebase identity and return an app JWT."""

    firebase_uid, email, display_name = _extract_firebase_identity(request.firebase_token)

    existing_user = (
        db.query(User)
        .filter((User.firebase_uid == firebase_uid) | (User.email == email))
        .first()
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already exists. Please login.",
        )

    user = User(
        email=email,
        display_name=display_name,
        firebase_uid=firebase_uid,
    )
    db.add(user)

    try:
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist user",
        ) from exc

    access_token = create_access_token(user_id=str(user.id), email=user.email)
    return AuthResponse(access_token=access_token, user=UserResponse.model_validate(user))


@router.post("/login/google", response_model=AuthResponse)
def login_with_google(
    request: FirebaseTokenRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    """Authenticate an existing user with Firebase identity and return an app JWT."""

    firebase_uid, email, display_name = _extract_firebase_identity(request.firebase_token)

    user = db.query(User).filter(User.firebase_uid == firebase_uid).first()
    if user is None:
        user = db.query(User).filter(User.email == email).first()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found. Please sign up first.",
        )

    if user.firebase_uid != firebase_uid:
        user.firebase_uid = firebase_uid
    if display_name and user.display_name != display_name:
        user.display_name = display_name

    try:
        db.commit()
        db.refresh(user)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update user",
        ) from exc

    access_token = create_access_token(user_id=str(user.id), email=user.email)
    return AuthResponse(access_token=access_token, user=UserResponse.model_validate(user))


@router.post("/firebase", response_model=AuthResponse)
def authenticate_with_firebase(
    request: FirebaseTokenRequest,
    db: Session = Depends(get_db),
) -> AuthResponse:
    """Backwards-compatible endpoint that maps to login behavior."""

    return login_with_google(request=request, db=db)


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the currently authenticated user."""

    return UserResponse.model_validate(current_user)
