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
from app.db.orm_models import Director, Genre, Movie, MovieDirector, MovieGenre
from datetime import datetime, timezone, date

def utcnow():
    return datetime.now(timezone.utc)
from app.db.cache import (
    TTL_MOVIE_DETAIL,
    TTL_MOVIE_LIST,
    TTL_TRENDING,
    TTL_TMDB_CREDITS,
    get_cached,
    key_movie_detail,
    key_movie_list,
    key_movie_trending,
    key_movie_credits,
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

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Helpers ─────────────────────────────────────────────────────

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
    directors = [md.director.name for md in (movie.directors or [])]
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
        "runtime": movie.runtime,
        "directors": directors,
        "vote_count": movie.vote_count,
        "original_language": movie.original_language,
        "media_type": getattr(movie, "type", "movie"),
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

@router.get("/explore", summary="Filtered movie browse (Explore page)")
async def explore_movies(
    genres:     Optional[str] = Query(default=None, description="Comma-separated genre names"),
    min_rating: float         = Query(default=0.0,  ge=0, le=10, description="Minimum vote_average"),
    year_from:  Optional[int] = Query(default=None, ge=1900, description="Release year ≥"),
    year_to:    Optional[int] = Query(default=None, ge=1900, description="Release year ≤"),
    sort:       str           = Query(default="popularity", description="Sort: popularity|rating|release_date|title"),
    page:       int           = Query(default=1, ge=1),
    limit:      int           = Query(default=24, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    Rich filtered browse for the Explore page.
    genres: comma-separated, e.g. "Action,Drama" (OR logic — movie matches any).
    min_rating: floor for vote_average.
    year_from / year_to: inclusive release year range.
    sort: popularity | rating | release_date | title.
    Cached 10 minutes per combo.
    """
    from hashlib import md5, sha256
    import json as _json
    genre_list = [g.strip() for g in genres.split(",")] if genres else []
    params_key = _json.dumps({
        "g": sorted(genre_list), "mr": min_rating,
        "yf": year_from, "yt": year_to,
        "s": sort, "p": page, "l": limit,
    }, sort_keys=True)
    cache_key = f"explore:{md5(params_key.encode()).hexdigest()[:12]}"
    cached = await get_cached(cache_key)
    if cached:
        return cached

    order_by = SORT_MAP.get(sort, Movie.popularity.desc())
    offset = (page - 1) * limit

    def _base(for_count: bool):
        q = select(func.count() if for_count else Movie)
        if not for_count:
            q = q.options(selectinload(Movie.genres).selectinload(MovieGenre.genre))

        if genre_list:
            # Join genres, apply OR filter across all requested genres
            q = q.join(Movie.genres).join(MovieGenre.genre).where(
                func.lower(Genre.name).in_([g.lower() for g in genre_list])
            ).distinct()
        if min_rating > 0:
            q = q.where(Movie.vote_average >= min_rating)
        if year_from:
            q = q.where(func.extract("year", Movie.release_date) >= year_from)
        if year_to:
            q = q.where(func.extract("year", Movie.release_date) <= year_to)
        return q

    total = (await db.execute(_base(for_count=True))).scalar_one()
    result = await db.execute(_base(for_count=False).order_by(order_by).offset(offset).limit(limit))
    movies = result.scalars().unique().all()

    # Fetch all genre names for sidebar
    genre_names_stmt = select(Genre.name).order_by(Genre.name)
    all_genres = (await db.execute(genre_names_stmt)).scalars().all()

    data = {
        "movies":     [_movie_to_list_item(m) for m in movies],
        "total":      total,
        "page":       page,
        "limit":      limit,
        "all_genres": list(all_genres),
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

    # 1. Concurrent fetching (2 pages each for movie and tv)
    genre_str = str(genre_id)
    responses = await asyncio.gather(
        tmdb.discover_movies(genre_str, page=1),
        tmdb.discover_movies(genre_str, page=2),
        tmdb.discover_tv(genre_str, page=1),
        tmdb.discover_tv(genre_str, page=2),
        return_exceptions=True
    )

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

    data = {"movies": formatted}
    
    # TTL: 30 minutes (1800 seconds), or 10 seconds if fallback
    await set_cached(cache_key, data, 10 if is_fallback else 1800)
    return data


# ── GET /movies/top_rated ────────────────────────────────────────
@router.get("/top_rated", summary="Top Rated Movies & TV (TMDB dynamic)")
async def get_top_rated(db: AsyncSession = Depends(get_db)):
    cache_key = "home:top_rated"
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


def _tmdb_detail_to_dict(raw: dict, directors: list[str]) -> dict:
    genres = [g["name"] for g in raw.get("genres", [])]
    release_date = raw.get("release_date")
    release_year = None
    if release_date:
        try:
            release_year = int(release_date.split("-")[0])
        except (ValueError, IndexError):
            pass
    return {
        "id": raw["id"],
        "title": raw.get("title") or raw.get("original_title") or "",
        "poster_path": raw.get("poster_path"),
        "backdrop_path": raw.get("backdrop_path"),
        "release_year": release_year,
        "genres": genres,
        "vote_average": raw.get("vote_average", 0.0),
        "overview": raw.get("overview"),
        "runtime": raw.get("runtime"),
        "directors": directors,
        "vote_count": raw.get("vote_count", 0),
        "original_language": raw.get("original_language"),
        "media_type": "movie",
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
        await set_cached(cache_key, data, TTL_MOVIE_DETAIL)
        return data

    # 3. TMDB (live fallback — always works for any movie ID)
    raw = await tmdb.fetch_movie_detail(movie_id)
    if not raw:
        raise HTTPException(status_code=404, detail=f"Movie {movie_id} not found")

    # Fetch credits to extract directors
    credits = await tmdb.fetch_movie_credits(movie_id)
    directors = []
    if credits:
        directors = [d["name"] for d in tmdb.extract_directors(credits)]

    data = _tmdb_detail_to_dict(raw, directors)

    # 4. Selective Supabase persistence
    pop = raw.get("popularity", 0.0) or 0.0
    if _is_persistable(raw):
        try:
            await persist_safe(raw["id"], db, raw)
            ttl = get_ttl_for_popularity(pop)
        except Exception as e:
            logger.warning(f"Failed to persist TMDB movie id={movie_id}: {e}")
            ttl = get_ttl_for_popularity(pop)
    else:
        ttl = get_ttl_for_popularity(pop)

    # 5. Cache and return
    await set_cached(cache_key, data, ttl)
    return data




# ── GET /movies/{movie_id}/credits ───────────────────────────────
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
