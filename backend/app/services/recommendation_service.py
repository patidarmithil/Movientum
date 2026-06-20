"""
Movientum — Recommendation Service (Simplified)

get_personalized_recommendations(db, user_id)
    → genre-affinity picks from watch history
    → fallback: trending if < 3 watched
    → returns up to 40 items
    → source tag: "genre_affinity" | "trending_fallback"

get_similar_items(db, item_id, media_type, user_id)
    → delegates to simple pipeline in advanced_recs
    → returns flat list of up to 40 items

Removed:
  - Click profile integration
  - Complex multi-factor scoring
  - High-interest item injection
  - Bucket splitting
"""
import logging
import asyncio
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.orm_models import Movie, MovieGenre, WatchHistory
from app.routers.movies import get_trending
from app.routers.search import _tmdb_to_search_result
from app.services.tmdb_service import tmdb_service as _tmdb

logger = logging.getLogger(__name__)

_REC_TARGET = 40
_MIN_WATCHED_FOR_AFFINITY = 3


# ── Helpers ───────────────────────────────────────────────────────

def _movie_to_dict(movie: Movie) -> dict:
    """Serialize Movie ORM → dict compatible with MovieListItem schema."""
    genres = [mg.genre.name for mg in (movie.genres or [])]
    genre_ids = [mg.genre_id for mg in (movie.genres or [])]
    release_year = movie.release_date.year if movie.release_date else None
    return {
        "id": movie.id,
        "title": movie.title,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "release_year": release_year,
        "genres": genres,
        "genre_ids": genre_ids,
        "vote_average": float(movie.vote_average or 0),
        "vote_count": int(movie.vote_count or 0),
        "popularity": float(movie.popularity or 0),
        "media_type": getattr(movie, "type", "movie"),
    }


def _passes_quality(m: dict) -> bool:
    if float(m.get("vote_average", 0)) < 6.5:
        return False
    if int(m.get("vote_count", 0)) < 100:
        return False
    if not m.get("poster_path"):
        return False
    return True


def _compute_score(item: dict, user_genre_profile: dict) -> float:
    """
    score = genre_match * 0.7 + rating * 0.3
    + optional small user genre boost
    """
    genre_ids = set(item.get("genre_ids", []))
    rating_score = float(item.get("vote_average", 0)) / 10.0

    # Genre match = how well this item matches user's top genres
    genre_match = 0.0
    if user_genre_profile and genre_ids:
        genre_match = min(sum(user_genre_profile.get(gid, 0.0) for gid in genre_ids), 1.0)

    return (genre_match * 0.7) + (rating_score * 0.3)


# ── Public service functions ─────────────────────────────────────

