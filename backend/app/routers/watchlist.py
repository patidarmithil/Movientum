"""
Movientum — Watchlist Collections Router

Endpoints:
  GET    /api/v1/watchlists                              → list user collections
  POST   /api/v1/watchlists                              → create collection
  GET    /api/v1/watchlists/{collection_id}              → collection detail + items
  PATCH  /api/v1/watchlists/{collection_id}              → update name/description
  DELETE /api/v1/watchlists/{collection_id}              → delete collection
  POST   /api/v1/watchlists/{collection_id}/items        → add movie to collection
  DELETE /api/v1/watchlists/{collection_id}/items/{movie_id} → remove movie
  GET    /api/v1/watchlists/movie/{movie_id}/status      → which collections contain movie
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.cache import get_cached, set_cached, invalidate
from app.db.database import get_db
from app.repositories import watchlist_repo
from app.schemas.watchlist import (
    AddItemRequest,
    CollectionCreate,
    CollectionDetail,
    CollectionOut,
    CollectionsListResponse,
    CollectionUpdate,
    MovieStatusResponse,
)
from app.utils.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)

# Cache TTLs (seconds)
TTL_USER_COLLECTIONS = 300      # 5 min — collection list
TTL_COLLECTION_DETAIL = 300     # 5 min — single collection


def _key_user_collections(user_id: str) -> str:
    return f"user:wlists:{user_id}"


def _key_collection(collection_id: str) -> str:
    return f"user:wlcoll:{collection_id}"


def _key_movie_status(user_id: str, movie_id: int) -> str:
    return f"user:wlmovie:{user_id}:{movie_id}"


async def _bust_user(user_id: str) -> None:
    await invalidate(_key_user_collections(user_id))


async def _bust_collection(collection_id: str, user_id: str) -> None:
    await invalidate(_key_collection(collection_id))
    await invalidate(_key_user_collections(user_id))


# ── GET /watchlists ───────────────────────────────────────────────

@router.get(
    "",
    summary="List user watchlist collections",
)
async def list_collections(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    cache_key = _key_user_collections(str(user_id))
    cached = await get_cached(cache_key)
    if cached:
        return cached

    collections = await watchlist_repo.get_user_collections(db, user_id)
    result = {
        "collections": [
            {
                **c,
                "id": str(c["id"]),
                "created_at": c["created_at"].isoformat(),
                "updated_at": c["updated_at"].isoformat(),
            }
            for c in collections
        ],
        "total": len(collections),
    }
    await set_cached(cache_key, result, TTL_USER_COLLECTIONS)
    return result


# ── POST /watchlists ──────────────────────────────────────────────

@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    summary="Create a new watchlist collection",
)
async def create_collection(
    body: CollectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    coll = await watchlist_repo.create_collection(
        db, user_id=user_id, name=body.name, description=body.description
    )
    await _bust_user(str(user_id))
    return {
        "id": str(coll.id),
        "name": coll.name,
        "description": coll.description,
        "item_count": 0,
        "cover_posters": [],
        "created_at": coll.created_at.isoformat(),
        "updated_at": coll.updated_at.isoformat(),
    }


# ── GET /watchlists/movie/{media_type}/{movie_id}/status ───────────────────────
# NOTE: must be defined BEFORE /{collection_id} to avoid routing conflict

@router.get(
    "/movie/{media_type}/{movie_id}/status",
    summary="Get which collections contain a given movie",
)
async def movie_collection_status(
    movie_id: int,
    media_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    statuses = await watchlist_repo.get_movie_collection_status(db, user_id, movie_id, media_type)
    return {
        "movie_id": movie_id,
        "media_type": media_type,
        "collections": [
            {"id": str(s["id"]), "name": s["name"], "has_movie": s["has_movie"]}
            for s in statuses
        ],
    }


# ── GET /watchlists/{collection_id} ──────────────────────────────

@router.get(
    "/{collection_id}",
    summary="Get collection detail with items",
)
async def get_collection(
    collection_id: UUID,
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    cache_key = _key_collection(str(collection_id))
    cached = await get_cached(cache_key)
    if cached:
        return cached

    detail = await watchlist_repo.get_collection_detail(
        db, user_id=user_id, collection_id=collection_id, page=page, limit=limit
    )

    # Serialize UUIDs and datetimes for JSON / cache
    result = {
        **detail,
        "id": str(detail["id"]),
        "created_at": detail["created_at"].isoformat(),
        "updated_at": detail["updated_at"].isoformat(),
        "items": [
            {
                **item,
                "id": str(item["id"]),
                "added_at": item["added_at"].isoformat(),
            }
            for item in detail["items"]
        ],
    }
    await set_cached(cache_key, result, TTL_COLLECTION_DETAIL)
    return result


# ── PATCH /watchlists/{collection_id} ────────────────────────────

@router.patch(
    "/{collection_id}",
    summary="Update collection name/description",
)
async def update_collection(
    collection_id: UUID,
    body: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    coll = await watchlist_repo.update_collection(
        db,
        user_id=user_id,
        collection_id=collection_id,
        name=body.name,
        description=body.description,
    )
    await _bust_collection(str(collection_id), str(user_id))
    return {
        "id": str(coll.id),
        "name": coll.name,
        "description": coll.description,
        "updated_at": coll.updated_at.isoformat(),
    }


# ── DELETE /watchlists/{collection_id} ───────────────────────────

@router.delete(
    "/{collection_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a collection (and all its items)",
)
async def delete_collection(
    collection_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> None:
    user_id = UUID(current_user["sub"])
    await watchlist_repo.delete_collection(db, user_id=user_id, collection_id=collection_id)
    await _bust_collection(str(collection_id), str(user_id))


# ── POST /watchlists/{collection_id}/items ────────────────────────

@router.post(
    "/{collection_id}/items",
    status_code=status.HTTP_201_CREATED,
    summary="Add movie/tv to collection",
)
async def add_item(
    collection_id: UUID,
    body: AddItemRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = UUID(current_user["sub"])
    item = await watchlist_repo.add_item(
        db, user_id=user_id, collection_id=collection_id, movie_id=body.movie_id, media_type=body.media_type
    )
    await _bust_collection(str(collection_id), str(user_id))
    return {
        "id": str(item.id),
        "collection_id": str(item.collection_id),
        "movie_id": item.movie_id,
        "media_type": item.media_type,
        "added_at": item.added_at.isoformat(),
    }


# ── DELETE /watchlists/{collection_id}/items/{media_type}/{movie_id} ──────────

@router.delete(
    "/{collection_id}/items/{media_type}/{movie_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove movie/tv from collection",
)
async def remove_item(
    collection_id: UUID,
    movie_id: int,
    media_type: str,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> None:
    user_id = UUID(current_user["sub"])
    await watchlist_repo.remove_item(
        db, user_id=user_id, collection_id=collection_id, movie_id=movie_id, media_type=media_type
    )
    await _bust_collection(str(collection_id), str(user_id))
