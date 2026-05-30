"""
Movientum — Recommendations Router (Phase 3.4)

Endpoints:
  GET /api/v1/recommendations               → [AUTH] personalized picks (20 movies)
  GET /api/v1/recommendations/similar/{id}  → public, top 10 similar movies

Cache:
  user:recommendations:{user_id}   TTL 900s (15min) — invalidated by 3.3 mutations
  movie:similar:{movie_id}         TTL 3600s (1hr)
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.cache import (
    TTL_MOVIE_DETAIL,
    TTL_USER_RECS,
    get_cached,
    key_movie_similar,
    key_user_recommendations,
    set_cached,
)
from app.db.database import get_db
from app.services import recommendation_service
from app.utils.deps import get_current_user, get_optional_user

router = APIRouter()
logger = logging.getLogger(__name__)

_TTL_SIMILAR = 900  # 15 min (was 1hr)


# ── GET /recommendations ──────────────────────────────────────────

@router.get(
    "",
    summary="Personalized movie recommendations",
    response_description="20 personalized movies, source tag indicates algorithm used",
)
async def get_recommendations(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    [AUTH] Personalized picks for the authenticated user.

    Algorithm:
    - >= 3 watched movies → genre affinity (top genres from watch history)
    - < 3 watched movies  → trending fallback

    Always returns exactly 20 movies (backfilled with trending if genre results < 20).
    Cached per-user for 15 minutes. Cache invalidated by POST /watch, POST/PUT/DELETE /ratings.

    Response:
        {
            "movies": [...20 MovieListItem objects],
            "source": "genre_affinity" | "trending_fallback"
        }
    """
    user_id_str = current_user["sub"]
    user_id = UUID(user_id_str)
    cache_key = key_user_recommendations(user_id_str)

    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return cached

    result = await recommendation_service.get_personalized_recommendations(
        db, user_id=user_id
    )
    await set_cached(cache_key, result, TTL_USER_RECS)
    logger.info("CACHE_SET key=%s", cache_key)
    return result


# ── GET /recommendations/similar/{movie_id} ───────────────────────

@router.get(
    "/similar/{item_id}",
    summary="Similar items",
    response_description="Up to 40 items scored via advanced pipeline",
)
async def get_similar_items(
    item_id: int,
    media_type: str = "movie",
    db: AsyncSession = Depends(get_db),
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    from typing import Optional
    from uuid import UUID
    
    user_id_str = current_user["sub"] if current_user else "guest"
    cache_key = f"rec:item:{item_id}:{media_type}:{user_id_str}"

    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return cached

    logger.info("CACHE_MISS", extra={"key": cache_key})
    
    user_uuid = UUID(current_user["sub"]) if current_user else None
    movies = await recommendation_service.get_similar_items(db, item_id=item_id, media_type=media_type, user_id=user_uuid)

    result = {"movies": movies, "movie_id": item_id, "media_type": media_type}
    await set_cached(cache_key, result, _TTL_SIMILAR)
    logger.info("CACHE_SET key=%s", cache_key)
    return result
