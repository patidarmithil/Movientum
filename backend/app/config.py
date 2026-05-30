"""
Movientum — Configuration System
Reads all environment variables from .env using pydantic-settings.
Single source of truth for all config. Never use os.getenv() elsewhere.
"""
from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    # ── TMDB ──────────────────────────────────────────────────────
    tmdb_api_key: str
    tmdb_read_access_token: str
    tmdb_base_url: str = "https://api.themoviedb.org/3"
    tmdb_image_base_url: str = "https://image.tmdb.org/t/p"

    # ── Database (Supabase PostgreSQL) ─────────────────────────────
    database_url: str           # sync (psycopg2) — Alembic migrations only
    database_pool_url: str      # sync pooler URL  — reference
    async_database_url: str     # asyncpg — FastAPI runtime
    db_password: str

    # ── Redis (Upstash) ────────────────────────────────────────────
    redis_url: str

    # ── JWT ────────────────────────────────────────────────────────
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # ── App ────────────────────────────────────────────────────────
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    debug: bool = False

    # ── CORS ───────────────────────────────────────────────────────
    allowed_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,https://movientum.vercel.app"

    # ── Celery ─────────────────────────────────────────────────────
    celery_broker_url: str = ""
    celery_result_backend: str = ""

    @field_validator("celery_broker_url", mode="before")
    @classmethod
    def default_celery_broker(cls, v, info):
        # Default to redis_url if celery_broker_url not explicitly set
        if not v:
            return info.data.get("redis_url", "")
        return v

    @field_validator("celery_result_backend", mode="before")
    @classmethod
    def default_celery_backend(cls, v, info):
        if not v:
            return info.data.get("redis_url", "")
        return v

    @property
    def allowed_origins_list(self) -> list[str]:
        """Parse comma-separated ALLOWED_ORIGINS into list."""
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def is_development(self) -> bool:
        return self.app_env == "development"

    @property
    def tmdb_headers(self) -> dict:
        """Auth headers for TMDB API requests."""
        return {
            "Authorization": f"Bearer {self.tmdb_read_access_token}",
            "Content-Type": "application/json",
        }

    @property
    def safe_async_db_url(self) -> str:
        """
        ASYNC_DATABASE_URL with password URL-encoded.
        Handles special chars (e.g. ## in MPmovientum77##) that break asyncpg URL parsing.
        """
        from urllib.parse import quote_plus
        encoded = quote_plus(self.db_password)
        return self.async_database_url.replace(self.db_password, encoded)

    @property
    def safe_sync_db_url(self) -> str:
        """
        DATABASE_URL (sync/psycopg2) with password URL-encoded.
        Used by Alembic.
        """
        from urllib.parse import quote_plus
        encoded = quote_plus(self.db_password)
        return self.database_url.replace(self.db_password, encoded)

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    """Cached settings — loaded once, reused everywhere."""
    return Settings()


# Module-level singleton — import this throughout the app
settings = get_settings()
