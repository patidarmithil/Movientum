"""
Movientum — Movies Router (Phase 2B)

Three public endpoints — no auth required:
  GET /api/v1/movies          → paginated list
  GET /api/v1/movies/trending → top by vote_average * vote_count
  GET /api/v1/movies/{id}     → full detail

IMPORTANT: /trending route must be defined BEFORE /{id}
to avoid FastAPI matching "trending" as a movie id.

Cache keys from app.db.cache:
  key_movie_list(params)     → TTL 30min
  key_movie_trending()       → TTL 30min
  key_movie_detail(movie_id) → TTL 1hr
"""
import logging
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.database import AsyncSessionLocal, get_db
from app.db.orm_models import Director, Genre, Movie, MovieDirector, MovieGenre, MovieRating, TvRating
from datetime import datetime, timezone, date

def utcnow():
    return datetime.now(timezone.utc)
from app.db.cache import (
    TTL_MOVIE_DETAIL,
    TTL_MOVIE_LIST,
    TTL_TRENDING,
    TTL_TMDB_CREDITS,
    TTL_EXPLORE,
    get_cached,
    key_movie_detail,
    key_movie_list,
    key_movie_trending,
    key_movie_credits,
    key_explore_page,
    set_cached,
    inflight_lock,
)
from app.schemas.movie import (
    MovieDetail,
    MovieListItem,
    MovieListResponse,
    TrendingResponse,
)
from app.services.tmdb_service import tmdb_service as tmdb
from app.routers.search import _tmdb_to_search_result
from app.utils.persistence import _is_persistable, get_ttl_for_popularity
from app.utils.deps import get_optional_user

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers ─────────────────────────────────────────────────────

async def _bulk_fetch_moctale(db: AsyncSession, item_ids: list[int], media_types: list[str]) -> dict:
    """Returns dict: {item_id: {dominant_category, dominant_pct, score, total_votes}}"""
    movie_ids = [item_ids[i] for i, mt in enumerate(media_types) if mt != "tv"]
    tv_ids    = [item_ids[i] for i, mt in enumerate(media_types) if mt == "tv"]

    result = {}

    if movie_ids:
        rows = await db.execute(select(MovieRating).where(MovieRating.id.in_(movie_ids)))
        for r in rows.scalars().all():
            result[r.id] = _compute_dominant(r)

    if tv_ids:
        rows = await db.execute(select(TvRating).where(TvRating.id.in_(tv_ids)))
        for r in rows.scalars().all():
            result[r.id] = _compute_dominant(r)

    return result

def _compute_dominant(r) -> dict:
    cats = {
        "perfection": r.perfection or 0.0,
        "go_for_it":  r.go_for_it  or 0.0,
        "timepass":   r.timepass   or 0.0,
        "skip":       r.skip       or 0.0,
    }
    dominant = max(cats, key=cats.get)
    return {
        "dominant_category": dominant,
        "dominant_pct": round(cats[dominant]),
        "score": r.score,
        "total_votes": r.total_votes,
    }

def _release_year(movie: Movie) -> Optional[int]:
    """Extract year from release_date Date object."""
    return movie.release_date.year if movie.release_date else None


def _movie_to_list_item(movie: Movie) -> dict:
    """Serialize a Movie ORM object to MovieListItem dict."""
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
        "media_type": getattr(movie, "type", "movie"),
    }


def _movie_to_detail(movie: Movie) -> dict:
    """Serialize a Movie ORM object to MovieDetail dict."""
    genres    = [mg.genre.name   for mg in (movie.genres    or [])]
    directors = [{"id": md.director.id, "name": md.director.name} for md in (movie.directors or []) if md.director]
    return {
        "id": movie.id,
        "title": movie.title,
        "name": movie.title,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "release_year": _release_year(movie),
        "release_date": str(movie.release_date) if movie.release_date else None,
        "genres": genres,
        "vote_average": movie.vote_average,
        "overview": movie.overview,
        "runtime": movie.runtime,
        "directors": directors,
        "vote_count": movie.vote_count,
        "original_language": movie.original_language,
        "media_type": getattr(movie, "type", "movie"),
        # production info not stored in local DB — empty fallback
        # TMDB path in get_movie_by_id will always populate these
        "production_companies": [],
        "production_countries": [],
        "budget": movie.budget,
        "revenue": movie.revenue,
    }


# ── Routes ───────────────────────────────────────────────────────

