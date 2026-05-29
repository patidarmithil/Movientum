"""
Movientum — Search Router (Phase 4.0)

Two public endpoints — no auth required:
  GET /api/v1/search                   → FTS ranked results (paginated)
  GET /api/v1/search/autocomplete      → top 8 title matches (cached 5min)

Search execution (Phase 4.0 — parallel):
  Supabase FTS + TMDB multi_search run CONCURRENTLY (not fallback-only).
  Results merged into single deduplicated pool → scored → sorted by relevance.

Deduplication key: f"{id}_{media_type}" to prevent movie/TV ID collisions.

Ranking: _relevance_score() — multi-factor (exact, starts-with, contains,
         word_match, fuzzy similarity, log-popularity, length_penalty).

Pre-processing: Items without poster_path removed BEFORE scoring.

TMDB timeout: 5s hard limit. On timeout → proceed with Supabase results only.

Cache: Normal results → 10 min. Empty results → 10s (short TTL, retry fast).

IMPORTANT: /autocomplete route MUST be defined BEFORE the base route
to avoid any path conflicts.
"""
import asyncio
import difflib
import logging
import math
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import AsyncSessionLocal, get_db
from app.db.orm_models import Genre, Movie, MovieGenre
from app.db.cache import (
    TTL_AUTOCOMPLETE,
    TTL_SEARCH,
    get_cached,
    key_search,
    key_search_auto,
    set_cached,
    inflight_lock,
)
from app.utils.persistence import _is_persistable
from app.schemas.search import (
    AutocompleteItem,
    AutocompleteResponse,
    SearchResponse,
    SearchResult,
    WrappedAutocompleteResponse,
    WrappedSearchResponse,
)
from app.services.search_service import get_autocomplete_suggestions

logger = logging.getLogger(__name__)
router = APIRouter()

# Short TTL used when results are empty or TMDB-fallback only
TTL_SEARCH_EMPTY = 10  # seconds — lets client retry quickly

# Popularity threshold to persist TMDB-only results to Supabase
PERSIST_POPULARITY_THRESHOLD = 20.0


# ── Relevance Scoring ────────────────────────────────────────────

def _relevance_score(item: dict, query: str) -> float:
    """
    Multi-factor relevance score. Higher = better match.
    Factors: exact title, starts-with, contains, word overlap,
             fuzzy similarity, log-popularity, length penalty.
    """
    title = (item.get("title") or "").lower()
    q = query.lower().strip()
    if not q:
        return 0.0

    exact    = 2.0 if title == q else 0.0
    starts   = 1.5 if title.startswith(q) else 0.0
    contains = 1.0 if q in title else 0.0
    words    = q.split()
    word_match = sum(1 for w in words if w in title) / max(len(words), 1)
    similarity = difflib.SequenceMatcher(None, q, title).ratio()
    pop = math.log(max(item.get("popularity") or 1.0, 1.0))
    length_penalty = 0.3 if abs(len(title) - len(q)) > 10 else 0.0

    return (
        exact      * 2.0 +
        starts     * 1.5 +
        contains   * 1.0 +
        word_match * 1.2 +
        similarity * 0.5 +
        pop        * 0.1
    ) - length_penalty


# ── Helpers ──────────────────────────────────────────────────────

def _release_year(movie: Movie) -> Optional[int]:
    return movie.release_date.year if movie.release_date else None


def _movie_to_search_result(movie: Movie) -> dict:
    genres = [mg.genre.name for mg in (movie.genres or [])]
    return {
        "id": movie.id,
        "title": movie.title,
        "name": movie.title,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "release_year": _release_year(movie),
        "genres": genres,
        "vote_average": movie.vote_average,
        "overview": movie.overview,
        "popularity": movie.popularity,
        "media_type": getattr(movie, "type", "movie"),
    }


def _movie_to_autocomplete(movie: Movie) -> dict:
    return {
        "id": movie.id,
        "title": movie.title,
        "release_year": _release_year(movie),
        "poster_path": movie.poster_path,
        "media_type": getattr(movie, "type", "movie"),
    }


def _tmdb_to_search_result(item: dict) -> dict:
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
        "name": item.get("title") or item.get("name") or "",
        "poster_path": item.get("poster_path"),
        "backdrop_path": item.get("backdrop_path"),
        "release_year": release_year,
        "release_date": release_date,
        "genres": [],
        "vote_average": item.get("vote_average", 0.0),
        "overview": item.get("overview"),
        "popularity": item.get("popularity", 0.0),
        "media_type": item.get("media_type", "movie"),
    }




