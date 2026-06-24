"""
Movientum — Watchlist Collection Schemas

Pydantic models for the multi-watchlist system.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


# ── Request models ───────────────────────────────────────────────

class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Collection name")
    description: Optional[str] = Field(None, max_length=500)


class CollectionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)


class AddItemRequest(BaseModel):
    movie_id: int = Field(...)
    media_type: str = Field(default="movie")


# ── Response models ──────────────────────────────────────────────

class CollectionMovieOut(BaseModel):
    """Minimal movie info embedded in collection items."""
    id: int
    title: str
    poster_path: Optional[str] = None
    media_type: str = "movie"
    release_year: Optional[int] = None
    vote_average: Optional[float] = None

    model_config = {"from_attributes": True}


class CollectionItemOut(BaseModel):
    """Single item inside a collection."""
    id: UUID
    movie_id: int
    media_type: str = "movie"
    added_at: datetime
    movie: Optional[CollectionMovieOut] = None

    model_config = {"from_attributes": True}


class CollectionOut(BaseModel):
    """Collection summary — used in list view (no items, has cover_posters)."""
    id: UUID
    name: str
    description: Optional[str] = None
    item_count: int = 0
    cover_posters: list[str] = []   # up to 6 poster_paths for collage
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CollectionDetail(BaseModel):
    """Full collection with paginated items."""
    id: UUID
    name: str
    description: Optional[str] = None
    item_count: int = 0
    cover_posters: list[str] = []
    created_at: datetime
    updated_at: datetime
    items: list[CollectionItemOut] = []

    model_config = {"from_attributes": True}


class CollectionsListResponse(BaseModel):
    collections: list[CollectionOut]
    total: int


class MovieCollectionStatus(BaseModel):
    """Tells caller which collections contain a given movie."""
    id: UUID
    name: str
    has_movie: bool


class MovieStatusResponse(BaseModel):
    movie_id: int
    media_type: str = "movie"
    collections: list[MovieCollectionStatus]