@router.get("/trending", response_model=TrendingResponse, summary="Trending movies and TV")
async def get_trending(db: AsyncSession = Depends(get_db)):
    """
    Top 20 trending items (Movies + TV).
    Combines day and week data. Cached 15 minutes.
    """
    cache_key = key_movie_trending()
    cached = await get_cached(cache_key)
    if cached and cached.get("movies"):
        return cached

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached and cached.get("movies"):
                return cached

        # 1. Parallel Fetching
        responses = await asyncio.gather(
            tmdb.fetch_trending("movie", "day"),
            tmdb.fetch_trending("movie", "week"),
            tmdb.fetch_trending("tv", "day"),
            tmdb.fetch_trending("tv", "week"),
            return_exceptions=True
        )

    master_list = []
    
    # 2. List Merging & Source Attachment
    # indices: 0=movie/day, 1=movie/week, 2=tv/day, 3=tv/week
    for i, resp in enumerate(responses):
        if isinstance(resp, dict) and "results" in resp:
            source_type = "day" if i in (0, 2) else "week"
            for item in resp.get("results", []):
                # TMDB sometimes omits media_type in specific endpoints, ensure it exists
                if "media_type" not in item:
                    item["media_type"] = "movie" if i in (0, 1) else "tv"
                item["source_type"] = source_type
                master_list.append(item)

    # 3. Deduplication
    seen = set()
    deduped = []
    for item in master_list:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    # 4. Ranking & Sorting
    for item in deduped:
        popularity = item.get("popularity", 0.0)
        weight = 1.2 if item.get("source_type") == "day" else 1.0
        item["_score"] = popularity * weight

    # Sort initially by score DESC, vote_count DESC
    deduped.sort(key=lambda x: (x.get("_score", 0.0), x.get("vote_count", 0)), reverse=True)

    # 5. Media Balance Enforcement (>= 6 movies, >= 6 tv)
    movies = [x for x in deduped if x.get("media_type") == "movie"]
    tvs = [x for x in deduped if x.get("media_type") == "tv"]

    final_list = []
    final_list.extend(movies[:6])
    final_list.extend(tvs[:6])

    # Remove already picked items from remainder pool
    picked_keys = {f"{item['id']}_{item.get('media_type', 'movie')}" for item in final_list}
    remainder = [x for x in deduped if f"{x['id']}_{x.get('media_type', 'movie')}" not in picked_keys]

    # Fill remaining slots (up to 20 total) by highest score
    slots_left = 20 - len(final_list)
    if slots_left > 0:
        final_list.extend(remainder[:slots_left])

    # Re-sort final list by score to ensure correct top-to-bottom order
    final_list.sort(key=lambda x: (x.get("_score", 0.0), x.get("vote_count", 0)), reverse=True)

    # 6. Formatting
    formatted = [_tmdb_to_search_result(item) for item in final_list]

    # FALLBACK: If TMDB calls failed/returned empty, get popular movies from local DB
    is_fallback = False
    if not formatted:
        is_fallback = True
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .order_by(Movie.popularity.desc())
            .limit(20)
        )
        result = await db.execute(stmt)
        local_movies = result.scalars().unique().all()
        formatted = [_movie_to_list_item(m) for m in local_movies]

    # We use "movies" key because frontend expects {"movies": [...]} for trending
    
    # Attach moctale_rating
    item_ids = [item["id"] for item in formatted]
    item_types = [item.get("media_type", "movie") for item in formatted]
    moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
    for item in formatted:
        item["moctale_rating"] = moctale_map.get(item["id"])

    data = {"movies": formatted}
    
    # Cache for TTL_TRENDING (5 hours), or 10 seconds if fallback
    await set_cached(cache_key, data, 10 if is_fallback else TTL_TRENDING)
    return data


# ── GET /movies/explore ──────────────────────────────────────────
# Filtered browse endpoint for the Explore page.
# Supports: genre, min_rating, year_from, year_to, sort, page, limit.
# Cache TTL: 10 min (shorter — filters make many combos).

TTL_EXPLORE = 600   # 10 minutes

SORT_MAP = {
    "popularity":   Movie.popularity.desc(),
    "rating":       Movie.vote_average.desc(),
    "release_date": Movie.release_date.desc(),
    "title":        Movie.title.asc(),
}

GENRE_NAME_TO_ID = {
    "action": 28, "adventure": 12, "animation": 16, "comedy": 35, "crime": 80,
    "documentary": 99, "drama": 18, "family": 10751, "fantasy": 14, "history": 36,
    "horror": 27, "music": 10402, "mystery": 9648, "romance": 10749, "science fiction": 878,
    "tv movie": 10770, "thriller": 53, "war": 10752, "western": 37, "action & adventure": 10759,
    "kids": 10762, "news": 10763, "reality": 10764, "sci-fi & fantasy": 10765, "soap": 10766,
    "talk": 10767, "war & politics": 10768
}

def _tmdb_to_list_item(item: dict) -> dict:
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
        "genres": [],
        "vote_average": item.get("vote_average", 0.0),
        "media_type": item.get("media_type", "movie"),
    }

TTL_EXPLORE = 600   # 10 minutes

