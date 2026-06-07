"""
Movientum — News Router

Endpoints:
  GET /api/v1/news/feed/for-you       → [AUTH] Personalized scored feed from Redis
  POST /api/v1/news/fetch/global      → Trigger global news fetch manually
"""
import logging
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.services import news_service
from app.utils.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

# ── GET /feed/latest ─────────────────────────────────────────────

@router.get(
    "/feed/latest",
    summary="Latest global news",
    description="Unpersonalized feed for non-logged-in users. Sorted by published_at.",
)
async def get_latest_feed(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
) -> dict:
    return await news_service.get_latest_feed(page=page, page_size=page_size)


# ── GET /feed/for-you ────────────────────────────────────────────

@router.get(
    "/feed/for-you",
    summary="Personalized news feed",
    description="Requires auth. Articles scored by user genre preferences and watch history (served from Redis).",
)
async def get_personalized_feed(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    from uuid import UUID as _UUID
    from sqlalchemy import select
    from app.db.orm_models import UserGenrePreference, WatchHistory, Genre, Movie, MovieDirector, Director

    user_id = _UUID(current_user["sub"])

    # Fetch user's top genre tags
    genre_rows = await db.execute(
        select(Genre.name)
        .join(UserGenrePreference, UserGenrePreference.genre_id == Genre.id)
        .where(UserGenrePreference.user_id == user_id)
        .order_by(UserGenrePreference.weight.desc())
        .limit(10)
    )
    user_genre_tags = [r[0].lower() for r in genre_rows.all()]

    # Watched movie IDs
    watch_rows = await db.execute(
        select(WatchHistory.movie_id)
        .where(WatchHistory.user_id == user_id)
        .limit(200)
    )
    watched_movie_ids = [r[0] for r in watch_rows.all()]

    watched_movie_titles = []
    director_names = []

    if watched_movie_ids:
        # Titles of watched movies (for keyword matching)
        title_rows = await db.execute(
            select(Movie.title).where(Movie.id.in_(watched_movie_ids))
        )
        watched_movie_titles = [r[0] for r in title_rows.all()]

        # Director names from watched movies
        director_rows = await db.execute(
            select(Director.name)
            .join(MovieDirector, MovieDirector.director_id == Director.id)
            .where(MovieDirector.movie_id.in_(watched_movie_ids))
            .limit(50)
        )
        director_names = [r[0] for r in director_rows.all()]

    return await news_service.get_personalized_feed(
        user_genre_tags=user_genre_tags,
        watched_movie_titles=watched_movie_titles,
        director_names=director_names,
        page=page,
        page_size=page_size,
    )


# ── POST /fetch/global ───────────────────────────────────────────

@router.post(
    "/fetch/global",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Trigger global news fetch",
    description="Manually trigger a NewsAPI fetch. (Usually run by Celery)",
)
async def trigger_global_fetch() -> dict:
    result = await news_service.fetch_global_news()
    return result


# ── POST /article/{article_id}/view ─────────────────────────────
# Keep endpoint so frontend doesn't break, but it's a no-op

@router.post(
    "/article/{article_id}/view",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Record article view (No-op)",
)
async def record_view(article_id: str) -> None:
    pass
