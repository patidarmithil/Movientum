"""
Movientum — FastAPI Application Entry Point

Phase 2B: movies router added (list, trending, detail).
Phase 3.1: auth router added (register, login, refresh, logout, me).
Phase 3 will add: auth, search, ratings, watch, recommendations, news.

Start server:
    cd backend
    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

Access Swagger UI: http://localhost:8000/docs
"""
from contextlib import asynccontextmanager
import http
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import settings
from app.db.database import check_db_connection
from app.db.cache import check_redis_connection

logger = logging.getLogger(__name__)


# ── Lifespan (startup / shutdown hooks) ─────────────────────────
async def cleanup_old_movies():
    """Delete unpopular, unreferenced movies older than 30 days to control database size."""
    import asyncio
    from app.db.database import AsyncSessionLocal
    from sqlalchemy import text
    try:
        await asyncio.sleep(2)
        async with AsyncSessionLocal() as db:
            query = """
            DELETE FROM movies
            WHERE popularity < 5.0
              AND id NOT IN (
                SELECT DISTINCT movie_id FROM ratings
                UNION
                SELECT DISTINCT movie_id FROM watch_history
                UNION
                SELECT DISTINCT movie_id FROM watchlist
              )
              AND fetched_at < NOW() - INTERVAL '30 days';
            """
            result = await db.execute(text(query))
            await db.commit()
            logger.info(f"Scheduled cleanup: deleted {result.rowcount} unpopular/unreferenced movies.")
    except Exception as e:
        logger.warning(f"Failed to run movie table cleanup: {e}")


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
        import asyncio
        asyncio.create_task(cleanup_old_movies())
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


# ── Global Exception Handlers ────────────────────────────────────
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    try:
        error_name = http.HTTPStatus(exc.status_code).phrase
    except ValueError:
        error_name = "Error"
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": error_name,
            "message": exc.detail,
            "status_code": exc.status_code,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    msg_parts = []
    for err in errors:
        loc = " -> ".join(str(x) for x in err.get("loc", []))
        msg = err.get("msg", "Validation error")
        msg_parts.append(f"{loc}: {msg}")
    message = "; ".join(msg_parts) if msg_parts else "Validation error"
    return JSONResponse(
        status_code=422,
        content={
            "error": "Unprocessable Entity",
            "message": message,
            "status_code": 422,
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled application error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal Server Error",
            "message": "An unexpected error occurred.",
            "status_code": 500,
        },
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


# ── Phase 2B: Movies Router ──────────────────────────────────────
from app.routers import movies
app.include_router(movies.router, prefix="/api/v1/movies", tags=["Movies"])

# ── Phase 3.1: Auth Router ────────────────────────────────────────
from app.routers import auth
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Auth"])

# ── Phase 3.2: Search Router ──────────────────────────────────────
from app.routers import search
app.include_router(search.router, prefix="/api/v1/search", tags=["Search"])

# ── Phase 3.3: Ratings Router ────────────────────────────────────
from app.routers import ratings
app.include_router(ratings.router, prefix="/api/v1/ratings", tags=["Ratings"])

# ── Phase 3.3: Watch Router ───────────────────────────────────────
from app.routers import watch
app.include_router(watch.router, prefix="/api/v1/watch", tags=["Watch"])

# ── Phase 3.4: Recommendations Router ────────────────────────────
from app.routers import recommendations
app.include_router(recommendations.router, prefix="/api/v1/recommendations", tags=["Recommendations"])

# ── Improvement 1.4: Person Router ───────────────────────────────
from app.routers import person
app.include_router(person.router, prefix="/api/v1/person", tags=["Person"])

# ── Improvement 1.7: TV Shows Router ─────────────────────────────
from app.routers import tv
app.include_router(tv.router, prefix="/api/v1/tv", tags=["TV"])

# ── Phase 3.4+ (not yet implemented) ─────────────────────────────
# from app.routers import news
# app.include_router(news.router, prefix="/api/v1/news", tags=["News"])
