"""
Configuration management using Pydantic Settings.
Loads and validates all environment variables from .env file.
"""

from dotenv import load_dotenv
from pydantic_settings import BaseSettings

# Load environment variables from .env file
load_dotenv()


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    GEMINI_API_KEY: str | None = None
    FIREBASE_SERVICE_ACCOUNT_PATH: str
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_BUCKET: str = "documents"
    DATABASE_URL: str
    DB_INIT_ON_STARTUP: bool = True
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_SECONDS: int = 3600

    model_config = {
        "env_file": ".env",
        "case_sensitive": True,
        "extra": "ignore",
    }


# Global settings instance
settings = Settings()
