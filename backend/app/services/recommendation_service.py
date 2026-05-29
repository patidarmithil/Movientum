"""
Movientum — Recommendation Service (Phase 3.4)

Service layer: all DB logic for recommendations.
Routers call these functions — no raw SQL in router handlers.

get_personalized_recommendations(db, user_id)
    → genre-affinity picks (or trending fallback if < 3 watched movies)
    → always returns exactly 20 movies (backfilled with trending if needed)
    → source tag: "genre_affinity" | "trending_fallback"

get_similar_movies(db, movie_id)
    → movies sharing >=1 genre with target movie
    → excludes target movie itself
    → sorted by popularity DESC, top 10

fetch_trending(db, exclude_ids, limit)
    → internal helper: top movies by popularity, excluding given ids
"""
import logging
import asyncio
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.orm_models import Movie, MovieGenre, WatchHistory
from app.routers.movies import get_trending
from app.routers.search import _tmdb_to_search_result
from app.services.tmdb_service import tmdb_service as _tmdb

logger = logging.getLogger(__name__)

_REC_TARGET = 20
_SIMILAR_LIMIT = 10
_MIN_WATCHED_FOR_AFFINITY = 3  # below this → trending_fallback


# ── Internal helpers ─────────────────────────────────────────────

def _movie_to_dict(movie: Movie) -> dict:
    """Serialize Movie ORM → dict compatible with MovieListItem schema."""
    genres = [mg.genre.name for mg in (movie.genres or [])]
    release_year = movie.release_date.year if movie.release_date else None
    return {
        "id": movie.id,
        "title": movie.title,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "release_year": release_year,
        "genres": genres,
        "vote_average": movie.vote_average,
        "media_type": "movie",
    }


async def _fetch_trending(
    db: AsyncSession,
    exclude_ids: list[int],
    limit: int,
) -> list[Movie]:
    """
    Top movies by popularity DESC.
    Excludes movie IDs in exclude_ids list.
    """
    stmt = (
        select(Movie)
        .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
        .where(Movie.vote_count > 50)
        .order_by(Movie.popularity.desc())
        .limit(limit + len(exclude_ids) + 10)  # over-fetch, filter in Python
    )
    result = await db.execute(stmt)
    movies = result.scalars().all()
    exclude_set = set(exclude_ids)
    filtered = [m for m in movies if m.id not in exclude_set]
    return filtered[:limit]


# ── Public service functions ─────────────────────────────────────

