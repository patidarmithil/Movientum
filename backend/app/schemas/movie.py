"""
Movientum — Movie Schemas (Pydantic)
Phase 2B: Response models for /api/v1/movies endpoints.
"""
from pydantic import BaseModel, model_validator
from typing import List, Optional


class MovieListItem(BaseModel):
    """Minimal movie data for list/grid views."""
    id: int
    title: str
    poster_path: Optional[str] = None
    backdrop_path: Optional[str] = None
    release_year: Optional[int] = None
    genres: List[str] = []
    vote_average: Optional[float] = None
    overview: Optional[str] = None
    popularity: Optional[float] = None
    media_type: Optional[str] = "movie"
    release_date: Optional[str] = None

    model_config = {"from_attributes": True}

    @model_validator(mode="before")
    @classmethod
    def serialize_from_orm(cls, data):
        if hasattr(data, "__table__") or hasattr(data, "_sa_instance_state"):
            genres = []
            if hasattr(data, "genres") and data.genres:
                genres = [mg.genre.name for mg in data.genres if hasattr(mg, "genre") and mg.genre]
            return {
                "id": data.id,
                "title": data.title,
                "poster_path": data.poster_path,
                "backdrop_path": data.backdrop_path,
                "release_year": data.release_date.year if getattr(data, "release_date", None) else None,
                "release_date": str(data.release_date) if getattr(data, "release_date", None) else None,
                "genres": genres,
                "vote_average": data.vote_average,
            }
        return data


class MovieDetail(MovieListItem):
    """Full movie data for detail page."""
    runtime: Optional[int] = None
    directors: List[str] = []
    vote_count: Optional[int] = None
    original_language: Optional[str] = None


class MovieListResponse(BaseModel):
    """Paginated list response."""
    movies: List[MovieListItem]
    total: int
    page: int
    limit: int


class TrendingResponse(BaseModel):
    """Trending endpoint response."""
    movies: List[MovieListItem]
