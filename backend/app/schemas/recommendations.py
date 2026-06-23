from typing import List, Optional
from pydantic import BaseModel, conlist

class ContentBasketItem(BaseModel):
    tmdb_id: int
    media_type: str  # "movie" | "tv"

class ContentBasketRequest(BaseModel):
    items: conlist(ContentBasketItem, min_length=1, max_length=10)
    page: int = 1
