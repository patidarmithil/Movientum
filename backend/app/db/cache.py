"""
Movientum — Redis Cache (Upstash)

All cache operations are async. Three operations: get / set / invalidate.
Upstash Redis is serverless — connections are pooled and TLS-required.

TTLs (from config_design.md / params.yaml):
    movie:detail:{id}           → 3600s  (1hr)
    movie:trending              → 18000s (5hr)
    movie:list:{hash}           → 1800s  (30min)
    genre:all                   → 86400s (24hr)
    search:{query_hash}         → 600s   (10min)
    autocomplete:{prefix}       → 300s   (5min)
    user:recommendations:{uid}  → 900s   (15min)
    tmdb:config                 → 86400s (24hr)
"""
import json
import hashlib
import logging
from typing import Any, Optional

import redis.asyncio as aioredis
from redis.asyncio import Redis

import asyncio
from contextlib import asynccontextmanager

from app.config import settings

logger = logging.getLogger(__name__)

# ── TTL Constants (seconds) ─────────────────────────────────────
TTL_MOVIE_DETAIL = 3600        # 1 hour
TTL_TRENDING = 18000           # 5 hours
TTL_MOVIE_LIST = 1800          # 30 min
TTL_GENRE_LIST = 86400         # 24 hours
TTL_SEARCH = 600               # 10 min
TTL_AUTOCOMPLETE = 300         # 5 min
TTL_USER_RECS = 900            # 15 min
TTL_TMDB_CONFIG = 86400        # 24 hours
TTL_NEWS_FEED = 7200           # 2 hours
TTL_TMDB_CREDITS = 86400       # 24 hours


def _make_redis_client() -> Redis:
    """Create Redis client from REDIS_URL. Upstash uses TLS so URL uses rediss:// or redis://."""
    url = settings.redis_url
    return aioredis.from_url(
        url,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
        retry_on_timeout=True,
        health_check_interval=30,
    )


# Module-level client — shared across all requests
redis_client: Redis = _make_redis_client()


# ── Core Operations ─────────────────────────────────────────────

async def get_cached(key: str) -> Optional[Any]:
    """
    Get value from Redis. Returns deserialized Python object or None on miss.
    Logs cache HIT/MISS in debug mode.
    """
    try:
        value = await redis_client.get(key)
        if value is None:
            logger.info(f"CACHE MISS: {key}")
            return None
        logger.info(f"CACHE HIT:  {key}")
        return json.loads(value)
    except Exception as e:
        logger.warning(f"Redis GET failed for key={key}: {e}")
        return None  # Degrade gracefully — fall through to DB


async def set_cached(key: str, value: Any, ttl: int) -> bool:
    """
    Store value in Redis with TTL (seconds). Serializes to JSON.
    Returns True on success, False on failure (non-fatal).
    """
    try:
        serialized = json.dumps(value, default=str)
        await redis_client.setex(key, ttl, serialized)
        logger.info(f"CACHE SET:  {key} (TTL={ttl}s)")
        return True
    except Exception as e:
        logger.warning(f"Redis SET failed for key={key}: {e}")
        return False


async def invalidate(key: str) -> bool:
    """Delete single key from Redis."""
    try:
        deleted = await redis_client.delete(key)
        logger.debug(f"CACHE DEL:  {key} ({'found' if deleted else 'not found'})")
        return bool(deleted)
    except Exception as e:
        logger.warning(f"Redis DEL failed for key={key}: {e}")
        return False


async def invalidate_pattern(pattern: str) -> int:
    """
    Delete all keys matching pattern (e.g., 'movie:list:*').
    Returns count of deleted keys.
    WARNING: Use sparingly — SCAN-based, slow on large keyspaces.
    """
    try:
        keys = []
        async for key in redis_client.scan_iter(match=pattern, count=100):
            keys.append(key)
        if keys:
            deleted = await redis_client.delete(*keys)
            logger.debug(f"CACHE BULK DEL: {pattern} → {deleted} keys deleted")
            return deleted
        return 0
    except Exception as e:
        logger.warning(f"Redis pattern DEL failed for {pattern}: {e}")
        return 0


# ── Health Check ────────────────────────────────────────────────

async def check_redis_connection() -> bool:
    """Ping Redis — used in /api/health endpoint."""
    try:
        return await redis_client.ping()
    except Exception:
        return False


# ── Key Builders ─────────────────────────────────────────────────
# Centralise key construction — consistent naming across codebase

def key_movie_detail(movie_id: int) -> str:
    return f"movie:detail:{movie_id}"

def key_tv_detail(tv_id: int) -> str:
    return f"tv:detail:{tv_id}"

def key_movie_trending() -> str:
    return "movie:trending"

def key_movie_list(params_dict: dict) -> str:
    param_str = json.dumps(params_dict, sort_keys=True)
    hash_ = hashlib.md5(param_str.encode()).hexdigest()[:8]
    return f"movie:list:{hash_}"

def key_genre_list() -> str:
    return "genre:all"

def key_search(query: str) -> str:
    hash_ = hashlib.md5(query.lower().encode()).hexdigest()[:8]
    return f"search:v2:{hash_}"

def key_autocomplete(prefix: str) -> str:
    return f"autocomplete:{prefix.lower()}"

def key_user_recommendations(user_id: str) -> str:
    return f"user:recommendations:{user_id}"

def key_tmdb_config() -> str:
    return "tmdb:config"

def key_movie_similar(movie_id: int) -> str:
    return f"movie:similar:{movie_id}"

def key_search_auto(prefix: str) -> str:
    """Cache key for autocomplete: search:auto:{prefix.lower()}  TTL 300s."""
    return f"search:auto:{prefix.lower().strip()}"

def key_movie_credits(movie_id: int) -> str:
    return f"tmdb:credits:{movie_id}"

def key_tv_credits(tv_id: int) -> str:
    """Cache key for TV show credits: tmdb:tv:{id}:credits  TTL 86400s."""
    return f"tmdb:tv:{tv_id}:credits"

# ── Cache Stampede Protection ─────────────────────────────────────
_inflight_locks: dict[str, asyncio.Event] = {}

@asynccontextmanager
async def inflight_lock(key: str):
    """
    Prevents cache stampedes.
    Yields True if we had to wait for another task (meaning we should check cache again).
    Yields False if we are the leader and should fetch the data.
    """
    if key in _inflight_locks:
        event = _inflight_locks[key]
        await event.wait()
        yield True
    else:
        event = asyncio.Event()
        _inflight_locks[key] = event
        try:
            yield False
        finally:
            event.set()
            _inflight_locks.pop(key, None)