@router.get("/explore", summary="Filtered movie browse (Explore page)")
async def explore_movies(
    genres:     Optional[str] = Query(default=None, description="Comma-separated genre names"),
    min_rating: float         = Query(default=0.0,  ge=0, le=10, description="Minimum vote_average"),
    year_from:  Optional[int] = Query(default=None, ge=1900, description="Release year ≥"),
    year_to:    Optional[int] = Query(default=None, ge=1900, description="Release year ≤"),
    sort:       str           = Query(default="popularity", description="Sort: popularity|rating|release_date|title|moctale"),
    page:       int           = Query(default=1, ge=1),
    limit:      int           = Query(default=24, ge=1, le=100),
    companies:  Optional[str] = Query(default=None, description="Comma-separated TMDB company IDs"),
    countries:  Optional[str] = Query(default=None, description="Comma-separated origin country ISO codes"),
    providers:  Optional[str] = Query(default=None, description="Comma-separated watch provider IDs"),
    type:       Optional[str] = Query(default=None, description="Filter by type: movie|tv|anime"),
    age_rating: Optional[str] = Query(default=None, description="Filter by age rating: kids|teens"),
    db: AsyncSession = Depends(get_db),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """
    Rich filtered browse for the Explore page, powered by TMDB discover.
    genres: comma-separated, e.g. "Action,Drama".
    min_rating: floor for vote_average.
    year_from / year_to: inclusive release year range.
    sort: popularity | rating | release_date | title | moctale.
    Cached 10 minutes per combo.
    """
    user_uuid = None
    if current_user:
        from uuid import UUID
        user_uuid = UUID(current_user["sub"])

    genre_list = [g.strip() for g in genres.split(",")] if genres else []
    cache_key = key_explore_page({
        "g": sorted(genre_list), "mr": min_rating,
        "yf": year_from, "yt": year_to,
        "s": sort, "p": page, "l": limit,
        "comp": companies, "count": countries, "prov": providers,
        "t": type,
        "ar": age_rating,
        "u": str(user_uuid) if user_uuid else None
    })
    cached = await get_cached(cache_key)
    if cached:
        return cached  # all_genres already embedded in payload

    # Fetch all genre names for sidebar (DB query — only on cache MISS)
    genre_names_stmt = select(Genre.name).order_by(Genre.name)
    all_genres = (await db.execute(genre_names_stmt)).scalars().all()

    # Map genre names to IDs
    genre_ids = []
    for g_name in genre_list:
        g_id = GENRE_NAME_TO_ID.get(g_name.lower())
        if g_id:
            genre_ids.append(str(g_id))

    # Base params for TMDB discover
    params_movie = {
        "language": "en-US",
        "page": page,
        "include_adult": "false",
        "vote_average.gte": min_rating,
    }
    params_tv = {
        "language": "en-US",
        "page": page,
        "include_adult": "false",
        "vote_average.gte": min_rating,
    }

    if genre_ids:
        params_movie["with_genres"] = ",".join(genre_ids)
        params_tv["with_genres"] = ",".join(genre_ids)

    if companies:
        params_movie["with_companies"] = companies
        params_tv["with_companies"] = companies

    if countries:
        params_movie["with_origin_country"] = countries.replace(",", "|")
        params_tv["with_origin_country"] = countries.replace(",", "|")

    if providers:
        params_movie["with_watch_providers"] = providers.replace(",", "|")
        params_tv["with_watch_providers"] = providers.replace(",", "|")
        params_movie["watch_region"] = "IN"
        params_tv["watch_region"] = "IN"
    
    if year_from:
        params_movie["primary_release_date.gte"] = f"{year_from}-01-01"
        params_tv["first_air_date.gte"] = f"{year_from}-01-01"
    if year_to:
        params_movie["primary_release_date.lte"] = f"{year_to}-12-31"
        params_tv["first_air_date.lte"] = f"{year_to}-12-31"
        
    if age_rating == "kids":
        params_movie["certification_country"] = "US"
        params_movie["certification.lte"] = "PG"
        params_tv["certification_country"] = "US"
        params_tv["certification.lte"] = "TV-PG"
    elif age_rating == "teens":
        params_movie["certification_country"] = "US"
        params_movie["certification.lte"] = "PG-13"
        params_tv["certification_country"] = "US"
        params_tv["certification.lte"] = "TV-14"
    
    # Sort mapping
    if sort == "popularity":
        params_movie["sort_by"] = "popularity.desc"
        params_tv["sort_by"] = "popularity.desc"
    elif sort == "rating":
        params_movie["sort_by"] = "vote_average.desc"
        params_tv["sort_by"] = "vote_average.desc"
        params_movie["vote_count.gte"] = 50
        params_tv["vote_count.gte"] = 50
    elif sort == "release_date":
        params_movie["sort_by"] = "primary_release_date.desc"
        params_tv["sort_by"] = "first_air_date.desc"
    elif sort == "title":
        params_movie["sort_by"] = "original_title.asc"
        params_tv["sort_by"] = "original_name.asc"
    elif sort == "moctale":
        params_movie["sort_by"] = "popularity.desc"
        params_tv["sort_by"] = "popularity.desc"

    # Fetch based on type filter
    if type == "movie":
        responses = await asyncio.gather(
            tmdb._get("/discover/movie", params=params_movie),
            return_exceptions=True
        )
    elif type == "tv":
        responses = await asyncio.gather(
            tmdb._get("/discover/tv", params=params_tv),
            return_exceptions=True
        )
    elif type == "anime":
        anime_genre_ids = list(genre_ids)
        if "16" not in anime_genre_ids:
            anime_genre_ids.append("16")
        params_movie["with_genres"] = ",".join(anime_genre_ids)
        params_tv["with_genres"] = ",".join(anime_genre_ids)
        
        params_movie["with_original_language"] = "ja"
        params_tv["with_original_language"] = "ja"
        
        responses = await asyncio.gather(
            tmdb._get("/discover/movie", params=params_movie),
            tmdb._get("/discover/tv", params=params_tv),
            return_exceptions=True
        )
    else:
        responses = await asyncio.gather(
            tmdb._get("/discover/movie", params=params_movie),
            tmdb._get("/discover/tv", params=params_tv),
            return_exceptions=True
        )

    master_list = []
    for i, resp in enumerate(responses):
        if isinstance(resp, dict) and "results" in resp:
            for item in resp["results"]:
                if "media_type" not in item:
                    if type == "movie":
                        item["media_type"] = "movie"
                    elif type == "tv":
                        item["media_type"] = "tv"
                    else:
                        item["media_type"] = "movie" if i == 0 else "tv"
                if not item.get("poster_path") or item.get("adult"):
                    continue
                master_list.append(item)

    seen = set()
    deduped = []
    for item in master_list:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    if sort == "popularity":
        deduped.sort(key=lambda x: (x.get("popularity", 0.0)), reverse=True)
    elif sort == "rating":
        deduped.sort(key=lambda x: (x.get("vote_average", 0.0)), reverse=True)
    elif sort == "release_date":
        def _get_date(x):
            d = x.get("release_date") or x.get("first_air_date") or ""
            return d
        deduped.sort(key=_get_date, reverse=True)
    elif sort == "title":
        def _get_title(x):
            return (x.get("title") or x.get("name") or "").lower()
        deduped.sort(key=_get_title)

    formatted = [_tmdb_to_list_item(item) for item in deduped]

    # Attach moctale_rating
    item_ids = [item["id"] for item in formatted]
    item_types = [item.get("media_type", "movie") for item in formatted]
    moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
    for item in formatted:
        item["moctale_rating"] = moctale_map.get(item["id"])

    if sort == "moctale":
        formatted.sort(key=lambda x: (x.get("moctale_rating") or {}).get("score") or 0, reverse=True)

    # Removed Watch Status Filtering

    total_results = sum(
        resp.get("total_results", 0)
        for resp in responses
        if isinstance(resp, dict) and "total_results" in resp
    )
    if not total_results:
        total_results = len(formatted)

    has_more = False
    for resp in responses:
        if isinstance(resp, dict):
            curr_page = resp.get("page", 1)
            tot_pages = resp.get("total_pages", 1)
            if curr_page < tot_pages:
                has_more = True
                break

    results = formatted[:limit]

    data = {
        "movies":     results,
        "total":      total_results,
        "page":       page,
        "limit":      limit,
        "has_more":   has_more,
        "all_genres": list(all_genres),  # embedded in cache — avoids DB query on HIT
    }
    await set_cached(cache_key, data, TTL_EXPLORE)
    return data


# ── GET /movies/genre/{genre_id} ─────────────────────────────────
@router.get("/genre/{genre_id}", summary="Explore by Genre (TMDB dynamic)")
async def explore_by_genre(genre_id: int, db: AsyncSession = Depends(get_db)):
    """
    Dynamic genre filtering powered by TMDB.
    Fetches 2 pages for movies and 2 pages for TV concurrently.
    Merges, deduplicates, and sorts by popularity to return top 20 items.
    Cached 30 minutes.
    """
    cache_key = f"home:genre:{genre_id}"
    cached = await get_cached(cache_key)
    if cached and cached.get("movies"):
        return cached

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached and cached.get("movies"):
                return cached

        # 1. Concurrent fetching (2 pages each for movie and tv)
        genre_str = str(genre_id)
        responses = await asyncio.gather(
            tmdb.discover_movies(genre_str, page=1),
            tmdb.discover_movies(genre_str, page=2),
            tmdb.discover_tv(genre_str, page=1),
            tmdb.discover_tv(genre_str, page=2),
            return_exceptions=True
        )

    # ── rest of explore_by_genre runs inside inflight_lock context ──

    master_list = []

    # indices: 0=movie/1, 1=movie/2, 2=tv/1, 3=tv/2
    for i, resp in enumerate(responses):
        if isinstance(resp, dict) and "results" in resp:
            for item in resp.get("results", []):
                if "media_type" not in item:
                    item["media_type"] = "movie" if i in (0, 1) else "tv"
                master_list.append(item)

    # Deduplicate strictly by id + media_type
    seen = set()
    deduped = []
    for item in master_list:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    # Sort by rating DESC, vote_count DESC
    deduped.sort(key=lambda x: (x.get("vote_average", 0.0), x.get("vote_count", 0)), reverse=True)

    # Slice top 20
    final_list = deduped[:20]

    # Format output
    formatted = [_tmdb_to_search_result(item) for item in final_list]
    
    # FALLBACK: If TMDB returned nothing, query local DB for movies in this genre ID
    is_fallback = False
    if not formatted:
        is_fallback = True
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .join(Movie.genres)
            .where(MovieGenre.genre_id == genre_id)
            .order_by(Movie.vote_average.desc(), Movie.popularity.desc())
            .limit(20)
        )
        result = await db.execute(stmt)
        local_movies = result.scalars().unique().all()
        formatted = [_movie_to_list_item(m) for m in local_movies]

    # Attach moctale_rating
    item_ids = [item["id"] for item in formatted]
    item_types = [item.get("media_type", "movie") for item in formatted]
    moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
    for item in formatted:
        item["moctale_rating"] = moctale_map.get(item["id"])

    data = {"movies": formatted}
    
    # TTL: 30 minutes (1800 seconds), or 10 seconds if fallback
    await set_cached(cache_key, data, 10 if is_fallback else 1800)
    return data


