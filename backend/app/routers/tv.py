"""
Movientum — TV Shows Router (Improvement 1.7)

Two endpoints:
  GET /api/v1/tv/{tv_id}          → Full show detail from TMDB (Redis 24h)
  GET /api/v1/tv/{tv_id}/credits  → Cast & crew from TMDB (Redis 24h)

TV shows are NOT stored in the local DB by default.
Only when a user rates/watchlists a TV show is a stub lazily inserted.
All detail data is fetched live from TMDB and cached in Redis.
"""
import logging
from typing import Optional
from datetime import datetime, timezone, date

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.database import get_db, AsyncSessionLocal
from app.db.orm_models import Movie, Genre, MovieGenre
from app.db.cache import get_cached, set_cached, key_tv_credits, key_tv_detail, inflight_lock
from app.services.tmdb_service import tmdb_service as tmdb
from app.utils.persistence import _is_persistable, get_ttl_for_popularity

logger = logging.getLogger(__name__)
router = APIRouter()

TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p"
TTL_TV_DETAIL  = 86_400   # 24 h
TTL_TV_CREDITS = 86_400   # 24 h

# ── Helpers ───────────────────────────────────────────────────────

def _img(path: Optional[str], size: str = "w342") -> Optional[str]:
    return f"{TMDB_IMAGE_BASE}/{size}{path}" if path else None


def _safe_year(date_str: Optional[str]) -> Optional[int]:
    if not date_str:
        return None
    try:
        return int(date_str.split("-")[0])
    except (ValueError, AttributeError):
        return None


# ── GET /tv/{tv_id} ───────────────────────────────────────────────

def utcnow():
    return datetime.now(timezone.utc)

def _parse_date(date_str: Optional[str]) -> Optional[date]:
    if not date_str:
        return None
    try:
        return date.fromisoformat(date_str)
    except ValueError:
        return None

async def persist_tv_full(db: AsyncSession, raw_tmdb: dict):
    """
    Full TV show upsert from TMDB raw detail response.
    Idempotent — uses INSERT ... ON CONFLICT DO UPDATE.
    """
    tv_id = raw_tmdb["id"]
    title = raw_tmdb.get("name") or raw_tmdb.get("original_name") or ""
    overview = raw_tmdb.get("overview") or ""

    first_air_date_obj = _parse_date(raw_tmdb.get("first_air_date"))
    search_vector = func.to_tsvector("english", f"{title} {overview}")

    stmt = pg_insert(Movie).values(
        id=tv_id,
        title=title,
        original_title=raw_tmdb.get("original_name") or title,
        overview=overview,
        release_date=first_air_date_obj,
        poster_path=raw_tmdb.get("poster_path"),
        backdrop_path=raw_tmdb.get("backdrop_path"),
        popularity=float(raw_tmdb.get("popularity") or 0.0),
        vote_average=float(raw_tmdb.get("vote_average") or 0.0),
        vote_count=int(raw_tmdb.get("vote_count") or 0),
        original_language=raw_tmdb.get("original_language"),
        search_vector=search_vector,
        fetched_at=utcnow(),
        type='tv'
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={
            "popularity": float(raw_tmdb.get("popularity") or 0.0),
            "vote_average": float(raw_tmdb.get("vote_average") or 0.0),
            "fetched_at": utcnow(),
        }
    )
    await db.execute(stmt)

    # Persist genres
    for genre_raw in raw_tmdb.get("genres", []):
        await db.execute(
            pg_insert(Genre).values(id=genre_raw["id"], name=genre_raw["name"])
            .on_conflict_do_nothing()
        )
        await db.execute(
            pg_insert(MovieGenre).values(movie_id=tv_id, genre_id=genre_raw["id"])
            .on_conflict_do_nothing()
        )
    await db.commit()

async def _background_ingest_to_catalog(tv_id: int, media_type: str):
    try:
        from app.db.database import AsyncSessionLocal
        from app.services.advanced_recs import get_catalog_row
        from app.services.tmdb_service import ingest_item_to_catalog
        async with AsyncSessionLocal() as new_db:
            catalog_row = await get_catalog_row(new_db, tv_id, media_type)
            if not catalog_row:
                await ingest_item_to_catalog(new_db, tv_id, media_type)
                logger.info(f"Background ingested {media_type} {tv_id} to content_catalog")
    except Exception as e:
        logger.warning(f"Background ingest failed for {media_type} {tv_id}: {e}")


