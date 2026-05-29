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


async def mark_watched(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
    watch_source: str | None = None,
    rewatched: bool = False,
) -> WatchHistory:
    """
    Insert or update watch history row for (user_id, movie_id).
    ON CONFLICT updates watched_at + watch_source (handles re-watch tracking).
    """
    await _ensure_stub_exists(db, movie_id)
    stmt = (
        pg_insert(WatchHistory)
        .values(
            user_id=user_id,
            movie_id=movie_id,
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
) -> bool:
    """
    Remove movie/TV show from watch history.
    Returns True if deleted, False if not found.
    Raises HTTP 404 if not in watch history.
    """
    stmt = select(WatchHistory).where(
        WatchHistory.user_id == user_id,
        WatchHistory.movie_id == movie_id,
    )
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie/TV show not in watch history",
        )

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
) -> WatchHistory:
    """
    Add movie to watchlist. Idempotent: second call is a no-op (ON CONFLICT DO NOTHING).
    Returns the Watchlist row.
    """
    await _ensure_stub_exists(db, movie_id)
    stmt = (
        pg_insert(Watchlist)
        .values(user_id=user_id, movie_id=movie_id)
        .on_conflict_do_nothing(constraint="uq_watchlist_user_movie")
        .returning(Watchlist)
    )
    result = await db.execute(stmt)
    row = result.scalar_one_or_none()

    if row is None:
        # Already exists — fetch the existing row
        existing = await db.execute(
            select(Watchlist).where(
                Watchlist.user_id == user_id,
                Watchlist.movie_id == movie_id,
            )
        )
        row = existing.scalar_one()

    logger.info(
        "WATCHLIST_ADDED",
        extra={"user_id": str(user_id), "movie_id": movie_id},
    )
    return row


async def remove_from_watchlist(
    db: AsyncSession,
    user_id: UUID,
    movie_id: int,
) -> bool:
    """
    Remove movie from watchlist.
    Returns True if deleted, False if not found.
    Raises HTTP 404 if not in watchlist.
    """
    stmt = select(Watchlist).where(
        Watchlist.user_id == user_id,
        Watchlist.movie_id == movie_id,
    )
    result = await db.execute(stmt)
    entry = result.scalar_one_or_none()

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movie not in watchlist",
        )

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
) -> dict:
    """
    Return {watched: bool, watchlisted: bool} for a single movie+user pair.
    Single round-trip via two scalar subqueries.
    """
    watched_stmt = select(func.count(WatchHistory.id)).where(
        WatchHistory.user_id == user_id,
        WatchHistory.movie_id == movie_id,
    )
    watchlisted_stmt = select(func.count(Watchlist.id)).where(
        Watchlist.user_id == user_id,
        Watchlist.movie_id == movie_id,
    )
    watched_count = (await db.execute(watched_stmt)).scalar_one()
    watchlisted_count = (await db.execute(watchlisted_stmt)).scalar_one()

    return {
        "watched": watched_count > 0,
        "watchlisted": watchlisted_count > 0,
    }