# ── GET /movies/{movie_id}/videos ────────────────────────────────
@router.get("/{movie_id}/videos", summary="Movie trailers and teasers")
async def get_movie_videos(movie_id: int):
    cache_key = f"tmdb:videos:movie:{movie_id}"
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached

    # Fetch TMDB videos
    videos = await tmdb.fetch_movie_videos(movie_id)
    title = await tmdb.fetch_movie_title(movie_id) or "Movie"
    
    # Process TMDB primary list
    trailers = [v for v in videos if v.get("type") == "Trailer"]
    teasers = [v for v in videos if v.get("type") == "Teaser"]
    
    response_data = {
        "trailer_key": trailers[0]["key"] if trailers else None,
        "teaser_key": teasers[0]["key"] if teasers else None,
        "fallback_queries": {
            "trailer": f"{title} official trailer",
            "teaser": f"{title} teaser"
        }
    }
    
    await set_cached(cache_key, response_data, 86400)
    return response_data

# ── GET /movies/top_rated ────────────────────────────────────────
@router.get("/top_rated", summary="Top Rated Movies & TV (TMDB dynamic)")
async def get_top_rated(db: AsyncSession = Depends(get_db)):
    cache_key = "home:top_rated"
    cached = await get_cached(cache_key)
    if cached and cached.get("movies"):
        return cached

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached and cached.get("movies"):
                return cached

        responses = await asyncio.gather(
            tmdb.fetch_top_rated_movies(page=1),
            tmdb.fetch_top_rated_tv(page=1),
            return_exceptions=True
        )

    master_list = []
    for i, resp in enumerate(responses):
        if isinstance(resp, dict) and "results" in resp:
            for item in resp.get("results", []):
                if "media_type" not in item:
                    item["media_type"] = "movie" if i == 0 else "tv"
                master_list.append(item)

    # Deduplicate
    seen = set()
    deduped = []
    for item in master_list:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    # Sort by rating DESC, vote_count DESC
    deduped.sort(key=lambda x: (x.get("vote_average", 0.0), x.get("vote_count", 0)), reverse=True)

    # Slice top 20
    final_list = deduped[:20]
    formatted = [_tmdb_to_search_result(item) for item in final_list]
    
    # FALLBACK: If TMDB returned nothing (e.g. connection error), get from local DB
    is_fallback = False
    if not formatted:
        is_fallback = True
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .order_by(Movie.vote_average.desc(), Movie.popularity.desc())
            .limit(20)
        )
        result = await db.execute(stmt)
        local_movies = result.scalars().unique().all()
        formatted = [_movie_to_list_item(m) for m in local_movies]

    # Attach moctale_rating
    item_ids = [item["id"] for item in formatted]
    item_types = [item.get("media_type", "movie") for item in formatted]
    moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
    for item in formatted:
        item["moctale_rating"] = moctale_map.get(item["id"])

    data = {"movies": formatted}
    await set_cached(cache_key, data, 10 if is_fallback else 3600)
    return data


