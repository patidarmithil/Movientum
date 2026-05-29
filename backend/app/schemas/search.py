"""
Movientum — Search Schemas (Phase 3.2)

SearchResult         → single movie in search results
SearchResponse       → paginated search endpoint response
AutocompleteItem     → single autocomplete suggestion
AutocompleteResponse → list of autocomplete items
"""
from typing import List, Optional
from pydantic import BaseModel


class SearchResult(BaseModel):
    """Movie item returned from full-text search."""
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


class SearchResponse(BaseModel):
    """Paginated search results response."""
    results: List[SearchResult]
    total: int
    page: int
    limit: int
    query: str


class AutocompleteItem(BaseModel):
    """Single title autocomplete suggestion."""
    id: int
    title: str
    release_year: Optional[int] = None
    poster_path: Optional[str] = None
    media_type: Optional[str] = "movie"


class AutocompleteResponse(BaseModel):
    """Autocomplete endpoint response."""
    suggestions: List[AutocompleteItem]
    query: str


# ── Wrapped response models (consistent { "data": ... } envelope) ──

class WrappedSearchResponse(BaseModel):
    data: SearchResponse


class WrappedAutocompleteResponse(BaseModel):
    data: AutocompleteResponse
