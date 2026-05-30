"""
Movientum — Similar Items Service (Upgraded 11-step pipeline)

Final Pipeline:
1. Fetch (max 3 TMDB calls)
2. Merge results
3. Apply hard filters
4. Apply pre-rank filtering
5. Score items
6. Apply personalization boost
7. Sort by score
8. Apply diversity (after top 10)
9. Slice to 40 results
10. Cache final output (handled by router mostly, but we can do internal cache too)
"""
import asyncio
import logging
import math
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.cache import get_cached, set_cached
from app.db.orm_models import Movie, MovieGenre, WatchHistory
from app.services.tmdb_service import tmdb_service as _tmdb
from app.routers.search import _tmdb_to_search_result

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────

async def safe_tmdb_call(coro, default=None, timeout: float = 4.0):
    """Run a TMDB coroutine with timeout. Returns default on failure."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception as e:
        logger.warning(f"TMDB call failed: {type(e).__name__} {e}")
        return default


def _local_movie_to_dict(movie) -> dict:
    genres = [mg.genre.name for mg in (movie.genres or [])]
    release_year = movie.release_date.year if movie.release_date else None
    return {
        "id": movie.id,
        "title": movie.title,
        "name": movie.title,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "release_year": release_year,
        "genres": genres,
        "vote_average": float(movie.vote_average or 0),
        "vote_count": int(movie.vote_count or 0),
        "popularity": float(movie.popularity or 0),
        "media_type": getattr(movie, "type", "movie"),
        "genre_ids": [mg.genre_id for mg in (movie.genres or [])],
    }



def _passes_hard_guards(item: dict, exclude_id: int) -> bool:
    """Hard filters: has poster, vote_count >= 30, not itself."""
    if item.get("id") == exclude_id:
        return False
    if not item.get("poster_path"):
        return False
    if int(item.get("vote_count", 0)) < 30:
        return False
    return True


def passes_intensity_filter(cand_genres: set, current_genre_ids: set) -> bool:
    """Conditional intensity filter based on the source genres."""
    if not current_genre_ids:
        return True

    action_genres = {28, 12, 53, 878, 27, 14}
    calm_genres = {18, 99, 36, 10751, 10749, 10402}
    comedy_genre = {35}

    is_action_source = bool(current_genre_ids & action_genres)
    is_comedy_source = 35 in current_genre_ids
    is_calm_source = not is_action_source and not is_comedy_source

    if is_calm_source:
        # Calm filter: exclude Action (28), Horror (27), Thriller (53)
        if cand_genres & {28, 27, 53}:
            return False
    if is_action_source:
        # Action filter: must have at least one action-intensity genre
        if not (cand_genres & action_genres):
            return False
    if is_comedy_source:
        # Comedy filter: must have comedy
        if 35 not in cand_genres:
            return False
            
    return True


def _passes_strict_filter(item: dict, current_genre_ids: set) -> bool:
    """Strict quality, genre match, context, and intensity filters."""
    # Rating filter >= 6.5
    if float(item.get("vote_average", 0)) < 6.5:
        return False
        
    if not current_genre_ids:
        return True
        
    cand_genres = set(item.get("genre_ids", []))
    matched_genres = cand_genres & current_genre_ids
    
    # >= 2 genre match (dynamic)
    required_matches = min(2, len(current_genre_ids))
    if len(matched_genres) < required_matches:
        return False
        
    # Remove weak-only genres (Drama/Comedy only) & context filter
    if matched_genres.issubset({18, 35}):
        return False
        
    # Intensity filter
    if not passes_intensity_filter(cand_genres, current_genre_ids):
        return False
        
    return True


def _compute_score(item: dict, current_genre_ids: set) -> float:
    """
    score = 0.50 * genre_match + 0.25 * rating_score + 0.15 * popularity_score + 0.10 * recency_score
    """
    cand_genres = set(item.get("genre_ids", []))
    if current_genre_ids:
        genre_match = len(cand_genres & current_genre_ids) / len(current_genre_ids)
    else:
        genre_match = 0.0

    rating_score = float(item.get("vote_average", 0)) / 10.0
    popularity_score = math.log1p(float(item.get("popularity", 0)))
    
    # Recency score
    release_year = item.get("release_year")
    if not release_year:
        try:
            date_str = item.get("release_date") or item.get("first_air_date")
            if date_str:
                release_year = int(date_str.split("-")[0])
        except (ValueError, AttributeError):
            pass
            
    current_year = datetime.now().year
    recency_score = 0.0
    if release_year:
        years_old = current_year - release_year
        recency_score = max(0.0, 1.0 - (years_old * 0.02))
        
    return (0.50 * genre_match) + (0.25 * rating_score) + (0.15 * popularity_score) + (0.10 * recency_score)


async def _get_user_genre_profile(db: AsyncSession, user_id: UUID) -> dict:
    """Normalized genre freq from watch history. genre_id → fraction."""
    try:
        watched_stmt = select(WatchHistory.movie_id).where(WatchHistory.user_id == user_id)
        watched_result = await db.execute(watched_stmt)
        watched_ids = list(watched_result.scalars().all())
        if not watched_ids:
            return {}

        genre_stmt = (
            select(MovieGenre.genre_id, func.count(MovieGenre.genre_id).label("cnt"))
            .where(MovieGenre.movie_id.in_(watched_ids))
            .group_by(MovieGenre.genre_id)
        )
        genre_res = await db.execute(genre_stmt)
        counts = {row.genre_id: row.cnt for row in genre_res.all()}
        total = sum(counts.values())
        if total == 0:
            return {}
        return {gid: cnt / total for gid, cnt in counts.items()}
    except Exception as e:
        logger.warning(f"_get_user_genre_profile failed: {e}")
        return {}


# ── Main Entry ────────────────────────────────────────────────────

async def get_advanced_similar_items(
    db: AsyncSession,
    item_id: int,
    media_type: str,
    user_id: Optional[UUID] = None,
) -> dict:
    """
    11-step similar items pipeline (refactored to two-stage filtering & relaxation).
    Returns flat list of up to 40 items wrapped in bucket keys for backward compatibility.
    """
    cache_key = f"rec:item:{item_id}:{media_type}:{user_id or 'guest'}"
    cached = await get_cached(cache_key)
    if cached:
        return cached

    current_genre_ids: set = set()
    # STEP 1: Fetch item detail to get genres
    # First attempt to load genres from local DB to save API calls and provide immediate backup
    try:
        stmt = select(MovieGenre.genre_id).where(MovieGenre.movie_id == item_id)
        res = await db.execute(stmt)
        current_genre_ids = set(res.scalars().all())
    except Exception as e:
        logger.warning(f"Failed to query local movie genres for {item_id}: {e}")

    # If not found locally, fetch details from TMDB
    if not current_genre_ids:
        detail = await safe_tmdb_call(
            _tmdb.fetch_movie_detail(item_id) if media_type == "movie" else _tmdb.fetch_tv_detail(item_id),
            default=None,
            timeout=5.0,
        )
        if detail and isinstance(detail, dict):
            current_genre_ids = {g["id"] for g in detail.get("genres", [])}

    genre_ids_str = ",".join(str(g) for g in current_genre_ids) if current_genre_ids else ""
    cross_type = "tv" if media_type == "movie" else "movie"

    # Concurrently fetch TMDB candidates
    rec_coro = (
        _tmdb.fetch_movie_recommendations(item_id)
        if media_type == "movie"
        else _tmdb.fetch_tv_recommendations(item_id)
    )
    sim_coro = (
        _tmdb.fetch_similar_movies(item_id)
        if media_type == "movie"
        else _tmdb.fetch_similar_tv(item_id)
    )
    cross_coro = (
        _tmdb.discover_tv(genre_ids_str)
        if media_type == "movie" and genre_ids_str
        else _tmdb.discover_movies(genre_ids_str)
        if genre_ids_str
        else None
    )

    tasks = [
        safe_tmdb_call(rec_coro, default={"results": []}),
        safe_tmdb_call(sim_coro, default={"results": []}),
    ]
    if cross_coro:
        tasks.append(safe_tmdb_call(cross_coro, default={"results": []}))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    recs_raw = results[0].get("results", []) if isinstance(results[0], dict) else []
    sims_raw = results[1].get("results", []) if isinstance(results[1], dict) else []
    cross_raw = results[2].get("results", []) if len(results) > 2 and isinstance(results[2], dict) else []

    # Tag media types
    for item in recs_raw:
        item["media_type"] = media_type
    for item in sims_raw:
        item["media_type"] = media_type
    for item in cross_raw:
        item["media_type"] = cross_type

    # Merge (Order: recommendations -> discover -> similar)
    merged = recs_raw + cross_raw + sims_raw

    # deduplicate early to avoid unnecessary processing
    seen: set = set()
    unique: list[dict] = []
    for c in merged:
        key = f"{c.get('id')}_{c.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            unique.append(c)
    merged = unique

    # Hard filter (poster, vote_count)
    valid_candidates = []
    for c in merged:
        if not _passes_hard_guards(c, item_id):
            continue
        valid_candidates.append(c)

    # TWO-STAGE FILTERING & RELAXATION
    # Stage 1: Strict filter
    strict_candidates = [c for c in valid_candidates if _passes_strict_filter(c, current_genre_ids)]
    candidates = list(strict_candidates)

    # Stage 2: Relax Level 1
    if len(candidates) < 40:
        relaxed_1 = [
            c for c in valid_candidates
            if (
                len(set(c.get("genre_ids", [])) & current_genre_ids) >= 1
                and float(c.get("vote_average", 0)) >= 7.0
            )
        ]
        # deduplicated merge
        seen = {f"{c['id']}_{c.get('media_type', 'movie')}" for c in candidates}
        for c in relaxed_1:
            key = f"{c['id']}_{c.get('media_type', 'movie')}"
            if key not in seen:
                seen.add(key)
                candidates.append(c)

    # Stage 2: Relax Level 2
    if len(candidates) < 40:
        relaxed_2 = [
            c for c in valid_candidates
            if float(c.get("vote_average", 0)) >= 7.2
        ]
        # deduplicated merge
        seen = {f"{c['id']}_{c.get('media_type', 'movie')}" for c in candidates}
        for c in relaxed_2:
            key = f"{c['id']}_{c.get('media_type', 'movie')}"
            if key not in seen:
                seen.add(key)
                candidates.append(c)

    # Stage 2: Fallback
    if len(candidates) < 40:
        fallback = [
            c for c in valid_candidates
            if float(c.get("vote_average", 0)) >= 6.5
        ]
        # deduplicated merge
        seen = {f"{c['id']}_{c.get('media_type', 'movie')}" for c in candidates}
        for c in fallback:
            key = f"{c['id']}_{c.get('media_type', 'movie')}"
            if key not in seen:
                seen.add(key)
                candidates.append(c)

    # Convert candidates to frontend search result format
    candidates_formatted = [_tmdb_to_search_result(c) for c in candidates]

    # Score items (NO filtering here)
    for c in candidates_formatted:
        c["_score"] = _compute_score(c, current_genre_ids)

    # Sort descending
    candidates_formatted.sort(key=lambda x: x["_score"], reverse=True)

    # Apply personalization boost (NO filtering here)
    if user_id:
        user_profile = await _get_user_genre_profile(db, user_id)
        if user_profile:
            top_genres = sorted(user_profile.items(), key=lambda x: x[1], reverse=True)[:2]
            top_2_genre_ids = {g[0] for g in top_genres}
            
            top_half_idx = len(candidates_formatted) // 2
            for i in range(top_half_idx):
                item = candidates_formatted[i]
                cand_genres = set(item.get("genre_ids", []))
                if cand_genres & top_2_genre_ids:
                    item["_score"] *= 1.2
                    
            # Re-sort after personalization boost
            candidates_formatted.sort(key=lambda x: x["_score"], reverse=True)

    # Slice 40
    final = candidates_formatted[:40]

    # Clean internal fields
    for c in final:
        c.pop("_score", None)

    # Wrap in buckets for backward compat with router
    buckets = {
        "bucket_1": final[0:15],
        "bucket_2": final[15:30],
        "bucket_3": final[30:40],
    }

    try:
        # Cache final output (15 min = 900s)
        await set_cached(cache_key, buckets, 900)
    except Exception as e:
        logger.warning(f"Cache set failed: {e}")

    logger.info("SIMPLE_SIMILAR_ITEMS", extra={"item_id": item_id, "media_type": media_type, "count": len(final)})
    return buckets