# ── GET /movies/upcoming ─────────────────────────────────────────
@router.get("/upcoming", summary="Most Interested / Upcoming (TMDB dynamic)")
async def get_upcoming(filter: str = Query(default="month", description="week|month|year"), db: AsyncSession = Depends(get_db)):
    cache_key = f"home:upcoming:v5:{filter}"
    cached = await get_cached(cache_key)
    if cached and cached.get("movies"):
        return cached

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached and cached.get("movies"):
                return cached

        responses = await asyncio.gather(
            tmdb.fetch_upcoming(page=1),
            tmdb.fetch_on_the_air(page=1),
            return_exceptions=True
        )

    master_list = []
    for i, resp in enumerate(responses):
        if isinstance(resp, dict) and "results" in resp:
            for item in resp.get("results", []):
                if "media_type" not in item:
                    item["media_type"] = "movie" if i == 0 else "tv"
                master_list.append(item)

    # Date math
    import datetime
    today = datetime.date.today()
    
    if filter == "week":
        min_days = 0
        max_days = 7
    elif filter == "year":
        min_days = 0
        dec31 = datetime.date(today.year, 12, 31)
        max_days = (dec31 - today).days
    else:
        min_days = 0
        max_days = 30 # month

    filtered = []
    for item in master_list:
        date_str = item.get("release_date") if item.get("media_type") == "movie" else item.get("first_air_date")
        if not date_str:
            continue
        try:
            item_date = datetime.date.fromisoformat(date_str)
            days_until = (item_date - today).days
            if min_days <= days_until <= max_days:
                item["_days_until"] = days_until
                filtered.append(item)
        except ValueError:
            pass

    # Deduplicate
    seen = set()
    deduped = []
    for item in filtered:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    # Sort strictly by popularity descending (highest interest count first)
    deduped.sort(key=lambda x: x.get("popularity", 0.0), reverse=True)

    # Slice top 8
    final_list = deduped[:8]
    formatted = [_tmdb_to_search_result(item) for item in final_list]
    
    # FALLBACK: If TMDB calls failed/returned empty, get popular movies from local DB
    is_fallback = False
    if not formatted:
        is_fallback = True
        stmt = (
            select(Movie)
            .options(selectinload(Movie.genres).selectinload(MovieGenre.genre))
            .order_by(Movie.popularity.desc())
            .limit(8)
        )
        result = await db.execute(stmt)
        local_movies = result.scalars().unique().all()
        formatted = [_movie_to_list_item(m) for m in local_movies]

    # Attach moctale_rating
    item_ids = [item["id"] for item in formatted]
    item_types = [item.get("media_type", "movie") for item in formatted]
    moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
    for item in formatted:
        item["moctale_rating"] = moctale_map.get(item["id"])

    data = {"movies": formatted}
    await set_cached(cache_key, data, 10 if is_fallback else 1800)
    return data




