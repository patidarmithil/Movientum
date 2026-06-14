"""
Movientum — Ratings Router (Phase 3.3)

Endpoints:
  POST   /api/v1/ratings                         → [AUTH] submit/upsert rating
  GET    /api/v1/ratings/me                      → [AUTH] my ratings, paginated
  GET    /api/v1/ratings/distribution/{movie_id} → public, category bucket counts
  PUT    /api/v1/ratings/{id}                    → [AUTH] update own rating
  DELETE /api/v1/ratings/{id}                    → [AUTH] delete own rating

Cache:
  rating:dist:{movie_id}  TTL 300s — invalidated on POST/PUT/DELETE
  user:recs:{user_id}             — invalidated on POST/PUT/DELETE (feeds 3.4)
"""
import logging
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.cache import get_cached, invalidate, set_cached
from app.db.cache import (
    key_user_ratings, TTL_USER_RATINGS,
    key_user_prefs,
)
from app.db.database import get_db
from app.schemas.rating import (
    DistributionResponse,
    RatingCategory,
    RatingCreateRequest,
    RatingResponse,
    RatingUpdateRequest,
    UserRatingsResponse,
    RatingNeededRequest,
)
from app.services import rating_service
from app.utils.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

_DIST_TTL = 300  # 5 min


def _dist_key(movie_id: int) -> str:
    return f"rating:dist:{movie_id}"


def _recs_key(user_id: str) -> str:
    return f"user:recs:{user_id}"


async def _invalidate_caches(movie_id: int, user_id: str) -> None:
    """Invalidate distribution + recommendation caches after any mutation."""
    await invalidate(_dist_key(movie_id))
    await invalidate(_recs_key(user_id))
    await invalidate(f"movie:detail:{movie_id}")
    await invalidate(f"movie:similar:{movie_id}:movie")
    await invalidate(key_user_ratings(user_id))  # dashboard ratings cache
    await invalidate(key_user_prefs(user_id))    # news personalization prefs
    logger.info(
        "CACHE_INVALIDATED",
        extra={"keys": [_dist_key(movie_id), _recs_key(user_id), f"movie:detail:{movie_id}", f"movie:similar:{movie_id}:movie", key_user_ratings(user_id), key_user_prefs(user_id)]},
    )


# ── POST /ratings ─────────────────────────────────────────────────

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=RatingResponse,
    summary="Submit or update rating",
)
async def submit_rating(
    body: RatingCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> RatingResponse:
    """
    Upsert rating for (user, movie) pair.
    Second call for same movie updates the category (201 on create, returns updated on upsert).
    """
    user_id = UUID(current_user["sub"])
    rating = await rating_service.upsert_rating(
        db, user_id=user_id, movie_id=body.movie_id, category=body.category
    )
    await _invalidate_caches(body.movie_id, str(user_id))
    logger.info(
        "RATING_SUBMITTED",
        extra={
            "user_id": str(user_id),
            "movie_id": body.movie_id,
            "category": body.category.value,
        },
    )
    return RatingResponse(
        id=rating.id,
        movie_id=rating.movie_id,
        user_id=rating.user_id,
        category=rating.category,
        created_at=rating.created_at,
        updated_at=rating.updated_at,
    )


# ── GET /ratings/me ───────────────────────────────────────────────

@router.get(
    "/me",
    summary="Get my ratings",
)
async def get_my_ratings(
    page: int = Query(1, ge=1),
    limit: int = Query(1500, ge=1, le=1500),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    cache_key = key_user_ratings(str(user_id))
    cached = await get_cached(cache_key)
    if cached:
        return cached
    ratings, total = await rating_service.get_user_ratings(db, user_id, page, limit)
    items = [
        {
            "id": r.id,
            "movie_id": r.movie_id,
            "category": r.category,
            "movie": {
                "id": r.movie.id,
                "title": r.movie.title,
                "poster_path": r.movie.poster_path,
                "release_year": r.movie.release_date.year if r.movie.release_date else None,
                "vote_average": r.movie.vote_average,
                "media_type": getattr(r.movie, "type", "movie"),
                "moctale_rating": None,
            }
        }
        for r in ratings
    ]
    if items:
        from app.routers.movies import _bulk_fetch_moctale
        item_ids = [it["movie"]["id"] for it in items]
        item_types = [it["movie"]["media_type"] for it in items]
        moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
        for it in items:
            it["movie"]["moctale_rating"] = moctale_map.get(it["movie"]["id"])

    result = {
        "items": items
    }
    await set_cached(cache_key, result, TTL_USER_RATINGS)
    return result


# ── GET /ratings/distribution/{movie_id} ─────────────────────────

@router.get(
    "/distribution/{movie_id}",
    response_model=DistributionResponse,
    summary="Get rating distribution for a movie",
)
async def get_distribution(
    movie_id: int,
    db: AsyncSession = Depends(get_db),
) -> DistributionResponse:
    """Public endpoint — no auth required. Cached 5 min."""
    cache_key = _dist_key(movie_id)
    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT", extra={"key": cache_key})
        return DistributionResponse(**cached)

    logger.info("CACHE_MISS", extra={"key": cache_key})
    dist = await rating_service.get_distribution(db, movie_id)
    await set_cached(cache_key, dist, _DIST_TTL)
    return DistributionResponse(**dist)


# ── PUT /ratings/{id} ────────────────────────────────────────────

@router.put(
    "/{rating_id}",
    response_model=RatingResponse,
    summary="Update own rating",
)
async def update_rating(
    rating_id: UUID,
    body: RatingUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> RatingResponse:
    user_id = UUID(current_user["sub"])

    # Fetch + ownership check
    rating = await rating_service.get_rating_by_id(db, rating_id)
    if not rating:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rating not found")
    if rating.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your rating")

    # Re-upsert with new category
    updated = await rating_service.upsert_rating(
        db, user_id=user_id, movie_id=rating.movie_id, category=body.category
    )
    await _invalidate_caches(rating.movie_id, str(user_id))
    return RatingResponse(
        id=updated.id,
        movie_id=updated.movie_id,
        user_id=updated.user_id,
        category=updated.category,
        created_at=updated.created_at,
        updated_at=updated.updated_at,
    )


# ── DELETE /ratings/{id} ─────────────────────────────────────────

@router.delete(
    "/{rating_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete own rating",
)
async def delete_rating(
    rating_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> None:
    user_id = UUID(current_user["sub"])

    # Need movie_id before deletion for cache invalidation
    rating = await rating_service.get_rating_by_id(db, rating_id)
    if not rating:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rating not found")

    movie_id = rating.movie_id
    deleted = await rating_service.delete_rating(db, rating_id, user_id)
    if deleted:
        await _invalidate_caches(movie_id, str(user_id))


# ── POST /ratings/needed ─────────────────────────────────────────

from app.db.orm_models import RatingNeeded
from sqlalchemy.dialects.postgresql import insert as pg_insert

@router.post(
    "/needed",
    status_code=status.HTTP_201_CREATED,
    summary="Record content that needs ratings",
)
async def request_rating_needed(
    body: RatingNeededRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Creates a row in rating_needed table for content missing Moctale ratings.
    """
    stmt = (
        pg_insert(RatingNeeded)
        .values(
            id=body.id,
            title=body.title,
            content=body.content,
            year=body.year,
        )
        .on_conflict_do_update(
            index_elements=["id"],
            set_={
                "title": body.title,
                "content": body.content,
                "year": body.year,
                "fetched_at": datetime.now(timezone.utc)
            }
        )
    )
    await db.execute(stmt)
    await db.commit()
    return {"status": "success", "message": "Rating request recorded successfully."}
