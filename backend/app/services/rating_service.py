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

from app.db.orm_models import Rating, Movie, MovieGenre, MovieRating, TvRating
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
    
    media_type = "tv" if title_id < 0 else "movie"
    tmdb_id = abs(title_id)

    # Fetch detail based on inferred media_type
    if media_type == "tv":
        raw = await tmdb.fetch_tv_detail(tmdb_id)
    else:
        raw = await tmdb.fetch_movie_detail(tmdb_id)

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
        id=title_id,
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

async def _update_moctale_rating(db: AsyncSession, movie_id: int, old_cat: Optional[str], new_cat: Optional[str]):
    if old_cat == new_cat:
        return

    # Check if the content is a TV show or Movie
    stmt_item = select(Movie).where(Movie.id == movie_id)
    item = (await db.execute(stmt_item)).scalar_one_or_none()
    is_tv = item and item.type == 'tv'

    RatingModel = TvRating if is_tv else MovieRating

    stmt = select(RatingModel).where(RatingModel.id == movie_id)
    moctale = (await db.execute(stmt)).scalar_one_or_none()

    if not moctale:
        if new_cat:
            moctale = RatingModel(
                id=movie_id,
                slug=f"{'tv' if is_tv else 'movie'}-{movie_id}",
                total_votes=1,
                perfection=100.0 if new_cat == "perfection" else 0.0,
                go_for_it=100.0 if new_cat == "go_for_it" else 0.0,
                timepass=100.0 if new_cat == "timepass" else 0.0,
                skip=100.0 if new_cat == "skip" else 0.0,
                score=0,
            )
            db.add(moctale)
        return
    
    total = moctale.total_votes or 0
    votes = {
        "perfection": round((moctale.perfection or 0) / 100.0 * total),
        "go_for_it": round((moctale.go_for_it or 0) / 100.0 * total),
        "timepass": round((moctale.timepass or 0) / 100.0 * total),
        "skip": round((moctale.skip or 0) / 100.0 * total),
    }

    if old_cat and old_cat in votes:
        votes[old_cat] = max(0, votes[old_cat] - 1)
        total = max(0, total - 1)
        
    if new_cat and new_cat in votes:
        votes[new_cat] += 1
        total += 1

    moctale.total_votes = total
    if total > 0:
        moctale.perfection = (votes["perfection"] / total) * 100
        moctale.go_for_it = (votes["go_for_it"] / total) * 100
        moctale.timepass = (votes["timepass"] / total) * 100
        moctale.skip = (votes["skip"] / total) * 100
    else:
        moctale.perfection = 0.0
        moctale.go_for_it = 0.0
        moctale.timepass = 0.0
        moctale.skip = 0.0


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
    
    stmt_check = select(Rating.category).where(Rating.user_id == user_id, Rating.movie_id == movie_id)
    old_cat = (await db.execute(stmt_check)).scalar_one_or_none()

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

    await _update_moctale_rating(db, movie_id, old_cat, category.value)

    # Automatically mark as watched if not already
    from app.db.orm_models import WatchHistory
    stmt_check_watched = select(WatchHistory.id).where(WatchHistory.user_id == user_id, WatchHistory.movie_id == movie_id)
    is_watched = (await db.execute(stmt_check_watched)).scalar_one_or_none()
    
    if not is_watched:
        from app.services import watch_service
        await watch_service.mark_watched(db, user_id=user_id, movie_id=movie_id)

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
    movie_id = rating.movie_id
    category = rating.category
    await db.delete(rating)
    await _update_moctale_rating(db, movie_id, category, None)
    
    logger.info(
        "RATING_DELETED",
        extra={"rating_id": str(rating_id), "user_id": str(user_id)},
    )
    return True
