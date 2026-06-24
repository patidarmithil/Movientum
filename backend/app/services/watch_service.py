"""
Movientum — Watch Service (Phase 3.3)

Service layer: all DB logic for watch history and watchlist.
Routers call these functions — no raw SQL in router handlers.

mark_watched          → upsert watch_history row (idempotent)
get_watch_history     → paginated history for user
add_to_watchlist      → add movie to watchlist (idempotent via ON CONFLICT)
remove_from_watchlist → delete watchlist entry
get_watchlist         → paginated watchlist for user
get_watch_status      → {watched, watchlisted} for single movie+user
"""
import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.orm_models import WatchHistory, Watchlist, Movie, MovieGenre

logger = logging.getLogger(__name__)


# ── Watch History ────────────────────────────────────────────────

async def _ensure_stub_exists(db: AsyncSession, title_id: int, media_type: str):
    # Check if exists in the Movie catalog
    stmt = select(Movie).where(Movie.id == title_id, Movie.type == media_type)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        return

    # Try fetching details from TMDB
    from app.services.tmdb_service import tmdb_service as tmdb
    from datetime import date
    
    tmdb_id = title_id

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


async def mark_watched(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    media_type: str,
    watch_source: str | None = None,
    rewatched: bool = False,
) -> WatchHistory:
    """
    Insert or update watch history row for (user_id, movie_id).
    ON CONFLICT updates watched_at + watch_source (handles re-watch tracking).
    """
    await _ensure_stub_exists(db, movie_id, media_type)
    stmt = (
        pg_insert(WatchHistory)
        .values(
            user_id=user_id,
            movie_id=movie_id,
            media_type=media_type,
            watch_source=watch_source,
            rewatched=rewatched,
        )
        .on_conflict_do_update(
            constraint="uq_watch_user_movie",
            set_={
                "watched_at": func.now(),
                "watch_source": watch_source,
                "rewatched": rewatched,
            },
        )
        .returning(WatchHistory)
    )
    result = await db.execute(stmt)
    row = result.scalar_one()
    logger.info(
        "WATCH_MARKED",
        extra={"user_id": str(user_id), "movie_id": movie_id},
    )

    # Trigger Taste Profile Update
    try:
        from app.services.advanced_recs import get_catalog_row
        from app.services.tmdb_service import ingest_item_to_catalog
        from app.services.feedback_service import apply_feedback

        catalog_item = await get_catalog_row(db, movie_id, media_type)
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, movie_id, media_type)

        if catalog_item:
            await apply_feedback(db, user_id, catalog_item, "watched")
    except Exception as e:
        logger.warning(f"Failed to update taste profile on watched mark: {e}")

    return row


async def get_watch_history(
    db: AsyncSession,
    user_id: UUID,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[WatchHistory], int]:
    """Paginated watch history, newest first."""
    offset = (page - 1) * limit

    count_stmt = select(func.count(WatchHistory.id)).where(WatchHistory.user_id == user_id)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(WatchHistory)
        .options(
            selectinload(WatchHistory.movie).selectinload(Movie.genres).selectinload(MovieGenre.genre)
        )
        .where(WatchHistory.user_id == user_id)
        .order_by(WatchHistory.watched_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all()), total


async def remove_from_watch_history(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    media_type: str,
) -> bool:
    """
    Remove movie/TV show from watch history.
    Returns True if deleted, False if not found.
    Raises HTTP 404 if not in watch history.
    """
    stmt = select(WatchHistory).where(
        WatchHistory.user_id == user_id,
        WatchHistory.movie_id == movie_id,
        WatchHistory.media_type == media_type,
    )
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie/TV show not in watch history",
        )

    # Trigger Taste Profile Update before delete
    try:
        from app.services.advanced_recs import get_catalog_row
        from app.services.tmdb_service import ingest_item_to_catalog
        from app.services.feedback_service import apply_feedback

        catalog_item = await get_catalog_row(db, movie_id, media_type)
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, movie_id, media_type)

        if catalog_item:
            await apply_feedback(db, user_id, catalog_item, "unwatched")
    except Exception as e:
        logger.warning(f"Failed to update taste profile on watched remove: {e}")

    await db.delete(entry)
    logger.info(
        "WATCH_HISTORY_REMOVED",
        extra={"user_id": str(user_id), "movie_id": movie_id},
    )
    return True


# ── Watchlist ────────────────────────────────────────────────────

