"""
Movientum — Rating Service (Phase 3.3)

Service layer: all DB logic for ratings.
Routers call these functions — no raw SQL in router handlers.

upsert_rating    → create or update 1 rating per user-movie pair
get_distribution → count rows per category for a movie_id
get_user_ratings → paginated list of a user's ratings
get_rating_by_id → fetch single rating (for update/delete ownership check)
delete_rating    → remove a rating row (ownership enforced)
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.orm_models import Rating, Movie, MovieGenre
from app.schemas.rating import RatingCategory

logger = logging.getLogger(__name__)


async def _ensure_stub_exists(db: AsyncSession, title_id: int):
    # Check if exists in the Movie catalog
    stmt = select(Movie).where(Movie.id == title_id)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        return

    # Try fetching details from TMDB
    from app.services.tmdb_service import tmdb_service as tmdb
    from datetime import date

    # Try movie detail
    raw = await tmdb.fetch_movie_detail(title_id)
    media_type = "movie"

    # If movie not found, try TV detail
    if not raw:
        raw = await tmdb.fetch_tv_detail(title_id)
        media_type = "tv"

    if not raw:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Title {title_id} not found on TMDB"
        )

    # Insert stub
    release_date_str = raw.get("release_date") if media_type == "movie" else raw.get("first_air_date")
    release_date_obj = None
    if release_date_str:
        try:
            release_date_obj = date.fromisoformat(release_date_str)
        except ValueError:
            pass

    title_val = raw.get("title") or raw.get("name") or raw.get("original_name") or ""
    overview_val = raw.get("overview") or ""
    search_vector = func.to_tsvector('english', f"{title_val} {overview_val}")

    stub = Movie(
        id=raw["id"],
        title=title_val,
        original_title=raw.get("original_title") or raw.get("original_name") or title_val,
        overview=overview_val,
        release_date=release_date_obj,
        poster_path=raw.get("poster_path"),
        backdrop_path=raw.get("backdrop_path"),
        popularity=float(raw.get("popularity") or 0.0),
        vote_average=float(raw.get("vote_average") or 0.0),
        vote_count=int(raw.get("vote_count") or 0),
        adult=bool(raw.get("adult", False)),
        original_language=raw.get("original_language"),
        type=media_type,
        search_vector=search_vector,
    )
    db.add(stub)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to insert stub for {media_type} {title_id}: {e}")


async def upsert_rating(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    category: RatingCategory,
) -> Rating:
    """
    Create or update rating for (user_id, movie_id).
    Uses PostgreSQL ON CONFLICT DO UPDATE (true upsert).
    Returns the updated/created Rating ORM object.
    """
    await _ensure_stub_exists(db, movie_id)
    stmt = (
        pg_insert(Rating)
        .values(
            user_id=user_id,
            movie_id=movie_id,
            category=category.value,
        )
        .on_conflict_do_update(
            constraint="uq_rating_user_movie",
            set_={
                "category": category.value,
                "updated_at": func.now(),
            },
        )
        .returning(Rating)
    )
    result = await db.execute(stmt)
    row = result.scalar_one()
    logger.info(
        "RATING_SUBMITTED",
        extra={"user_id": str(user_id), "movie_id": movie_id, "category": category.value},
    )
    return row


async def get_distribution(db: AsyncSession, movie_id: int) -> dict:
    """
    Count ratings per category for given movie_id.
    Returns dict: {skip, timepass, go_for_it, perfection, total}.
    """
    stmt = (
        select(Rating.category, func.count(Rating.id).label("cnt"))
        .where(Rating.movie_id == movie_id)
        .group_by(Rating.category)
    )
    result = await db.execute(stmt)
    rows = result.all()

    dist = {"skip": 0, "timepass": 0, "go_for_it": 0, "perfection": 0}
    for row in rows:
        cat = row.category
        if cat in dist:
            dist[cat] = row.cnt

    dist["total"] = sum(dist[k] for k in ["skip", "timepass", "go_for_it", "perfection"])
    return dist


async def get_user_ratings(
    db: AsyncSession,
    user_id: UUID,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Rating], int]:
    """
    Return paginated list of a user's ratings + total count.
    """
    offset = (page - 1) * limit

    count_stmt = select(func.count(Rating.id)).where(Rating.user_id == user_id)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(Rating)
        .options(
            selectinload(Rating.movie).selectinload(Movie.genres).selectinload(MovieGenre.genre)
        )
        .where(Rating.user_id == user_id)
        .order_by(Rating.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    ratings = result.scalars().all()
    return list(ratings), total


async def get_rating_by_id(db: AsyncSession, rating_id: UUID) -> Optional[Rating]:
    """Fetch single rating by UUID."""
    stmt = select(Rating).where(Rating.id == rating_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def delete_rating(
    db: AsyncSession,
    rating_id: UUID,
    user_id: UUID,
) -> bool:
    """
    Delete rating. Returns True if deleted, False if not found.
    Raises HTTP 403 if rating belongs to another user.
    """
    rating = await get_rating_by_id(db, rating_id)
    if not rating:
        return False
    if rating.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete another user's rating",
        )
    await db.delete(rating)
    logger.info(
        "RATING_DELETED",
        extra={"rating_id": str(rating_id), "user_id": str(user_id)},
    )
    return True
