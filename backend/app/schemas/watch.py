"""
Movientum — Watch Schemas (Phase 3.3)

WatchHistory + Watchlist request/response models.
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


from app.schemas.movie import MovieListItem


# ── Watch History ────────────────────────────────────────────────

class WatchMarkRequest(BaseModel):
    movie_id: int = Field(..., gt=0)
    watch_source: Optional[str] = Field(None, max_length=50)  # theater, netflix, etc.
    rewatched: bool = False


class WatchHistoryItem(BaseModel):
    id: UUID
    movie_id: int
    user_id: UUID
    watched_at: datetime
    watch_source: Optional[str] = None
    rewatched: bool = False
    movie: Optional[MovieListItem] = None

    model_config = {"from_attributes": True}


class WatchHistoryResponse(BaseModel):
    history: list[WatchHistoryItem]
    total: int
    page: int
    limit: int


# ── Watchlist ────────────────────────────────────────────────────

class WatchlistAddRequest(BaseModel):
    movie_id: int = Field(..., gt=0)


class WatchlistItem(BaseModel):
    id: UUID
    movie_id: int
    user_id: UUID
    added_at: datetime
    movie: Optional[MovieListItem] = None

    model_config = {"from_attributes": True}


class WatchlistResponse(BaseModel):
    watchlist: list[WatchlistItem]
    total: int
    page: int
    limit: int


# ── Status ───────────────────────────────────────────────────────

class WatchStatusResponse(BaseModel):
    movie_id: int
    watched: bool
    watchlisted: bool