async def add_to_watchlist(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    media_type: str,
) -> WatchHistory:
    """
    Add movie to watchlist. Idempotent: second call is a no-op (ON CONFLICT DO NOTHING).
    Returns the Watchlist row.
    """
    await _ensure_stub_exists(db, movie_id, media_type)
    stmt = (
        pg_insert(Watchlist)
        .values(user_id=user_id, movie_id=movie_id, media_type=media_type)
        .on_conflict_do_nothing(constraint="uq_watchlist_user_movie")
        .returning(Watchlist)
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    is_new = True
    if row is None:
        is_new = False
        # Already exists — fetch the existing row
        existing = await db.execute(
            select(Watchlist).where(
                Watchlist.user_id == user_id,
                Watchlist.movie_id == movie_id,
                Watchlist.media_type == media_type,
            )
        )
        row = existing.scalar_one()

    logger.info(
        "WATCHLIST_ADDED",
        extra={"user_id": str(user_id), "movie_id": movie_id},
    )

    # Trigger Taste Profile Update if it's newly added
    if is_new:
        try:
            from app.services.advanced_recs import get_catalog_row
            from app.services.tmdb_service import ingest_item_to_catalog
            from app.services.feedback_service import apply_feedback

            catalog_item = await get_catalog_row(db, movie_id, media_type)
            if not catalog_item:
                catalog_item = await ingest_item_to_catalog(db, movie_id, media_type)

            if catalog_item:
                await apply_feedback(db, user_id, catalog_item, "watchlist")
        except Exception as e:
            logger.warning(f"Failed to update taste profile on watchlist add: {e}")

    return row


async def remove_from_watchlist(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    media_type: str,
) -> bool:
    """
    Remove movie from watchlist.
    Returns True if deleted, False if not found.
    Raises HTTP 404 if not in watchlist.
    """
    stmt = select(Watchlist).where(
        Watchlist.user_id == user_id,
        Watchlist.movie_id == movie_id,
        Watchlist.media_type == media_type,
    )
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not in watchlist",
        )

    # Trigger Taste Profile Update before delete
    try:
        from app.services.advanced_recs import get_catalog_row
        from app.services.tmdb_service import ingest_item_to_catalog
        from app.services.feedback_service import apply_feedback

        catalog_item = await get_catalog_row(db, movie_id, media_type)
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, movie_id, media_type)

        if catalog_item:
            await apply_feedback(db, user_id, catalog_item, "unwatchlist")
    except Exception as e:
        logger.warning(f"Failed to update taste profile on watchlist remove: {e}")

    await db.delete(entry)
    logger.info(
        "WATCHLIST_REMOVED",
        extra={"user_id": str(user_id), "movie_id": movie_id},
    )
    return True


async def get_watchlist(
    db: AsyncSession,
    user_id: UUID,
    page: int = 1,
    limit: int = 20,
) -> tuple[list[Watchlist], int]:
    """Paginated watchlist, newest additions first."""
    offset = (page - 1) * limit

    count_stmt = select(func.count(Watchlist.id)).where(Watchlist.user_id == user_id)
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(Watchlist)
        .options(
            selectinload(Watchlist.movie).selectinload(Movie.genres).selectinload(MovieGenre.genre)
        )
        .where(Watchlist.user_id == user_id)
        .order_by(Watchlist.added_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return list(result.scalars().all()), total


async def get_watch_status(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    media_type: str,
) -> dict:
    """
    Return {watched: bool, watchlisted: bool, user_rating: str|None} for a single movie+user pair.
    """
    from app.db.orm_models import Rating
    
    watched_stmt = select(func.count(WatchHistory.id)).where(
        WatchHistory.user_id == user_id,
        WatchHistory.movie_id == movie_id,
        WatchHistory.media_type == media_type,
    )
    watchlisted_stmt = select(func.count(Watchlist.id)).where(
        Watchlist.user_id == user_id,
        Watchlist.movie_id == movie_id,
        Watchlist.media_type == media_type,
    )
    rating_stmt = select(Rating.id, Rating.category).where(
        Rating.user_id == user_id,
        Rating.movie_id == movie_id,
        Rating.media_type == media_type,
    )
    watched_count = (await db.execute(watched_stmt)).scalar_one()
    watchlisted_count = (await db.execute(watchlisted_stmt)).scalar_one()
    
    rating_row = (await db.execute(rating_stmt)).first()
    user_rating = rating_row.category if rating_row else None
    rating_id = rating_row.id if rating_row else None

    return {
        "watched": watched_count > 0,
        "watchlisted": watchlisted_count > 0,
        "user_rating": user_rating,
        "rating_id": rating_id,
    }