def _parse_date(date_str: Optional[str]) -> Optional[date]:
    if not date_str:
        return None
    try:
        return date.fromisoformat(date_str)
    except ValueError:
        return None


def _tmdb_detail_to_dict(raw: dict, directors: list) -> dict:
    genres = [g["name"] for g in raw.get("genres", [])]
    release_date = raw.get("release_date")
    release_year = None
    if release_date:
        try:
            release_year = int(release_date.split("-")[0])
        except (ValueError, IndexError):
            pass
    production_companies = [
        {"id": c["id"], "name": c["name"], "logo_path": c.get("logo_path")}
        for c in raw.get("production_companies", [])
        if c.get("name")
    ]
    production_countries = [
        {"iso_3166_1": c.get("iso_3166_1", ""), "name": c["name"]}
        for c in raw.get("production_countries", [])
        if c.get("name")
    ]
    return {
        "id": raw["id"],
        "title": raw.get("title") or raw.get("original_title") or "",
        "poster_path": raw.get("poster_path"),
        "backdrop_path": raw.get("backdrop_path"),
        "release_year": release_year,
        "release_date": release_date,
        "genres": genres,
        "vote_average": raw.get("vote_average", 0.0),
        "overview": raw.get("overview"),
        "runtime": raw.get("runtime"),
        "directors": directors,
        "vote_count": raw.get("vote_count", 0),
        "original_language": raw.get("original_language"),
        "media_type": "movie",
        "production_companies": production_companies,
        "production_countries": production_countries,
        "budget": raw.get("budget"),
        "revenue": raw.get("revenue"),
    }


_persist_locks: dict = {}

async def persist_safe(movie_id: int, db: AsyncSession, raw: dict):
    if movie_id in _persist_locks:
        return  # already in flight, skip
    _persist_locks[movie_id] = True
    try:
        await persist_movie_full(db, raw)
    finally:
        _persist_locks.pop(movie_id, None)


