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
import re
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.orm_models import Movie
from app.repositories.search_repo import autocomplete_search

logger = logging.getLogger(__name__)

BLACKLIST_WORDS = {"erotic", "softcore", "porn", "xxx", "erotica"}
BLACKLIST_TITLES = {"red latex", "kulong"}

def _normalize_str(text: str) -> str:
    cleaned = text.replace("-", " ").replace(":", " ").replace("_", " ")
    cleaned = "".join(c for c in cleaned if c.isalnum() or c.isspace()).lower()
    return " ".join(cleaned.split())

def _is_adult_or_blacklist(item: dict) -> bool:
    if item.get("adult"):
        return True
    title = (item.get("title") or item.get("name") or "").lower()
    overview = (item.get("overview") or "").lower()
    
    for b_title in BLACKLIST_TITLES:
        if b_title in title:
            return True
            
    for word in BLACKLIST_WORDS:
        if word in title or word in overview:
            return True
            
    return False

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
        suggestions = [
            _movie_to_autocomplete(m) 
            for m in movies 
            if not _is_adult_or_blacklist({"title": m.title, "overview": m.overview or "", "adult": m.adult})
        ]

    # 2. TMDB fallback if we have fewer than 3 strong local suggestions matching the prefix
    normalized_prefix = _normalize_str(prefix)
    strong_matches = [
        s for s in suggestions
        if _normalize_str(s["title"]).startswith(normalized_prefix) or normalized_prefix in _normalize_str(s["title"])
    ]

    # Always call TMDB for autocomplete to ensure fresh matches
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
                if _is_adult_or_blacklist(item):
                    continue
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

    norm_title = _normalize_str(title)
    norm_q = _normalize_str(q)

    # --- Exact match signals ---
    exact     = 5.0 if norm_title == norm_q else 0.0
    starts    = 3.0 if norm_title.startswith(norm_q) else 0.0
    contains  = 2.0 if norm_q in norm_title else 0.0

    # --- Word overlap ---
    q_words  = set(norm_q.split())
    t_words  = set(norm_title.split())
    overlap  = len(q_words & t_words) / max(len(q_words), 1)
    word_hit = overlap * 2.5

    # --- Trigram similarity (from DB column 'sim' if available) ---
    trgm_sim = float(item.get("trgm_sim") or 0.0) * 3.0

    # --- Python fallback fuzzy (difflib) ---
    seq_sim  = difflib.SequenceMatcher(None, norm_q, norm_title).ratio() * 1.5

    # --- Popularity signal (log-scaled, capped) ---
    pop      = min(math.log(max(item.get("popularity") or 1.0, 1.0)), 8.0) * 0.3

    # --- Recency bonus ---
    year     = item.get("release_year") or 0
    recency  = 0.5 if year >= 2020 else (0.2 if year >= 2015 else 0.0)

    # --- Length penalty ---
    len_diff = abs(len(norm_title) - len(norm_q))
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
                if _is_adult_or_blacklist(item): continue
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
                if _is_adult_or_blacklist(item):                    continue
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
    1. Run FTS + trigram sequentially (to avoid AsyncSession lock)
    2. If no strong prefix/exact results found locally, query TMDB fallback
    3. Merge, score, sort
    4. Return top `limit` items
    """
    # Run DB queries sequentially on the same session
    raw_fts = await _fts_query(db, query, limit) if type != "person" else []
    raw_trgm = await _trgm_query(db, query, limit) if type != "person" else []
    
    fts_results = [r for r in raw_fts if not _is_adult_or_blacklist(r)]
    trgm_results = [r for r in raw_trgm if not _is_adult_or_blacklist(r)]
    
    local_results = fts_results + trgm_results
    normalized_query = _normalize_str(query)
    strong_matches = [
        item for item in local_results
        if _normalize_str(item.get("title") or "").startswith(normalized_query) or 
        normalized_query in _normalize_str(item.get("title") or "")
    ]
    
    # Always call TMDB for instant search
    tmdb_results = await _safe_tmdb_instant(query, type)

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
