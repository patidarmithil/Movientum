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
    from app.db.cache import (
        get_cached, set_cached,
        key_user_prefs, TTL_USER_PREFS,
        key_news_feed_user, TTL_NEWS_FEED_USER,
    )

    user_id = _UUID(current_user["sub"])
    uid_str = str(user_id)

    # ── Check scored feed cache first (fastest path) ──────────────
    feed_key = key_news_feed_user(uid_str, page)
    cached_feed = await get_cached(feed_key)
    if cached_feed:
        return cached_feed

    # ── Load user prefs from cache or DB ──────────────────────────
    prefs_key = key_user_prefs(uid_str)
    cached_prefs = await get_cached(prefs_key)

    if cached_prefs:
        user_genre_tags = cached_prefs["genre_tags"]
        watched_movie_titles = cached_prefs["movie_titles"]
        director_names = cached_prefs["director_names"]
    else:
        # 4 DB queries — only on prefs cache miss (every 15 min)
        genre_rows = await db.execute(
            select(Genre.name)
            .join(UserGenrePreference, UserGenrePreference.genre_id == Genre.id)
            .where(UserGenrePreference.user_id == user_id)
            .order_by(UserGenrePreference.weight.desc())
            .limit(10)
        )
        user_genre_tags = [r[0].lower() for r in genre_rows.all()]

        watch_rows = await db.execute(
            select(WatchHistory.movie_id)
            .where(WatchHistory.user_id == user_id)
            .limit(200)
        )
        watched_movie_ids = [r[0] for r in watch_rows.all()]

        watched_movie_titles = []
        director_names = []

        if watched_movie_ids:
            title_rows = await db.execute(
                select(Movie.title).where(Movie.id.in_(watched_movie_ids))
            )
            watched_movie_titles = [r[0] for r in title_rows.all()]

            director_rows = await db.execute(
                select(Director.name)
                .join(MovieDirector, MovieDirector.director_id == Director.id)
                .where(MovieDirector.movie_id.in_(watched_movie_ids))
                .limit(50)
            )
            director_names = [r[0] for r in director_rows.all()]

        # Cache prefs for 15 min
        await set_cached(prefs_key, {
            "genre_tags": user_genre_tags,
            "movie_titles": watched_movie_titles,
            "director_names": director_names,
        }, TTL_USER_PREFS)

    feed_result = await news_service.get_personalized_feed(
        user_genre_tags=user_genre_tags,
        watched_movie_titles=watched_movie_titles,
        director_names=director_names,
        page=page,
        page_size=page_size,
    )

    # Cache scored feed for 5 min
    await set_cached(feed_key, feed_result, TTL_NEWS_FEED_USER)
    return feed_result



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
