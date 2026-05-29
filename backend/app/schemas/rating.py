"""
Movientum — Rating Schemas (Phase 3.3)

RatingCategory enum: 4-bucket system (no numeric scores).
"""
import enum
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field


class RatingCategory(str, enum.Enum):
    skip = "skip"
    timepass = "timepass"
    go_for_it = "go_for_it"
    perfection = "perfection"


# ── Requests ────────────────────────────────────────────────────

class RatingCreateRequest(BaseModel):
    movie_id: int = Field(..., gt=0)
    category: RatingCategory


class RatingUpdateRequest(BaseModel):
    category: RatingCategory


from app.schemas.movie import MovieListItem


# ── Responses ───────────────────────────────────────────────────

class RatingResponse(BaseModel):
    id: UUID
    movie_id: int
    user_id: UUID
    category: RatingCategory
    created_at: datetime
    updated_at: Optional[datetime] = None
    movie: Optional[MovieListItem] = None

    model_config = {"from_attributes": True}


class DistributionResponse(BaseModel):
    skip: int = 0
    timepass: int = 0
    go_for_it: int = 0
    perfection: int = 0
    total: int = 0


class UserRatingsResponse(BaseModel):
    ratings: list[RatingResponse]
    total: int
    page: int
    limit: int
