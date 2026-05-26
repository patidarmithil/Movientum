"""
Movientum — FastAPI Application Entry Point

Phase 1 stub: health check only.
Phase 3 will add: all routers (auth, movies, search, ratings, watch, recommendations, news).

Start server:
    cd backend
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Access Swagger UI: http://localhost:8000/docs
"""
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.database import check_db_connection
from app.db.cache import check_redis_connection

logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown hooks) ─────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Called once on startup and once on shutdown."""
    logger.info("Starting Movientum API...")
    logger.info(f"Environment: {settings.app_env}")
    logger.info(f"Debug mode:  {settings.debug}")

    # Verify connections on startup
    db_ok = await check_db_connection()
    redis_ok = await check_redis_connection()

    if db_ok:
        logger.info("✓ Supabase PostgreSQL connected")
    else:
        logger.error("✗ Supabase PostgreSQL connection FAILED")

    if redis_ok:
        logger.info("✓ Upstash Redis connected")
    else:
        logger.error("✗ Upstash Redis connection FAILED")

    yield  # app runs here

    logger.info("Shutting down Movientum API...")


# ── FastAPI App ──────────────────────────────────────────────────
app = FastAPI(
    title="Movientum API",
    description="Movie discovery platform with federated learning recommendations.",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,      # Swagger only in dev
    redoc_url="/redoc" if settings.debug else None,
    lifespan=lifespan,
)

# ── CORS ────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health Check ─────────────────────────────────────────────────
@app.get("/api/health", tags=["System"])
async def health():
    """
    System health check.
    Returns DB + Redis status.
    Returns 503 if either critical dependency is down.
    """
    db_ok = await check_db_connection()
    redis_ok = await check_redis_connection()

    status = "ok" if (db_ok and redis_ok) else "degraded"

    response = {
        "status": status,
        "version": "0.1.0",
        "environment": settings.app_env,
        "dependencies": {
            "database": "ok" if db_ok else "error",
            "cache": "ok" if redis_ok else "error",
        },
    }

    if status != "ok":
        from fastapi import Response
        return Response(
            content=__import__("json").dumps(response),
            status_code=503,
            media_type="application/json",
        )

    return response


# ── Root ─────────────────────────────────────────────────────────
@app.get("/", tags=["System"])
async def root():
    return {
        "message": "Movientum API",
        "docs": "/docs" if settings.debug else "disabled in production",
        "health": "/api/health",
    }


# ── Phase 3: Routers will be added here ──────────────────────────
# from app.routers import auth, movies, search, ratings, watch, recommendations, news
# app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])
# app.include_router(movies.router, prefix="/api/v1/movies", tags=["Movies"])
# app.include_router(search.router, prefix="/api/v1/search", tags=["Search"])
# app.include_router(ratings.router, prefix="/api/v1/ratings", tags=["Ratings"])
# app.include_router(watch.router, prefix="/api/v1/watch", tags=["Watch"])
# app.include_router(recommendations.router, prefix="/api/v1/recommendations", tags=["Recommendations"])
# app.include_router(news.router, prefix="/api/v1/news", tags=["News"])