@router.get("/{tv_id}", summary="TV show detail")
async def get_tv_detail(
    tv_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Full TV show details fetched from TMDB and cached based on popularity.
    """
    cache_key = key_tv_detail(tv_id)
    cached = await get_cached(cache_key)
    if cached and cached.get("title") and cached.get("poster_path"):
        background_tasks.add_task(_background_ingest_to_catalog, tv_id, "tv")
        return cached

    # Fallback to DB
    stmt = select(Movie).where(Movie.id == tv_id, Movie.type == 'tv')
    result = await db.execute(stmt)
    tv_db = result.scalar_one_or_none()

    from app.db.orm_models import TvRating
    stmt_moctale = select(TvRating).where(TvRating.id == tv_id)
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

    # Release DB connection before slow TMDB calls
    await db.close()

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached and cached.get("title") and cached.get("poster_path"):
                background_tasks.add_task(_background_ingest_to_catalog, tv_id, "tv")
                return cached

        raw = await tmdb.fetch_tv_detail(tv_id)
    if not raw:
        if tv_db:
            # Fallback data if TMDB fails
            data = {
                "id": tv_db.id,
                "type": "tv",
                "title": tv_db.title,
                "name": tv_db.title,
                "original_title": tv_db.original_title,
                "overview": tv_db.overview,
                "poster_path": tv_db.poster_path,
                "backdrop_path": tv_db.backdrop_path,
                "vote_average": tv_db.vote_average,
                "vote_count": tv_db.vote_count,
                "popularity": tv_db.popularity,
                "original_language": tv_db.original_language,
                "moctale_rating": moctale_data,
            }
            await set_cached(cache_key, data, 600)
            background_tasks.add_task(_background_ingest_to_catalog, tv_id, "tv")
            return data
        raise HTTPException(status_code=404, detail="TV show not found")

    genres = [g["name"] for g in raw.get("genres", [])]
    created_by = [
        {"id": p["id"], "name": p.get("name") or "", "profile_path": p.get("profile_path")}
        for p in raw.get("created_by", [])
        if p.get("id")
    ]
    networks = [n["name"] for n in raw.get("networks", [])]
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

    data = {
        "id":               raw["id"],
        "type":             "tv",
        "title":            raw.get("name") or raw.get("original_name", ""),
        "name":             raw.get("name") or raw.get("original_name", ""),
        "original_title":   raw.get("original_name"),
        "overview":         raw.get("overview"),
        "poster_path":      raw.get("poster_path"),
        "backdrop_path":    raw.get("backdrop_path"),
        "poster_url":       _img(raw.get("poster_path"), "w342"),
        "backdrop_url":     _img(raw.get("backdrop_path"), "w1280"),
        "first_air_date":   raw.get("first_air_date"),
        "release_year":     _safe_year(raw.get("first_air_date")),
        "last_air_date":    raw.get("last_air_date"),
        "number_of_seasons":  raw.get("number_of_seasons"),
        "number_of_episodes": raw.get("number_of_episodes"),
        "vote_average":     raw.get("vote_average", 0.0),
        "vote_count":       raw.get("vote_count", 0),
        "popularity":       raw.get("popularity", 0.0),
        "status":           raw.get("status"),
        "original_language": raw.get("original_language"),
        "genres":           genres,
        "created_by":       created_by,
        "networks":         networks,
        "production_companies": production_companies,
        "production_countries": production_countries,
        "moctale_rating":   moctale_data,
        "seasons":          raw.get("seasons", []),
        "next_episode_to_air": raw.get("next_episode_to_air"),
    }

    pop = float(raw.get("popularity", 0.0) or 0.0)
    if _is_persistable(raw):
        try:
            async with AsyncSessionLocal() as new_db:
                await persist_tv_full(new_db, raw)
            ttl = get_ttl_for_popularity(pop)
        except Exception as e:
            logger.warning(f"Failed to persist TMDB tv id={tv_id}: {e}")
            ttl = get_ttl_for_popularity(pop)
    else:
        ttl = get_ttl_for_popularity(pop)

    await set_cached(cache_key, data, ttl)
    background_tasks.add_task(_background_ingest_to_catalog, tv_id, "tv")
    return data


# ── GET /tv/{tv_id}/videos ───────────────────────────────────────

@router.get("/{tv_id}/videos", summary="TV show trailers and teasers")
async def get_tv_videos(tv_id: int):
    cache_key = f"tmdb:videos:tv:{tv_id}"
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached

    # Fetch TMDB TV videos
    videos = await tmdb.fetch_tv_videos(tv_id)
    title = await tmdb.fetch_tv_title(tv_id) or "TV Show"
    
    trailers = [v for v in videos if v.get("type") == "Trailer"]
    teasers = [v for v in videos if v.get("type") == "Teaser"]
    
    response_data = {
        "trailer_key": trailers[0]["key"] if trailers else None,
        "teaser_key": teasers[0]["key"] if teasers else None,
        "fallback_queries": {
            "trailer": f"{title} official trailer",
            "teaser": f"{title} teaser",
            "season_1": f"{title} season 1 trailer"
        }
    }
    
    await set_cached(cache_key, response_data, 86400)
    return response_data


# ── GET /tv/{tv_id}/season/{season_number}/videos ────────────────

@router.get("/{tv_id}/season/{season_number}/videos", summary="TV season trailers and teasers")
async def get_tv_season_videos(tv_id: int, season_number: int):
    cache_key = f"tmdb:videos:tv:{tv_id}:season:{season_number}"
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached

    # Fetch TMDB TV season videos
    videos = await tmdb.fetch_tv_season_videos(tv_id, season_number)
    title = await tmdb.fetch_tv_title(tv_id) or "TV Show"
    
    trailers = [v for v in videos if v.get("type") == "Trailer"]
    teasers = [v for v in videos if v.get("type") == "Teaser"]
    
    response_data = {
        "trailer_key": trailers[0]["key"] if trailers else None,
        "teaser_key": teasers[0]["key"] if teasers else None,
        "fallback_queries": {
            "trailer": f"{title} season {season_number} official trailer",
            "teaser": f"{title} season {season_number} teaser"
        }
    }
    
    await set_cached(cache_key, response_data, 86400)
    return response_data


# ── GET /tv/{tv_id}/credits ───────────────────────────────────────

@router.get("/{tv_id}/credits", summary="TV show cast & crew")
async def get_tv_credits(tv_id: int):
    """
    Cast & crew for a TV show, cached 24h.
    Returns { cast: [...], crew: [...] }
    Each member: id, name, character/job, profile_path, profile_url, order/department
    """
    cache_key = key_tv_credits(tv_id)
    cached = await get_cached(cache_key)
    if cached and (cached.get("cast") or cached.get("crew")):
        return cached

    async with inflight_lock(cache_key) as waited:
        if waited:
            cached = await get_cached(cache_key)
            if cached and (cached.get("cast") or cached.get("crew")):
                return cached

        raw = await tmdb.fetch_tv_credits(tv_id)
    if not raw:
        return {"cast": [], "crew": []}

    def _member_img(path):
        return _img(path, "w185")

    cast = [
        {
            "id":          m["id"],
            "name":        m.get("name", ""),
            "character":   m.get("character", ""),
            "order":       m.get("order", 99),
            "profile_path": _member_img(m.get("profile_path")),
        }
        for m in raw.get("cast", [])
        if m.get("profile_path")
    ][:30]

    CREW_JOBS = {"Director", "Showrunner", "Writer", "Producer", "Executive Producer", "Creator", "Screenplay", "Story"}
    seen_crew = set()
    crew = []
    
    # Inject 'created_by' from TV details into crew
    # Read from cache first to avoid duplicate TMDB round trip
    from app.db.cache import key_tv_detail
    tv_detail_cached = await get_cached(key_tv_detail(tv_id))
    if tv_detail_cached and "created_by" in tv_detail_cached:
        tv_created_by = tv_detail_cached.get("created_by", [])
        # cached created_by is a list of names (strings), not dicts
        # check if it's raw TMDB format (dicts) or already serialized (strings)
        if tv_created_by and isinstance(tv_created_by[0], dict):
            raw_creators = tv_created_by
        else:
            raw_creators = []  # already serialized as strings, skip creator injection
    else:
        # Cache miss — fall back to TMDB (only if not already cached)
        tv_detail_raw = await tmdb.fetch_tv_detail(tv_id)
        raw_creators = tv_detail_raw.get("created_by", []) if tv_detail_raw else []

    for creator in raw_creators:
        if not creator.get("profile_path"):
            continue
        key = (creator["id"], "Creator")
        if key not in seen_crew:
            seen_crew.add(key)
            crew.append({
                "id": creator["id"],
                "name": creator.get("name", ""),
                "job": "Creator",
                "department": "Production",
                "profile_path": _member_img(creator.get("profile_path")),
            })


    for m in raw.get("crew", []):
        job = m.get("job", "")
        if job not in CREW_JOBS:
            continue
        if not m.get("profile_path"):
            continue
        key = (m["id"], job)
        if key in seen_crew:
            continue
        seen_crew.add(key)
        crew.append({
            "id":          m["id"],
            "name":        m.get("name", ""),
            "job":         m.get("job", ""),
            "department":  m.get("department", ""),
            "profile_path": _member_img(m.get("profile_path")),
        })

    data = {"cast": cast, "crew": crew[:20]}
    if cast or crew:
        await set_cached(cache_key, data, TTL_TV_CREDITS)
    return data
