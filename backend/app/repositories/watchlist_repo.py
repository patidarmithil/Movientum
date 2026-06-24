"""
Movientum — Watchlist Repository

All async SQLAlchemy queries for the multi-watchlist system.
"""
import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from app.db.orm_models import WatchlistCollection, WatchlistItem, Movie

logger = logging.getLogger(__name__)

COVER_POSTERS_LIMIT = 6


# ── Helpers ──────────────────────────────────────────────────────

async def _cover_posters_for(db: AsyncSession, collection_id: UUID) -> list[str]:
    """Fetch up to 6 poster_paths for the most recently added items in a collection."""
    stmt = (
        select(Movie.poster_path)
        .join(WatchlistItem, WatchlistItem.movie_id == Movie.id)
        .where(WatchlistItem.collection_id == collection_id)
        .where(Movie.poster_path.isnot(None))
        .order_by(WatchlistItem.added_at.desc())
        .limit(COVER_POSTERS_LIMIT)
    )
    result = await db.execute(stmt)
    return [row[0] for row in result.all() if row[0]]


async def _item_count_for(db: AsyncSession, collection_id: UUID) -> int:
    """Count items in a collection."""
    stmt = select(func.count()).where(WatchlistItem.collection_id == collection_id)
    result = await db.execute(stmt)
    return result.scalar_one() or 0


def _assert_owner(collection: WatchlistCollection, user_id: UUID) -> None:
    if collection.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your collection")


# ── Collections CRUD ─────────────────────────────────────────────

async def get_user_collections(db: AsyncSession, user_id: UUID) -> list[dict]:
    """Return all collections for user, each with item_count and cover_posters."""
    stmt = (
        select(WatchlistCollection)
        .where(WatchlistCollection.user_id == user_id)
        .order_by(WatchlistCollection.created_at.desc())
    )
    result = await db.execute(stmt)
    collections = result.scalars().all()

    output = []
    for coll in collections:
        count = await _item_count_for(db, coll.id)
        posters = await _cover_posters_for(db, coll.id)
        output.append({
            "id": coll.id,
            "name": coll.name,
            "description": coll.description,
            "item_count": count,
            "cover_posters": posters,
            "created_at": coll.created_at,
            "updated_at": coll.updated_at,
        })
    return output


async def get_collection_or_404(
    db: AsyncSession, user_id: UUID, collection_id: UUID
) -> WatchlistCollection:
    """Fetch collection, assert ownership, raise 404 if missing."""
    stmt = select(WatchlistCollection).where(WatchlistCollection.id == collection_id)
    result = await db.execute(stmt)
    coll = result.scalar_one_or_none()
    if not coll:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Collection not found")
    _assert_owner(coll, user_id)
    return coll


async def create_collection(
    db: AsyncSession, user_id: UUID, name: str, description: Optional[str]
) -> WatchlistCollection:
    coll = WatchlistCollection(user_id=user_id, name=name, description=description)
    db.add(coll)
    await db.commit()
    await db.refresh(coll)
    logger.info("WATCHLIST_COLL_CREATE user=%s name=%r", user_id, name)
    return coll


async def update_collection(
    db: AsyncSession,
    user_id: UUID,
    collection_id: UUID,
    name: Optional[str],
    description: Optional[str],
) -> WatchlistCollection:
    coll = await get_collection_or_404(db, user_id, collection_id)
    if name is not None:
        coll.name = name
    if description is not None:
        coll.description = description
    await db.commit()
    await db.refresh(coll)
    return coll


async def delete_collection(db: AsyncSession, user_id: UUID, collection_id: UUID) -> None:
    coll = await get_collection_or_404(db, user_id, collection_id)
    await db.delete(coll)
    await db.commit()
    logger.info("WATCHLIST_COLL_DELETE user=%s id=%s", user_id, collection_id)


# ── Items CRUD ───────────────────────────────────────────────────

