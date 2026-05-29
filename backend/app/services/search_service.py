"""
Movientum — Search Service

Handles autocomplete logic:
  1. Check Redis cache.
  2. Query Supabase ILIKE prefix search.
  3. If suggestions < 3, call TMDB multi_search(prefix) with 2s timeout.
  4. Merge top TMDB results (no poster = skip). Deduplicate by id.
  5. Cache merged result for 5 min.
"""
import asyncio
import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.orm_models import Movie
from app.db.cache import (
    TTL_AUTOCOMPLETE,
    get_cached,
    key_search_auto,
    set_cached,
)
from app.repositories.search_repo import autocomplete_search

logger = logging.getLogger(__name__)

AUTOCOMPLETE_TMDB_THRESHOLD = 3   # fall back to TMDB if fewer local suggestions
AUTOCOMPLETE_TMDB_TIMEOUT   = 2.0 # seconds — hard limit for autocomplete TMDB call
AUTOCOMPLETE_TMDB_TOP_N     = 3   # max TMDB results to merge into suggestions


def _release_year(movie: Movie) -> Optional[int]:
    return movie.release_date.year if movie.release_date else None


def _movie_to_autocomplete(movie: Movie) -> dict:
    return {
        "id": movie.id,
        "title": movie.title,
        "release_year": _release_year(movie),
        "poster_path": movie.poster_path,
        "media_type": getattr(movie, "type", "movie"),
    }


def _tmdb_item_to_autocomplete(item: dict) -> dict:
    release_date = item.get("release_date") or item.get("first_air_date")
    release_year = None
    if release_date:
        try:
            release_year = int(release_date.split("-")[0])
        except ValueError:
            pass
    return {
        "id": item["id"],
        "title": item.get("title") or item.get("name") or "",
        "release_year": release_year,
        "poster_path": item.get("poster_path"),
        "media_type": item.get("media_type", "movie"),
    }


async def get_autocomplete_suggestions(db: AsyncSession, prefix: str) -> dict:
    prefix = prefix.strip()
    cache_key = key_search_auto(prefix)
    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return cached

    logger.info("CACHE_MISS key=%s", cache_key)

    # 1. Local Supabase query
    movies = await autocomplete_search(db, prefix)
    suggestions = [_movie_to_autocomplete(m) for m in movies]

    # 2. TMDB fallback if insufficient local suggestions
    if len(suggestions) < AUTOCOMPLETE_TMDB_THRESHOLD:
        try:
            from app.services.tmdb_service import tmdb_service as _tmdb
            tmdb_resp = await asyncio.wait_for(
                _tmdb.multi_search(prefix),
                timeout=AUTOCOMPLETE_TMDB_TIMEOUT,
            )
            if tmdb_resp and "results" in tmdb_resp:
                existing_ids = {s["id"] for s in suggestions}
                added = 0
                for item in tmdb_resp["results"]:
                    if added >= AUTOCOMPLETE_TMDB_TOP_N:
                        break
                    if item.get("media_type") not in ("movie", "tv"):
                        continue
                    if item.get("adult"):  # skip adult content
                        continue
                    if not item.get("poster_path"):  # skip items without poster
                        continue
                    if item["id"] in existing_ids:
                        continue
                    suggestions.append(_tmdb_item_to_autocomplete(item))
                    existing_ids.add(item["id"])
                    added += 1
                logger.info(
                    "AUTOCOMPLETE_TMDB prefix=%r added=%d total=%d",
                    prefix, added, len(suggestions),
                )
        except asyncio.TimeoutError:
            logger.warning("TMDB autocomplete timeout for prefix=%r", prefix)
        except Exception as exc:
            logger.warning("TMDB autocomplete error for prefix=%r: %s", prefix, exc)

    data = {
        "suggestions": suggestions,
        "query": prefix,
    }
    await set_cached(cache_key, data, TTL_AUTOCOMPLETE)
    logger.info("CACHE_SET key=%s suggestions=%d", cache_key, len(suggestions))
    return data