async def get_personalized_recommendations(
    db: AsyncSession,
    user_id: UUID,
) -> dict:
    """
    Personalized picks for authenticated user.

    Algorithm:
    1. Count user's watched movies.
       - If < 3: return trending_fallback (20 movies, source="trending_fallback")
    2. Get top 3 genres from watch_history JOIN movie_genres (by frequency).
    3. Fetch movies in those genres NOT yet in watch_history, sorted by popularity DESC.
    4. If result < 20: backfill with trending (excluding already-listed + watched ids).
    5. Deduplicate by movie_id. Return exactly 20 (or all available if DB has < 20).

    Returns dict: {movies: [list of movie dicts], source: str}
    """
    # Step 1 — Count watched movies
    count_stmt = select(func.count(WatchHistory.id)).where(
        WatchHistory.user_id == user_id
    )
    watched_count = (await db.execute(count_stmt)).scalar_one()

    if watched_count < _MIN_WATCHED_FOR_AFFINITY:
        # Trending fallback — no history to personalize from
        trending_data = await get_trending(db=None)
        trending_movies = trending_data.get("movies", [])
        logger.info(
            "RECS_GENERATED",
            extra={"user_id": str(user_id), "source": "trending_fallback", "count": len(trending_movies)},
        )
        return {
            "movies": trending_movies,
            "source": "trending_fallback",
        }

    # Step 2 — Get watched movie IDs
    watched_ids_stmt = select(WatchHistory.movie_id).where(
        WatchHistory.user_id == user_id
    )
    watched_result = await db.execute(watched_ids_stmt)
    watched_ids: list[int] = list(watched_result.scalars().all())
    watched_set = set(watched_ids)

    # Step 3 — Top 3 genres by frequency in watch history
    genre_freq_stmt = (
        select(MovieGenre.genre_id, func.count(MovieGenre.genre_id).label("freq"))
        .where(MovieGenre.movie_id.in_(watched_ids))
        .group_by(MovieGenre.genre_id)
        .order_by(func.count(MovieGenre.genre_id).desc())
        .limit(3)
    )
    genre_result = await db.execute(genre_freq_stmt)
    top_genre_ids = [row.genre_id for row in genre_result.all()]

    if not top_genre_ids:
        # No genre data → fallback
        trending_data = await get_trending(db=None)
        trending_movies = trending_data.get("movies", [])
        logger.info(
            "RECS_GENERATED",
            extra={"user_id": str(user_id), "source": "trending_fallback", "count": len(trending_movies)},
        )
        return {
            "movies": trending_movies,
            "source": "trending_fallback",
        }

    # Step 4 — Movies in top genres, not yet watched
    # Subquery: movie IDs that have at least one matching genre
    genre_movie_ids_stmt = (
        select(MovieGenre.movie_id)
        .where(MovieGenre.genre_id.in_(top_genre_ids))
        .where(MovieGenre.movie_id.not_in(watched_ids))
        .distinct()
    )
    genre_movie_ids_result = await db.execute(genre_movie_ids_stmt)
    candidate_ids = [row.movie_id for row in genre_movie_ids_result.all()]

    genre_movies: list[Movie] = []
    if candidate_ids:
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .where(Movie.id.in_(candidate_ids))
            .order_by(Movie.popularity.desc())
            .limit(_REC_TARGET)
        )
        result = await db.execute(stmt)
        genre_movies = list(result.scalars().all())

    genre_movies_dicts = [_movie_to_dict(m) for m in genre_movies]

    # Step 5 — Backfill with TMDB if needed
    if len(genre_movies_dicts) < 10:
        top_genre_ids_str = ",".join(str(g) for g in top_genre_ids)
        
        # Parallel TMDB Fetch
        discover_results = await asyncio.gather(
            _tmdb.discover_movies(top_genre_ids_str),
            _tmdb.discover_tv(top_genre_ids_str),
            return_exceptions=True
        )
        
        # Parse results
        tmdb_movies = discover_results[0].get("results", []) if isinstance(discover_results[0], dict) else []
        tmdb_tv = discover_results[1].get("results", []) if isinstance(discover_results[1], dict) else []
        
        tmdb_items = []
        for m in tmdb_movies:
            m["media_type"] = "movie"
            tmdb_items.append(_tmdb_to_search_result(m))
            
        for t in tmdb_tv:
            t["media_type"] = "tv"
            tmdb_items.append(_tmdb_to_search_result(t))
            
        # Combine
        genre_movies_dicts.extend(tmdb_items)

    # Deduplicate strictly by id + media_type
    seen: set[str] = set()
    unique_movies: list[dict] = []
    
    for m in genre_movies_dicts:
        if m.get("media_type", "movie") == "movie" and m["id"] in watched_set:
            continue
            
        key = f"{m['id']}_{m.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            unique_movies.append(m)

    final = unique_movies[:_REC_TARGET]
    logger.info(
        "RECS_GENERATED",
        extra={"user_id": str(user_id), "source": "genre_affinity", "count": len(final)},
    )
    return {
        "movies": final,
        "source": "genre_affinity",
    }


async def get_similar_items(
    db: AsyncSession,
    item_id: int,
    media_type: str = "movie"
) -> list[dict]:
    """
    Fetch similar items using TMDB API.
    Interleaves movies and TV shows for cross-media recommendations.
    Returns up to 20 items.
    """
    from app.services.tmdb_service import tmdb_service as _tmdb
    import asyncio

    # Determine genres to use for cross-media discovery
    target_genres = ""
    if media_type == "movie":
        target_info = await _tmdb._get(f"/movie/{item_id}", params={"language": "en-US"})
    else:
        target_info = await _tmdb.fetch_tv_detail(item_id)
        
    if target_info and "genres" in target_info:
        target_genres = ",".join(str(g["id"]) for g in target_info["genres"])

    # Fetch parallel data
    tasks = []
    if media_type == "movie":
        tasks.append(_tmdb.fetch_similar_movies(item_id))
        tasks.append(_tmdb.discover_tv(target_genres) if target_genres else _tmdb.fetch_popular_movies(1)) # fallback if no genres
    else:
        tasks.append(_tmdb.fetch_similar_tv(item_id))
        tasks.append(_tmdb.discover_movies(target_genres) if target_genres else _tmdb.fetch_popular_movies(1))

    results = await asyncio.gather(*tasks)
    
    primary_raw = results[0].get("results", []) if results[0] else []
    secondary_raw = results[1].get("results", []) if results[1] else []

    # Map TMDB results to our schema
    from app.routers.search import _tmdb_to_search_result
    
    primary = []
    for item in primary_raw:
        item["media_type"] = media_type
        primary.append(_tmdb_to_search_result(item))
        
    secondary = []
    sec_media_type = "tv" if media_type == "movie" else "movie"
    for item in secondary_raw:
        item["media_type"] = sec_media_type
        secondary.append(_tmdb_to_search_result(item))

    # Interleave results (1 primary, 1 secondary)
    mixed = []
    max_len = max(len(primary), len(secondary))
    for i in range(max_len):
        if i < len(primary):
            mixed.append(primary[i])
        if i < len(secondary):
            mixed.append(secondary[i])

    # Filter out the target item just in case
    mixed = [m for m in mixed if m["id"] != item_id]
    
    logger.info("SIMILAR_ITEMS", extra={"item_id": item_id, "media_type": media_type, "count": len(mixed[:20])})
    return mixed[:20]
