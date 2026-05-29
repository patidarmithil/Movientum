"""
Movientum — Watch Router (Phase 3.3)

Endpoints:
  POST   /api/v1/watch                       → [AUTH] mark movie watched
  GET    /api/v1/watch/history               → [AUTH] watch history, paginated
  POST   /api/v1/watch/watchlist             → [AUTH] add to watchlist
  DELETE /api/v1/watch/watchlist/{movie_id}  → [AUTH] remove from watchlist
  GET    /api/v1/watch/watchlist             → [AUTH] get watchlist, paginated
  GET    /api/v1/watch/status/{movie_id}     → [AUTH] {watched, watchlisted}

Cache:
  user:recs:{user_id} invalidated on POST /watch (feeds 3.4 recommendation engine)
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.cache import invalidate
from app.db.database import get_db
from app.schemas.watch import (
    WatchHistoryItem,
    WatchHistoryResponse,
    WatchlistAddRequest,
    WatchlistItem,
    WatchlistResponse,
    WatchMarkRequest,
    WatchStatusResponse,
)
from app.services import watch_service
from app.utils.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


def _recs_key(user_id: str) -> str:
    return f"user:recs:{user_id}"


# ── POST /watch ───────────────────────────────────────────────────

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=WatchHistoryItem,
    summary="Mark movie as watched",
)
async def mark_watched(
    body: WatchMarkRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WatchHistoryItem:
    """
    Idempotent: calling again for the same movie updates watched_at.
    Invalidates user recommendation cache.
    """
    user_id = UUID(current_user["sub"])
    entry = await watch_service.mark_watched(
        db,
        user_id=user_id,
        movie_id=body.movie_id,
        watch_source=body.watch_source,
        rewatched=body.rewatched,
    )
    # Invalidate recommendation cache — new watch data changes affinity
    await invalidate(_recs_key(str(user_id)))
    await invalidate(f"movie:detail:{body.movie_id}")
    await invalidate(f"movie:similar:{body.movie_id}:movie")
    logger.info(
        "WATCH_MARKED",
        extra={"user_id": str(user_id), "movie_id": body.movie_id},
    )
    return WatchHistoryItem(
        id=entry.id,
        movie_id=entry.movie_id,
        user_id=entry.user_id,
        watched_at=entry.watched_at,
        watch_source=entry.watch_source,
        rewatched=entry.rewatched,
    )


# ── DELETE /watch/{movie_id} ──────────────────────────────────────

@router.delete(
    "/{movie_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove movie from watch history",
)
async def remove_from_watch_history(
    movie_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> None:
    user_id = UUID(current_user["sub"])
    await watch_service.remove_from_watch_history(db, user_id=user_id, movie_id=movie_id)
    # Invalidate recommendations
    await invalidate(_recs_key(str(user_id)))
    await invalidate(f"movie:detail:{movie_id}")
    await invalidate(f"movie:similar:{movie_id}:movie")
    logger.info(
        "WATCH_REMOVED",
        extra={"user_id": str(user_id), "movie_id": movie_id},
    )


# ── GET /watch/history ────────────────────────────────────────────

@router.get(
    "/history",
    summary="Get watch history",
)
async def get_watch_history(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    history, total = await watch_service.get_watch_history(db, user_id, page, limit)
    return {
        "items": [
            {
                "id": r.id,
                "movie_id": r.movie_id,
                "movie": {
                    "id": r.movie.id,
                    "title": r.movie.title,
                    "poster_path": r.movie.poster_path,
                    "release_year": r.movie.release_date.year if r.movie.release_date else None,
                    "vote_average": r.movie.vote_average,
                }
            }
            for r in history
        ]
    }


# ── POST /watch/watchlist ─────────────────────────────────────────

@router.post(
    "/watchlist",
    status_code=status.HTTP_201_CREATED,
    response_model=WatchlistItem,
    summary="Add movie to watchlist",
)
async def add_to_watchlist(
    body: WatchlistAddRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WatchlistItem:
    """Idempotent: adding a movie already on watchlist is a no-op."""
    user_id = UUID(current_user["sub"])
    entry = await watch_service.add_to_watchlist(db, user_id=user_id, movie_id=body.movie_id)
    return WatchlistItem(
        id=entry.id,
        movie_id=entry.movie_id,
        user_id=entry.user_id,
        added_at=entry.added_at,
    )


# ── DELETE /watch/watchlist/{movie_id} ───────────────────────────

@router.delete(
    "/watchlist/{movie_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove movie from watchlist",
)
async def remove_from_watchlist(
    movie_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> None:
    user_id = UUID(current_user["sub"])
    await watch_service.remove_from_watchlist(db, user_id=user_id, movie_id=movie_id)


# ── GET /watch/watchlist ──────────────────────────────────────────

@router.get(
    "/watchlist",
    summary="Get watchlist",
)
async def get_watchlist(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    watchlist, total = await watch_service.get_watchlist(db, user_id, page, limit)
    return {
        "items": [
            {
                "id": r.id,
                "movie_id": r.movie_id,
                "movie": {
                    "id": r.movie.id,
                    "title": r.movie.title,
                    "poster_path": r.movie.poster_path,
                    "release_year": r.movie.release_date.year if r.movie.release_date else None,
                    "vote_average": r.movie.vote_average,
                }
            }
            for r in watchlist
        ]
    }


# ── GET /watch/status/{movie_id} ──────────────────────────────────

@router.get(
    "/status/{movie_id}",
    response_model=WatchStatusResponse,
    summary="Get watch + watchlist status for a movie",
)
async def get_watch_status(
    movie_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> WatchStatusResponse:
    user_id = UUID(current_user["sub"])
    status_data = await watch_service.get_watch_status(db, user_id=user_id, movie_id=movie_id)
    return WatchStatusResponse(movie_id=movie_id, **status_data)