async def get_personalized_recommendations(
    db: AsyncSession,
    user_id: UUID,
    offset: int = 0,
    limit: int = 40,
) -> dict:
    """
    Personalized picks for authenticated user.

    Pipeline:
    1. Count watched movies. If < 3 → trending fallback.
    2. Build genre profile from watch history (normalized freq).
    3. Fetch unwatched movies in matching genres from local DB.
    4. Backfill with TMDB discover if < 20 local results.
    5. Quality filter + deduplicate.
    6. Score: genre_match * 0.7 + rating * 0.3.
    7. Sort descending, return top 40.

    Returns: {movies: [...], source: str}
    """
    # Step 1 — Count watched
    count_stmt = select(func.count(WatchHistory.id)).where(WatchHistory.user_id == user_id)
    watched_count = (await db.execute(count_stmt)).scalar_one()

    if watched_count < _MIN_WATCHED_FOR_AFFINITY:
        trending_data = await get_trending(db=None)
        trending_movies = trending_data.get("movies", [])
        logger.info("RECS_GENERATED", extra={"user_id": str(user_id), "source": "trending_fallback", "count": len(trending_movies)})
        return {"movies": trending_movies, "source": "trending_fallback"}

    # Step 2 — Build genre profile from watch history
    watched_ids_stmt = select(WatchHistory.movie_id).where(WatchHistory.user_id == user_id)
    watched_result = await db.execute(watched_ids_stmt)
    watched_ids: list[int] = list(watched_result.scalars().all())
    watched_set = set(watched_ids)

    genre_cnt_stmt = (
        select(MovieGenre.genre_id, func.count(MovieGenre.genre_id).label("cnt"))
        .where(MovieGenre.movie_id.in_(watched_ids))
        .group_by(MovieGenre.genre_id)
    )
    genre_cnt_res = await db.execute(genre_cnt_stmt)
    genre_counts = {row.genre_id: row.cnt for row in genre_cnt_res.all()}
    total = sum(genre_counts.values())

    if not genre_counts or total == 0:
        # No usable genre data — trending fallback
        trending_data = await get_trending(db=None)
        trending_movies = trending_data.get("movies", [])
        logger.info("RECS_GENERATED", extra={"user_id": str(user_id), "source": "trending_fallback", "count": len(trending_movies)})
        return {"movies": trending_movies, "source": "trending_fallback"}

    user_genre_profile = {gid: cnt / total for gid, cnt in genre_counts.items()}
    candidate_genre_ids = set(user_genre_profile.keys())

    # Step 3 — Fetch unwatched candidates from local DB (top 100 by popularity)
    genre_movie_ids_stmt = (
        select(MovieGenre.movie_id)
        .where(MovieGenre.genre_id.in_(candidate_genre_ids))
        .where(MovieGenre.movie_id.not_in(watched_ids))
        .distinct()
    )
    genre_movie_ids_res = await db.execute(genre_movie_ids_stmt)
    candidate_ids = [row.movie_id for row in genre_movie_ids_res.all()]

    local_movies: list[dict] = []
    if candidate_ids:
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .where(Movie.id.in_(candidate_ids))
            .order_by(Movie.popularity.desc())
            .offset(offset)
            .limit(max(150, limit))
        )
        result = await db.execute(stmt)
        local_movies = [_movie_to_dict(m) for m in result.scalars().all()]

    # Step 4 — Backfill with TMDB discover if needed
    if len(local_movies) < 20:
        top_genre_ids_str = ",".join(
            str(gid) for gid, _ in sorted(user_genre_profile.items(), key=lambda x: x[1], reverse=True)[:3]
        )
        try:
            discover_results = await asyncio.gather(
                _tmdb.discover_movies(top_genre_ids_str),
                _tmdb.discover_tv(top_genre_ids_str),
                return_exceptions=True,
            )
            tmdb_movies = discover_results[0].get("results", []) if isinstance(discover_results[0], dict) else []
            tmdb_tv = discover_results[1].get("results", []) if isinstance(discover_results[1], dict) else []

            for m in tmdb_movies:
                m["media_type"] = "movie"
                local_movies.append(_tmdb_to_search_result(m))
            for t in tmdb_tv:
                t["media_type"] = "tv"
                local_movies.append(_tmdb_to_search_result(t))
        except Exception as e:
            logger.warning(f"TMDB discover backfill failed: {e}")

    # Step 5 — Quality filter + deduplicate (skip watched movies)
    seen: set[str] = set()
    unique: list[dict] = []
    for m in local_movies:
        if m.get("media_type", "movie") == "movie" and m["id"] in watched_set:
            continue
        if not _passes_quality(m):
            continue
        key = f"{m['id']}_{m.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            unique.append(m)

    # Step 6 — Score
    for m in unique:
        m["_score"] = _compute_score(m, user_genre_profile)

    # Step 7 — Sort + limit
    unique.sort(key=lambda x: x["_score"], reverse=True)
    final = unique[:limit]

    for m in final:
        m.pop("_score", None)

    logger.info("RECS_GENERATED", extra={"user_id": str(user_id), "source": "genre_affinity", "count": len(final)})
    return {"movies": final, "source": "genre_affinity"}


async def get_similar_items(
    db: AsyncSession,
    item_id: int,
    media_type: str = "movie",
    user_id: Optional[UUID] = None,
) -> list[dict]:
    """
    Fetch similar items using simplified pipeline.
    Returns flat list of up to 40 items.
    """
    from app.services.advanced_recs import get_advanced_similar_items

    buckets = await get_advanced_similar_items(db, item_id, media_type, user_id)

    # Flatten buckets → flat list (backward compat)
    final_list: list[dict] = []
    final_list.extend(buckets.get("bucket_1", []))
    final_list.extend(buckets.get("bucket_2", []))
    final_list.extend(buckets.get("bucket_3", []))
    return final_list