async def _persist_movie_stub(item: dict):
    """
    Minimal upsert of a TMDB search result into local DB.
    Only called after _is_persistable() returns True.
    Uses INSERT ... ON CONFLICT DO NOTHING for idempotency.
    """
    from datetime import date
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    movie_id = item["id"]

    async with AsyncSessionLocal() as db:
        # Check existence first to avoid unnecessary work
        existing = await db.execute(select(Movie).where(Movie.id == movie_id))
        if existing.scalar_one_or_none():
            return

        release_date_obj = None
        if item.get("release_date"):
            try:
                release_date_obj = date.fromisoformat(item["release_date"])
            except ValueError:
                pass

        title_val = item.get("title") or ""
        overview_val = item.get("overview") or ""
        search_vector = func.to_tsvector("english", f"{title_val} {overview_val}")

        movie = Movie(
            id=movie_id,
            title=title_val,
            original_title=item.get("original_title") or title_val,
            overview=overview_val,
            release_date=release_date_obj,
            poster_path=item.get("poster_path"),
            backdrop_path=item.get("backdrop_path"),
            popularity=float(item.get("popularity") or 0.0),
            vote_average=float(item.get("vote_average") or 0.0),
            vote_count=int(item.get("vote_count") or 0),
            adult=bool(item.get("adult", False)),
            original_language=item.get("original_language"),
            search_vector=search_vector,
        )
        db.add(movie)
        try:
            await db.commit()
        except Exception as e:
            await db.rollback()
            logger.warning("Failed to persist TMDB movie id=%s: %s", movie_id, e)


async def _query_local_db(
    db: AsyncSession,
    query_str: str,
    page: int,
    limit: int,
) -> tuple[list[dict], int]:
    """Run Supabase FTS and return (results_list, total_count)."""
    tsquery = func.websearch_to_tsquery("english", query_str)
    ts_rank_expr = func.ts_rank(Movie.search_vector, tsquery)

    count_stmt = (
        select(func.count())
        .select_from(Movie)
        .where(Movie.search_vector.op("@@")(tsquery))
    )
    total = (await db.execute(count_stmt)).scalar_one()

    movies: list[Movie] = []
    if total > 0:
        offset = (page - 1) * limit
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .where(Movie.search_vector.op("@@")(tsquery))
            .order_by(
                (ts_rank_expr * func.log(Movie.popularity + 2)).desc(),
                ts_rank_expr.desc(),
            )
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(stmt)
        movies = result.scalars().all()

    return [_movie_to_search_result(m) for m in movies], total


# ── Routes ───────────────────────────────────────────────────────

@router.get(
    "/autocomplete",
    response_model=WrappedAutocompleteResponse,
    summary="Title autocomplete suggestions",
)
async def autocomplete(
    q: str = Query(..., min_length=1, description="Title prefix to autocomplete"),
    db: AsyncSession = Depends(get_db),
):
    """
    Return up to 8 movie title matches for the given prefix.
    Uses index-friendly LOWER(title) LIKE prefix pattern. Results cached for 5 minutes per prefix.
    If local suggestions < 3, falls back to TMDB multi_search with 2s timeout.
    No auth required.
    """
    prefix = q.strip()
    if not prefix:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    data = await get_autocomplete_suggestions(db, prefix)
    return {"data": data}