async def get_collection_detail(
    db: AsyncSession, user_id: UUID, collection_id: UUID, page: int = 1, limit: int = 100
) -> dict:
    """Return collection + paginated items with movie data."""
    coll = await get_collection_or_404(db, user_id, collection_id)

    offset = (page - 1) * limit
    stmt = (
        select(WatchlistItem)
        .options(selectinload(WatchlistItem.movie))
        .where(WatchlistItem.collection_id == collection_id)
        .order_by(WatchlistItem.added_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    items_orm = result.scalars().all()

    total = await _item_count_for(db, collection_id)
    posters = await _cover_posters_for(db, collection_id)

    items_out = []
    for item in items_orm:
        movie = item.movie
        movie_data = None
        if movie:
            movie_data = {
                "id": movie.id,
                "title": movie.title,
                "poster_path": movie.poster_path,
                "media_type": getattr(movie, "type", "movie"),
                "release_year": movie.release_date.year if movie.release_date else None,
                "vote_average": movie.vote_average,
            }
        items_out.append({
            "id": item.id,
            "movie_id": item.movie_id,
            "media_type": getattr(item, "media_type", "movie"),
            "added_at": item.added_at,
            "movie": movie_data,
        })

    return {
        "id": coll.id,
        "name": coll.name,
        "description": coll.description,
        "item_count": total,
        "cover_posters": posters,
        "created_at": coll.created_at,
        "updated_at": coll.updated_at,
        "items": items_out,
    }


async def add_item(
    db: AsyncSession, user_id: UUID, collection_id: UUID, movie_id: int, media_type: str = "movie"
) -> WatchlistItem:
    """Add movie to collection. Idempotent — returns existing item if duplicate."""
    await get_collection_or_404(db, user_id, collection_id)  # ownership check

    # Check duplicate
    stmt = select(WatchlistItem).where(
        WatchlistItem.collection_id == collection_id,
        WatchlistItem.movie_id == movie_id,
        WatchlistItem.media_type == media_type,
    )
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    if existing:
        return existing

    # Ensure movie/TV stub exists in the database before inserting WatchlistItem
    from app.services.watch_service import _ensure_stub_exists
    await _ensure_stub_exists(db, movie_id, media_type)

    item = WatchlistItem(collection_id=collection_id, movie_id=movie_id, media_type=media_type)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    logger.info("WATCHLIST_ITEM_ADD collection=%s movie=%s", collection_id, movie_id)

    # Trigger taste profile update
    try:
        movie_stmt = select(Movie).where(Movie.id == movie_id)
        movie_res = await db.execute(movie_stmt)
        movie_item = movie_res.scalar_one_or_none()
        media_type = movie_item.type if movie_item else "movie"

        from app.services.advanced_recs import get_catalog_row
        from app.services.tmdb_service import ingest_item_to_catalog
        from app.services.feedback_service import apply_feedback

        catalog_item = await get_catalog_row(db, movie_id, media_type)
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, movie_id, media_type)

        if catalog_item:
            await apply_feedback(db, user_id, catalog_item, "watchlist")
    except Exception as e:
        logger.warning(f"Failed to update taste profile on watchlist collection add: {e}")

    return item


async def remove_item(
    db: AsyncSession, user_id: UUID, collection_id: UUID, movie_id: int, media_type: str = "movie"
) -> None:
    await get_collection_or_404(db, user_id, collection_id)  # ownership check

    # Trigger taste profile update before delete
    try:
        movie_stmt = select(Movie).where(Movie.id == movie_id)
        movie_res = await db.execute(movie_stmt)
        movie_item = movie_res.scalar_one_or_none()
        media_type = movie_item.type if movie_item else "movie"

        from app.services.advanced_recs import get_catalog_row
        from app.services.tmdb_service import ingest_item_to_catalog
        from app.services.feedback_service import apply_feedback

        catalog_item = await get_catalog_row(db, movie_id, media_type)
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, movie_id, media_type)

        if catalog_item:
            await apply_feedback(db, user_id, catalog_item, "unwatchlist")
    except Exception as e:
        logger.warning(f"Failed to update taste profile on watchlist collection remove: {e}")

    stmt = delete(WatchlistItem).where(
        WatchlistItem.collection_id == collection_id,
        WatchlistItem.movie_id == movie_id,
        WatchlistItem.media_type == media_type,
    )
    await db.execute(stmt)
    await db.commit()
    logger.info("WATCHLIST_ITEM_REMOVE collection=%s movie=%s", collection_id, movie_id)


async def get_movie_collection_status(
    db: AsyncSession, user_id: UUID, movie_id: int, media_type: str = "movie"
) -> list[dict]:
    """Return all user collections with has_movie flag for a given movie_id."""
    # All user collections
    coll_stmt = (
        select(WatchlistCollection)
        .where(WatchlistCollection.user_id == user_id)
        .order_by(WatchlistCollection.created_at.desc())
    )
    coll_result = await db.execute(coll_stmt)
    collections = coll_result.scalars().all()

    # Which collections contain movie
    item_stmt = (
        select(WatchlistItem.collection_id)
        .join(WatchlistCollection, WatchlistCollection.id == WatchlistItem.collection_id)
        .where(WatchlistCollection.user_id == user_id)
        .where(WatchlistItem.movie_id == movie_id)
        .where(WatchlistItem.media_type == media_type)
    )
    item_result = await db.execute(item_stmt)
    has_movie_ids = {row[0] for row in item_result.all()}

    return [
        {
            "id": coll.id,
            "name": coll.name,
            "has_movie": coll.id in has_movie_ids,
        }
        for coll in collections
    ]
