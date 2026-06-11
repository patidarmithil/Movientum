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
from app.repositories.search_repo import autocomplete_search

logger = logging.getLogger(__name__)

AUTOCOMPLETE_TMDB_THRESHOLD = 3   # fall back to TMDB if fewer local suggestions
AUTOCOMPLETE_TMDB_TIMEOUT   = 10.0 # seconds — hard limit for autocomplete TMDB call
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


async def get_autocomplete_suggestions(db: AsyncSession, prefix: str, type: str = "content") -> dict:
    prefix = prefix.strip()

    # 1. Local Supabase query
    suggestions = []
    if type != "person":
        movies = await autocomplete_search(db, prefix)
        suggestions = [_movie_to_autocomplete(m) for m in movies]

    # 2. TMDB fallback if insufficient local suggestions
    if len(suggestions) < AUTOCOMPLETE_TMDB_THRESHOLD:
        try:
            from app.services.tmdb_service import tmdb_service as _tmdb
            tmdb_resp = await asyncio.wait_for(
                _tmdb.search_person(prefix) if type == "person" else _tmdb.multi_search(prefix),
                timeout=AUTOCOMPLETE_TMDB_TIMEOUT,
            )
            if tmdb_resp and "results" in tmdb_resp:
                existing_ids = {s["id"] for s in suggestions}
                added = 0
                for item in tmdb_resp["results"]:
                    if added >= AUTOCOMPLETE_TMDB_TOP_N:
                        break
                    if type == "person":
                        if not item.get("profile_path"): continue
                    else:
                        if item.get("media_type") not in ("movie", "tv"): continue
                        if item.get("adult"): continue
                        if not item.get("poster_path"): continue
                    if item["id"] in existing_ids:
                        continue
                    if type == "person":
                        suggestions.append({
                            "id": item["id"],
                            "title": item.get("name"),
                            "release_year": None,
                            "poster_path": item.get("profile_path"),
                            "media_type": "person",
                        })
                    else:
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
    return data

import math
import difflib

def _instant_score(item: dict, query: str) -> float:
    title = (item.get("title") or "").lower()
    q = query.lower().strip()

    # --- Exact match signals ---
    exact     = 5.0 if title == q else 0.0
    starts    = 3.0 if title.startswith(q) else 0.0
    contains  = 2.0 if q in title else 0.0

    # --- Word overlap ---
    q_words  = set(q.split())
    t_words  = set(title.split())
    overlap  = len(q_words & t_words) / max(len(q_words), 1)
    word_hit = overlap * 2.5

    # --- Trigram similarity (from DB column 'sim' if available) ---
    trgm_sim = float(item.get("trgm_sim") or 0.0) * 3.0

    # --- Python fallback fuzzy (difflib) ---
    seq_sim  = difflib.SequenceMatcher(None, q, title).ratio() * 1.5

    # --- Popularity signal (log-scaled, capped) ---
    pop      = min(math.log(max(item.get("popularity") or 1.0, 1.0)), 8.0) * 0.3

    # --- Recency bonus ---
    year     = item.get("release_year") or 0
    recency  = 0.5 if year >= 2020 else (0.2 if year >= 2015 else 0.0)

    # --- Length penalty ---
    len_diff = abs(len(title) - len(q))
    penalty  = min(len_diff * 0.05, 1.0)

    return (
        exact + starts + contains + word_hit + trgm_sim + seq_sim + pop + recency
    ) - penalty

async def _fts_query(db: AsyncSession, query: str, limit: int) -> list[dict]:
    from app.routers.search import _query_local_db
    results, _ = await _query_local_db(db, query, page=1, limit=limit)
    return results

async def _safe_tmdb_instant(query: str, type: str) -> list[dict]:
    """TMDB multi_search with hard 3s timeout. Returns [] on timeout."""
    from app.services.tmdb_service import tmdb_service
    from app.routers.search import _tmdb_to_search_result
    try:
        resp = await asyncio.wait_for(tmdb_service.search_person(query) if type == "person" else tmdb_service.multi_search(query), timeout=10.0)
        if not resp:
            return []
        items = []
        for item in (resp.get("results") or []):
            if type == "person":
                if not item.get("profile_path"): continue
                items.append({
                    "id": item["id"],
                    "title": item.get("name"),
                    "name": item.get("name"),
                    "poster_path": item.get("profile_path"),
                    "media_type": "person",
                })
            else:
                if item.get("media_type") not in ("movie", "tv"):  continue
                if not item.get("poster_path"):                     continue
                if item.get("adult"):                               continue
                items.append(_tmdb_to_search_result(item))
        return items[:10]
    except asyncio.TimeoutError:
        logger.warning(f"TMDB instant search timeout for q={query!r}")
        return []
    except Exception as e:
        logger.warning(f"TMDB instant search failed: {type(e).__name__} - {e}")
        return []

async def instant_search(db: AsyncSession, query: str, limit: int = 20, type: str = "content") -> list[dict]:
    """
    1. Run FTS + trigram sequentially (to avoid AsyncSession lock), TMDB concurrently
    2. Merge, score, sort
    3. Return top `limit` items
    """
    tmdb_task   = asyncio.create_task(_safe_tmdb_instant(query, type))
    
    # Run DB queries sequentially on the same session
    fts_results  = await _fts_query(db, query, limit) if type != "person" else []
    trgm_results = await _trgm_query(db, query, limit) if type != "person" else []
    
    tmdb_results = await tmdb_task

    # Merge by dedup key = f"{id}_{media_type}"
    merged = {}
    for item in fts_results:
        k = f"{item['id']}_{item.get('media_type','movie')}"
        merged[k] = item
    for item in trgm_results:
        k = f"{item['id']}_{item.get('media_type','movie')}"
        if k not in merged:
            merged[k] = item
    for item in tmdb_results:
        k = f"{item['id']}_{item.get('media_type','movie')}"
        if k not in merged:
            merged[k] = item

    # Score + sort
    scored = sorted(
        merged.values(),
        key=lambda x: _instant_score(x, query),
        reverse=True
    )
    return scored[:limit]

async def _trgm_query(db: AsyncSession, query: str, limit: int = 20) -> list[dict]:
    """
    Tier 2: Trigram Similarity (fuzzy matching)
    Returns items matching query via pg_trgm similarity.
    """
    from sqlalchemy import select, func
    from sqlalchemy.orm import selectinload
    from app.db.orm_models import MovieGenre
    
    # Calculate similarity on lower(title)
    q = query.lower().strip()
    sim = func.similarity(func.lower(Movie.title), q).label("sim")
    
    stmt = (
        select(Movie, sim)
        .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
        .where(func.similarity(func.lower(Movie.title), q) > 0.15)
        .where(Movie.poster_path.isnot(None))
        .where(Movie.adult == False)
        .order_by(sim.desc(), Movie.popularity.desc())
        .limit(limit)
    )
    
    result = await db.execute(stmt)
    rows = result.all()
    
    from app.routers.search import _movie_to_search_result
    
    items = []
    for row in rows:
        movie = row.Movie
        item = _movie_to_search_result(movie)
        # Store similarity for scoring later
        item["trgm_sim"] = row.sim
        items.append(item)
        
    return items