@router.get(
    "",
    response_model=WrappedSearchResponse,
    summary="Full-text movie search",
)
async def search_movies(
    q:     Optional[str] = Query(default=None, min_length=1, description="Search query"),
    genre: Optional[str] = Query(default=None, description="Genre name filter"),
    page:  int           = Query(default=1,  ge=1,           description="Page number"),
    limit: int           = Query(default=20, ge=1, le=100,   description="Results per page"),
    db: AsyncSession = Depends(get_db),
):
    """
    Full-text search over movie titles and overviews.
    Supports optional ?genre= filter (by genre name).
    When only genre is provided, returns top movies by popularity for that genre.

    Phase 4.0: Supabase FTS + TMDB multi_search run CONCURRENTLY.
    Results merged → pre-filtered (poster_path required) → scored by _relevance_score().
    Results cached 10 minutes. Empty results cached 10 seconds (retry fast).
    No auth required.
    """
    query_str = (q or "").strip()
    genre_str = (genre or "").strip()

    if not query_str and not genre_str:
        raise HTTPException(status_code=400, detail="Provide q or genre parameter")

    # ── Genre-only path (unchanged) ──────────────────────────────
    if genre_str and not query_str:
        cache_key = key_search(f"genre:{genre_str}:page={page}:limit={limit}")
        cached = await get_cached(cache_key)
        if cached:
            return {"data": cached}

        offset = (page - 1) * limit
        count_stmt = (
            select(func.count())
            .select_from(Movie)
            .join(Movie.genres)
            .join(MovieGenre.genre)
            .where(func.lower(Genre.name) == genre_str.lower())
        )
        total = (await db.execute(count_stmt)).scalar_one()

        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .join(Movie.genres)
            .join(MovieGenre.genre)
            .where(func.lower(Genre.name) == genre_str.lower())
            .order_by(Movie.popularity.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await db.execute(stmt)
        movies = result.scalars().unique().all()

        data = {
            "results": [_movie_to_search_result(m) for m in movies],
            "total": total,
            "page": page,
            "limit": limit,
            "query": genre_str,
        }
        await set_cached(cache_key, data, TTL_SEARCH)
        return {"data": data}

    # ── Full-text search path ────────────────────────────────────
    cache_key = key_search(f"{query_str}:page={page}:limit={limit}")
    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return {"data": cached}

    logger.info("CACHE_MISS key=%s", cache_key)

    # ── Phase 4.0: Supabase + TMDB run CONCURRENTLY ──────────────
    from app.services.tmdb_service import tmdb_service as _tmdb

    async def _safe_tmdb_search() -> Optional[dict]:
        """TMDB multi_search with hard 5s timeout. Returns None on timeout/failure."""
        try:
            return await asyncio.wait_for(
                _tmdb.multi_search(query_str),
                timeout=8.0,
            )
        except asyncio.TimeoutError:
            logger.warning("TMDB multi_search timeout for q=%r", query_str)
            return None
        except Exception as exc:
            logger.warning("TMDB multi_search error for q=%r: %s", query_str, exc)
            return None

    # Fire both concurrently
    local_results_task = asyncio.create_task(
        _query_local_db(db, query_str, page, limit)
    )
    tmdb_task = asyncio.create_task(_safe_tmdb_search())

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached:
                logger.info("CACHE_HIT (after wait) key=%s", cache_key)
                return {"data": cached}

        (local_results, local_total), tmdb_resp = await asyncio.gather(
            local_results_task, tmdb_task
        )

    # ── Pre-processing: remove items without poster_path ─────────
    local_results = [r for r in local_results if r.get("poster_path")]

    tmdb_items: list[dict] = []
    if tmdb_resp and "results" in tmdb_resp:
        for item in tmdb_resp["results"]:
            if item.get("media_type") not in ("movie", "tv"):
                continue
            if item.get("adult"):  # pre-filter: no adult content
                continue
            if not item.get("poster_path"):  # pre-filter: no poster = skip
                continue
            tmdb_items.append(item)

    # ── Merge into deduplicated pool ─────────────────────────────
    # Dedup key = id + "_" + media_type (prevents movie/TV ID collisions)
    merged: dict[str, dict] = {}
    for r in local_results:
        key = f"{r['id']}_{r.get('media_type', 'movie')}"
        merged[key] = r
    for item in tmdb_items:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in merged:
            merged[key] = _tmdb_to_search_result(item)

    # ── Sort by relevance score ───────────────────────────────────
    all_results = sorted(
        merged.values(),
        key=lambda x: _relevance_score(x, query_str),
        reverse=True,
    )

    # ── 6.2 Search Pagination Stability ─────────────────────────
    start = (page - 1) * limit
    end = start + limit
    results = all_results[start:end]

    # ── Persist qualifying TMDB-only results ─────────────────────
    # Only persist movies (not TV), only if popular + has required fields
    for item in tmdb_items:
        if item.get("media_type") == "movie" and _is_persistable(item):
            # Fire-and-forget: don't block response on DB write
            asyncio.create_task(_persist_movie_stub(item))

    # ── Cache and return ─────────────────────────────────────────
    total = max(local_total, len(all_results))

    if not results:
        # Short TTL on empty — lets client retry quickly
        await set_cached(
            cache_key,
            {"results": [], "total": 0, "page": page, "limit": limit, "query": query_str},
            TTL_SEARCH_EMPTY,
        )
        return {
            "data": {
                "results": [],
                "total": 0,
                "page": page,
                "limit": limit,
                "query": query_str,
            }
        }

    data = {
        "results": results,
        "total": total,
        "page": page,
        "limit": limit,
        "query": query_str,
    }
    await set_cached(cache_key, data, TTL_SEARCH)
    logger.info(
        "SEARCH_QUERY q=%r results=%d total=%d local=%d tmdb=%d",
        query_str, len(results), total, len(local_results), len(tmdb_items),
    )
    return {"data": data}
