"""
Movientum — Person Router (Person Page Credits System Redesign)

Endpoints:
  GET /api/v1/person/{id}          → person detail (TMDB live)
  GET /api/v1/person/{id}/credits  → person top cast credits sorted by popularity (TMDB live)

Cache: 
  tmdb:person:{id}        → TTL 24 hours
  person:{id}:credits     → TTL 1 hour
No DB writes — TMDB-only passthrough.
"""
import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, HTTPException

from app.db.cache import get_cached, set_cached
from app.services.tmdb_service import tmdb_service as tmdb

logger = logging.getLogger(__name__)

router = APIRouter()

TTL_PERSON = 86400          # 24 hours
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"


def _img(path: Optional[str], size: str = "w300") -> Optional[str]:
    return f"{TMDB_IMAGE_BASE}/{size}{path}" if path else None


def _cache_key(person_id: int) -> str:
    return f"tmdb:person:{person_id}"


@router.get("/{person_id}", summary="Person detail (TMDB)")
async def get_person(person_id: int):
    """
    Fetch person biography and basic details.
    Cached 24 h in Redis. No DB involved.
    """
    key = _cache_key(person_id)
    cached = await get_cached(key)
    if cached:
        return cached

    details = await tmdb.fetch_person_details(person_id)
    if not details:
        raise HTTPException(status_code=404, detail=f"Person {person_id} not found")

    # Calculate age
    age = _calc_age(details.get("birthday"), details.get("deathday"))

    data = {
        "id": details["id"],
        "name": details.get("name", ""),
        "biography": details.get("biography") or "",
        "birthday": details.get("birthday"),
        "deathday": details.get("deathday"),
        "age": age,
        "place_of_birth": details.get("place_of_birth"),
        "profile_path": _img(details.get("profile_path"), "w300"),
        "known_for_department": details.get("known_for_department"),
    }
    if data.get("known_for_department"):
        await set_cached(key, data, TTL_PERSON)
    else:
        await set_cached(key, data, 600)  # Short TTL for incomplete data
    return data


def _person_credit_score(item: dict) -> float:
    pop = item.get("popularity", 0.0) or 0.0
    media_type = item.get("media_type", "movie")
    
    if media_type == "movie":
        order = item.get("order")
        if order is None:
            factor = 0.1
        elif order <= 2:
            factor = 1.0
        elif order <= 5:
            factor = 0.8
        elif order <= 10:
            factor = 0.5
        elif order <= 15:
            factor = 0.2
        else:
            factor = 0.05
    else:  # tv
        episodes = item.get("episode_count", 0) or 0
        if episodes >= 15:
            factor = 1.0
        elif episodes >= 8:
            factor = 0.8
        elif episodes >= 4:
            factor = 0.5
        elif episodes >= 3:
            factor = 0.2
        else:
            factor = 0.05
            
    return pop * factor


@router.get("/{person_id}/credits", summary="Person cast credits (TMDB)")
async def get_person_credits(person_id: int):
    """
    Fetch person cast credits sorted by prominence-weighted popularity.
    Cached 1 hour in Redis.
    """
    cache_key = f"person:{person_id}:credits:v3"
    cached = await get_cached(cache_key)
    if cached:
        return cached

    credits = await tmdb.fetch_person_credits(person_id)
    if not credits:
        return []

    cast_credits = credits.get("cast", [])

    # Deduplicate by id + media_type, keeping highest popularity
    deduped_map = {}
    for w in cast_credits:
        id_ = w.get("id")
        media_type = w.get("media_type", "movie")
        if not id_:
            continue
        key = (id_, media_type)
        pop = w.get("popularity", 0.0) or 0.0
        if key not in deduped_map or pop > deduped_map[key].get("popularity", 0.0):
            deduped_map[key] = w
    deduped = list(deduped_map.values())

    # Filter out low-quality entries, self appearances, talk/reality/documentary/news genres
    filtered = []
    for w in deduped:
        pop = w.get("popularity", 0.0) or 0.0
        if pop < 1.0:
            continue
        
        # Exclude self/himself/herself guest appearances
        char_lower = (w.get("character") or "").lower()
        if "self" in char_lower or "himself" in char_lower or "herself" in char_lower:
            continue
            
        # Exclude talk (10767), reality (10764), documentary (99), news (10763)
        genres = w.get("genre_ids", []) or []
        if any(g_id in genres for g_id in [10767, 10764, 99, 10763]):
            continue
            
        filtered.append(w)

    # Sort by prominence-weighted popularity score
    filtered.sort(key=_person_credit_score, reverse=True)

    # Slice top 16
    top_credits = filtered[:16]

    # Normalize fields
    normalized = []
    for w in top_credits:
        # Skip items without poster_path
        if not w.get("poster_path"):
            continue

        date_str = w.get("release_date") if w.get("media_type") == "movie" else w.get("first_air_date")
        release_year = date_str[:4] if date_str and len(date_str) >= 4 else None

        normalized.append({
            "id": w["id"],
            "title": w.get("title") or w.get("name", ""),
            "poster_path": _img(w.get("poster_path"), "w185"),
            "release_year": release_year,
            "media_type": w.get("media_type", "movie"),
            "popularity": w.get("popularity", 0.0) or 0.0
        })

    if normalized:
        await set_cached(cache_key, normalized, 3600)  # 1 hour
    return normalized


def _year(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        return int(date_str[:4])
    except (ValueError, TypeError):
        return None


def _calc_age(birthday: Optional[str], deathday: Optional[str]) -> Optional[int]:
    if not birthday:
        return None
    try:
        from datetime import date
        bday = date.fromisoformat(birthday)
        end  = date.fromisoformat(deathday) if deathday else date.today()
        return (end - bday).days // 365
    except Exception:
        return None
