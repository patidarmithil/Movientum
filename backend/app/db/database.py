"""
Movientum — Async Database Connection (SQLAlchemy + Supabase)

Runtime connection uses asyncpg driver via ASYNC_DATABASE_URL (port 5432, session pooler).
Alembic migrations use sync psycopg2 via DATABASE_URL (port 6543, transaction pooler).

pool_size=10 → max 10 persistent connections
pool_pre_ping=True → verify connection alive before use (handles Supabase idle timeouts)
"""
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.pool import NullPool
from typing import AsyncGenerator

from app.config import settings


# ── Async Engine ────────────────────────────────────────────────
# Used by FastAPI at runtime for all DB operations
engine = create_async_engine(
    settings.safe_async_db_url,
    pool_size=5,
    max_overflow=2,
    pool_pre_ping=True,          # re-check connection before use
    pool_recycle=1800,           # recycle connections every 30 min
    echo=settings.debug,         # log SQL queries in development
    connect_args={
        "ssl": "require",        # Supabase requires TLS
        "server_settings": {
            "application_name": "movientum_backend",
        },
    },
)

# ── Session Factory ─────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,      # keep ORM objects accessible after commit
    autoflush=True,
    autocommit=False,
)


# ── FastAPI Dependency ──────────────────────────────────────────
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency injected into FastAPI route handlers.
    Yields a DB session, ensures it's closed after request completes.

    Usage in router:
        async def my_route(db: AsyncSession = Depends(get_db)):
            ...
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
            if session.is_active:
                await session.commit()
        except Exception:
            if session.is_active:
                await session.rollback()
            raise
        finally:
            await session.close()


# ── Health Check Helper ─────────────────────────────────────────
async def check_db_connection() -> bool:
    """Ping DB — used in /api/health endpoint."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(__import__("sqlalchemy").text("SELECT 1"))
        return True
    except Exception:
        return False
