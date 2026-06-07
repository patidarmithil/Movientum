"""
Movientum — News Schemas (Pydantic v2)
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class NewsArticleOut(BaseModel):
    """Article shape returned to frontend."""
    model_config = ConfigDict(from_attributes=True)

    id:           UUID
    title:        str
    description:  Optional[str]
    url:          str
    image_url:    Optional[str]
    source_name:  Optional[str]
    source_url:   Optional[str]
    published_at: Optional[datetime]
    fetched_at:   datetime
    genre_tags:   Optional[list[str]] = []
    view_count:   int


class NewsArticlePersonalized(NewsArticleOut):
    """Article with personalization score attached (for 'For You' tab)."""
    score: float = 0.0


class NewsFeedResponse(BaseModel):
    """Paginated news feed."""
    articles: list[NewsArticleOut]
    total:    int
    page:     int
    page_size: int


class NewsPersonalizedFeedResponse(BaseModel):
    """Paginated personalized feed."""
    articles:  list[NewsArticlePersonalized]
    total:     int
    page:      int
    page_size: int