# ── Phase 5 Baseline Adapters ─────────────────────────────────────
# These thin wrappers expose a consistent interface for the TDI blending layer.

async def get_baseline_recommendations(
    db: AsyncSession,
    user_id: Optional[UUID] = None,
    limit: int = 30,
    offset: int = 0,
) -> list[dict]:
    """
    Phase 5 adapter: returns a flat list of up to `limit` baseline recommendations.
    Delegates to get_personalized_recommendations() when user_id is provided,
    or fetches trending for anonymous users.
    """
    if user_id is None:
        # Anonymous fallback — trending
        try:
            from app.routers.movies import get_trending
            data = await get_trending(db=None)
            return data.get("movies", [])[offset : offset + limit]
        except Exception as e:
            logger.warning("Baseline trending fallback failed: %s", e)
            return []

    result = await get_personalized_recommendations(db, user_id=user_id, limit=limit, offset=offset)
    movies = result.get("movies", [])
    return movies[:limit]


async def get_baseline_similar_items(
    db: AsyncSession,
    item_id: int,
    media_type: str = "movie",
    user_id: Optional[UUID] = None,
    limit: int = 80,
) -> list[dict]:
    """
    Phase 5 adapter: returns a flat list of up to `limit` baseline similar items.
    Delegates to get_similar_items() (the existing TMDB-based pipeline).
    """
    items = await get_similar_items(db, item_id=item_id, media_type=media_type, user_id=user_id)
    return items[:limit]


async def get_user_language_profile(
    db: AsyncSession,
    user_id: UUID,
) -> dict:
    """
    Computes the frequency of each original_language in the user's watch history.
    """
    from app.db.orm_models import WatchHistory, Movie
    try:
        stmt = (
            select(Movie.original_language, func.count(Movie.id).label("cnt"))
            .select_from(WatchHistory)
            .join(Movie, WatchHistory.movie_id == Movie.id)
            .where(WatchHistory.user_id == user_id)
            .where(Movie.original_language.is_not(None))
            .group_by(Movie.original_language)
        )
        res = await db.execute(stmt)
        counts = {row.original_language: row.cnt for row in res.all()}
        total = sum(counts.values())
        if total == 0:
            return {}
        return {lang: cnt / total for lang, cnt in counts.items()}
    except Exception as e:
        logger.warning(f"Failed to get user language profile: {e}")
        return {}


async def get_user_watch_seed(
    db: AsyncSession,
    user_id: UUID,
    offset: int = 0,
) -> Optional[dict]:
    """
    Returns the most recently watched/rated ContentCatalog-compatible item for a user.
    Used as the origin item for ML pipeline personalised recs.

    Returns a dict with {tmdb_id, media_type} or None if no history.
    Falls back to most recently watched movie from `watch_history` table.
    """
    from app.db.orm_models import WatchHistory, Movie

    try:
        count_stmt = select(func.count(WatchHistory.id)).where(WatchHistory.user_id == user_id)
        count = (await db.execute(count_stmt)).scalar_one()
        if count == 0:
            return None
            
        real_offset = offset % count

        stmt = (
            select(WatchHistory.movie_id)
            .where(WatchHistory.user_id == user_id)
            .order_by(WatchHistory.watched_at.desc())
            .offset(real_offset)
            .limit(1)
        )
        result = await db.execute(stmt)
        movie_id = result.scalar_one_or_none()

        if movie_id is None:
            return None

        # Fetch media_type from movies table
        movie_stmt = select(Movie.id, Movie.type).where(Movie.id == movie_id)
        movie_result = await db.execute(movie_stmt)
        row = movie_result.first()

        if row is None:
            return None

        return {"tmdb_id": row.id, "media_type": row.type or "movie"}

    except Exception as e:
        logger.warning("get_user_watch_seed failed for user %s: %s", user_id, e)
        return None