async def persist_movie_full(db: AsyncSession, raw_tmdb: dict):
    """
    Full movie upsert from TMDB raw detail response.
    Inserts: movie row + genres (many-to-many) + directors (crew filter).
    Idempotent — uses INSERT ... ON CONFLICT DO UPDATE.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    movie_id = raw_tmdb["id"]
    title = raw_tmdb.get("title") or ""
    overview = raw_tmdb.get("overview") or ""

    release_date_obj = _parse_date(raw_tmdb.get("release_date"))
    search_vector = func.to_tsvector("english", f"{title} {overview}")

    stmt = pg_insert(Movie).values(
        id=movie_id,
        title=title,
        original_title=raw_tmdb.get("original_title") or title,
        overview=overview,
        release_date=release_date_obj,
        runtime=raw_tmdb.get("runtime"),
        poster_path=raw_tmdb.get("poster_path"),
        backdrop_path=raw_tmdb.get("backdrop_path"),
        popularity=float(raw_tmdb.get("popularity") or 0.0),
        vote_average=float(raw_tmdb.get("vote_average") or 0.0),
        vote_count=int(raw_tmdb.get("vote_count") or 0),
        original_language=raw_tmdb.get("original_language"),
        search_vector=search_vector,
        fetched_at=utcnow(),
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={
            "popularity": float(raw_tmdb.get("popularity") or 0.0),
            "vote_average": float(raw_tmdb.get("vote_average") or 0.0),
            "fetched_at": utcnow(),
        }
    )
    await db.execute(stmt)

    # Persist genres (many-to-many)
    for genre_raw in raw_tmdb.get("genres", []):
        await db.execute(
            pg_insert(Genre).values(id=genre_raw["id"], name=genre_raw["name"])
            .on_conflict_do_nothing()
        )
        await db.execute(
            pg_insert(MovieGenre).values(movie_id=movie_id, genre_id=genre_raw["id"])
            .on_conflict_do_nothing()
        )

    # Persist directors (crew filter)
    credits = await tmdb.fetch_movie_credits(movie_id)
    if credits:
        directors_list = tmdb.extract_directors(credits)
        for d in directors_list:
            await db.execute(
                pg_insert(Director).values(
                    id=d["id"],
                    name=d["name"],
                    profile_path=d.get("profile_path"),
                    tmdb_id=d["tmdb_id"]
                ).on_conflict_do_nothing()
            )
            await db.execute(
                pg_insert(MovieDirector).values(
                    movie_id=movie_id,
                    director_id=d["id"]
                ).on_conflict_do_nothing()
            )

    await db.commit()
    logger.info(f"PERSIST: movie_id={movie_id} title='{title}'")


@router.get("/{movie_id}", response_model=MovieDetail, summary="Movie detail")
async def get_movie_by_id(movie_id: int, db: AsyncSession = Depends(get_db)):
    """
    Full detail for a single movie including genres + directors.
    No auth required. Cached 1 hour.
    """
    cache_key = key_movie_detail(movie_id)
    cached = await get_cached(cache_key)
    if cached:
        return cached

    # Fetch MovieRating separately to ensure it is always attached
    from app.db.orm_models import MovieRating
    stmt_moctale = select(MovieRating).where(MovieRating.id == movie_id)
    result_moctale = await db.execute(stmt_moctale)
    moctale_rating = result_moctale.scalar_one_or_none()
    moctale_data = None
    if moctale_rating:
        moctale_data = {
            "score": moctale_rating.score,
            "total_votes": moctale_rating.total_votes,
            "perfection": moctale_rating.perfection,
            "go_for_it": moctale_rating.go_for_it,
            "timepass": moctale_rating.timepass,
            "skip": moctale_rating.skip,
        }


    stmt = (
        select(Movie)
        .options(
            selectinload(Movie.genres).selectinload(MovieGenre.genre),
            selectinload(Movie.directors).selectinload(MovieDirector.director),
        )
        .where(Movie.id == movie_id)
    )
    result = await db.execute(stmt)
    movie = result.scalar_one_or_none()

    if movie:
        data = _movie_to_detail(movie)
        # Release DB before TMDB call
        await db.close()
        # Fetch TMDB detail to enrich with production_companies/countries
        raw = await tmdb.fetch_movie_detail(movie_id)
        if raw:
            data["production_companies"] = [
                {"id": c["id"], "name": c["name"], "logo_path": c.get("logo_path")}
                for c in raw.get("production_companies", []) if c.get("name")
            ]
            data["production_countries"] = [
                {"iso_3166_1": c.get("iso_3166_1", ""), "name": c["name"]}
                for c in raw.get("production_countries", []) if c.get("name")
            ]
            if raw.get("budget"):
                data["budget"] = raw.get("budget")
            if raw.get("revenue"):
                data["revenue"] = raw.get("revenue")
        data["moctale_rating"] = moctale_data
        await set_cached(cache_key, data, TTL_MOVIE_DETAIL)
        return data

    # NOT IN DB: release DB connection before slow TMDB calls
    await db.close()

    # 3. TMDB (live fallback — always works for any movie ID)
    raw = await tmdb.fetch_movie_detail(movie_id)
    if not raw:
        raise HTTPException(status_code=404, detail=f"Movie {movie_id} not found")

    # Fetch credits to extract directors
    credits = await tmdb.fetch_movie_credits(movie_id)
    directors = []
    if credits:
        directors = [{"id": d["id"], "name": d["name"]} for d in tmdb.extract_directors(credits)]

    data = _tmdb_detail_to_dict(raw, directors)

    # 4. Selective Supabase persistence
    pop = raw.get("popularity", 0.0) or 0.0
    if _is_persistable(raw):
        try:
            async with AsyncSessionLocal() as new_db:
                await persist_safe(raw["id"], new_db, raw)
            ttl = get_ttl_for_popularity(pop)
        except Exception as e:
            logger.warning(f"Failed to persist TMDB movie id={movie_id}: {e}")
            ttl = get_ttl_for_popularity(pop)
    else:
        ttl = get_ttl_for_popularity(pop)

    data["moctale_rating"] = moctale_data

    # 5. Cache and return
    await set_cached(cache_key, data, ttl)
    return data




# ── GET /movies/company/{company_id} ────────────────────────────
@router.get("/company/{company_id}", summary="Movies by production company (TMDB discover)")
async def get_movies_by_company(company_id: int, page: int = Query(default=1, ge=1)):
    """
    Discover movies from a specific production company via TMDB.
    Cached 30 minutes.
    """
    cache_key = f"movie:company:{company_id}:p{page}"
    cached = await get_cached(cache_key)
    if cached and cached.get("movies"):
        return cached

    responses = await asyncio.gather(
        tmdb._get("/discover/movie", params={
            "with_companies": str(company_id),
            "language": "en-US",
            "sort_by": "popularity.desc",
            "page": page,
            "include_adult": "false",
        }),
        tmdb._get("/discover/tv", params={
            "with_companies": str(company_id),
            "language": "en-US",
            "sort_by": "popularity.desc",
            "page": page,
            "include_adult": "false",
        }),
        tmdb._get(f"/company/{company_id}"),
        return_exceptions=True,
    )

    master_list = []
    # indices: 0=movie, 1=tv
    for i, resp in enumerate(responses[:2]):
        if isinstance(resp, dict) and "results" in resp:
            for item in resp["results"]:
                if "media_type" not in item:
                    item["media_type"] = "movie" if i == 0 else "tv"
                master_list.append(item)

    company_info = responses[2] if len(responses) > 2 and isinstance(responses[2], dict) else None
    company_name = company_info.get("name") if company_info else None
    logo_path = company_info.get("logo_path") if company_info else None

    seen = set()
    deduped = []
    for item in master_list:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    deduped.sort(key=lambda x: (x.get("popularity", 0.0)), reverse=True)
    formatted = [_tmdb_to_search_result(item) for item in deduped[:30]]

    total_results = sum(
        resp.get("total_results", 0)
        for resp in responses[:2]
        if isinstance(resp, dict) and "total_results" in resp
    )
    if not total_results:
        total_results = len(formatted)

    data = {
        "movies": formatted,
        "total": total_results,
        "page": page,
        "company_name": company_name,
        "logo_path": logo_path
    }
    await set_cached(cache_key, data, 1800)
    return data


# ── GET /movies/country/{iso_code} ───────────────────────────────
@router.get("/country/{iso_code}", summary="Movies by production country (TMDB discover)")
async def get_movies_by_country(iso_code: str, page: int = Query(default=1, ge=1)):
    """
    Discover movies produced in a specific country via TMDB.
    Cached 30 minutes.
    """
    cache_key = f"movie:country:{iso_code}:p{page}"
    cached = await get_cached(cache_key)
    if cached and cached.get("movies"):
        return cached

    responses = await asyncio.gather(
        tmdb._get("/discover/movie", params={
            "with_origin_country": iso_code,
            "language": "en-US",
            "sort_by": "popularity.desc",
            "page": page,
            "include_adult": "false",
        }),
        tmdb._get("/discover/tv", params={
            "with_origin_country": iso_code,
            "language": "en-US",
            "sort_by": "popularity.desc",
            "page": page,
            "include_adult": "false",
        }),
        return_exceptions=True,
    )

    master_list = []
    for i, resp in enumerate(responses):
        if isinstance(resp, dict) and "results" in resp:
            for item in resp["results"]:
                if "media_type" not in item:
                    item["media_type"] = "movie" if i == 0 else "tv"
                master_list.append(item)

    seen = set()
    deduped = []
    for item in master_list:
        key = f"{item['id']}_{item.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    deduped.sort(key=lambda x: (x.get("popularity", 0.0)), reverse=True)
    formatted = [_tmdb_to_search_result(item) for item in deduped[:30]]

    total_results = sum(
        resp.get("total_results", 0)
        for resp in responses
        if isinstance(resp, dict) and "total_results" in resp
    )
    if not total_results:
        total_results = len(formatted)

    data = {"movies": formatted, "total": total_results, "page": page}
    await set_cached(cache_key, data, 1800)
    return data


# IMPORTANT: must be registered AFTER /{movie_id} because FastAPI matches
# sub-paths before generic /{movie_id} only when defined first. We add a
# dedicated nested path so there is no conflict.

TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"
CREW_JOBS = {"Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer", "Showrunner", "Creator"}

@router.get("/{movie_id}/credits", summary="Cast and crew (live TMDB)")
async def get_movie_credits(movie_id: int):
    """
    Fetch cast + key crew for a movie from TMDB.
    Cached 24 h in Redis (key: tmdb:credits:{movie_id}).
    No DB query — TMDB only.
    Cast: top 12 by order. Crew: Director + Writer roles only.
    """
    cache_key = key_movie_credits(movie_id)
    cached = await get_cached(cache_key)
    if cached and (cached.get("cast") or cached.get("crew")):
        return cached

    raw = await tmdb.fetch_movie_credits(movie_id)
    if not raw:
        return {"cast": [], "crew": []}

    def _img(path: Optional[str], size: str = "w185") -> Optional[str]:
        return f"{TMDB_IMAGE_BASE}/{size}{path}" if path else None

    cast = [
        {
            "id": p["id"],
            "name": p["name"],
            "character": p.get("character", ""),
            "profile_path": _img(p.get("profile_path")),
        }
        for p in (raw.get("cast") or [])[:12]
    ]

    crew = [
        {
            "id": p["id"],
            "name": p["name"],
            "job": p.get("job", ""),
            "profile_path": _img(p.get("profile_path")),
        }
        for p in (raw.get("crew") or [])
        if p.get("job") in CREW_JOBS
    ]
    # Dedupe crew by id (person may have multiple roles)
    seen_crew: set = set()
    unique_crew = []
    for c in crew:
        if c["id"] not in seen_crew:
            seen_crew.add(c["id"])
            unique_crew.append(c)

    data = {"cast": cast, "crew": unique_crew}
    if cast or unique_crew:
        await set_cached(cache_key, data, TTL_TMDB_CREDITS)
    return data
