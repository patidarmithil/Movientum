# Redis Caching Integration

## Overview & Architecture

Movientum utilizes **Upstash Redis** (Serverless Redis) for all caching layers, ensuring sub-millisecond response times for heavy database or external API operations. 

The integration supports connection pooling, strict TTL management to prevent stale data, Cache Stampede protection via async locking, and telemetry tracking of cache hits/misses.

---

## Logics & Business Rules

### TLS Compatibility
Because Upstash mandates TLS encryption, the `cache.py` connection builder dynamically adjusts its configuration based on the URL scheme (`rediss://`).
```python
def _make_redis_client() -> Redis:
    url = settings.redis_url
    kwargs = {
        "decode_responses": True,
        "socket_connect_timeout": 5,
        "socket_timeout": 5,
        "retry_on_timeout": True,
        "health_check_interval": 30,
    }
    if url.startswith("rediss://"):
        kwargs["ssl_cert_reqs"] = "none"
    return aioredis.from_url(url, **kwargs)
```

### Cache Stampede Protection
When multiple users request the exact same cache-miss simultaneously, it can hammer the database. Movientum implements an in-memory async lock (`inflight_lock`) using `asyncio.Event` to ensure only the first request performs the DB query, while subsequent requests wait and read the resulting cache.
```python
_inflight_locks: dict[str, asyncio.Event] = {}

@asynccontextmanager
async def inflight_lock(key: str):
    if key in _inflight_locks:
        event = _inflight_locks[key]
        await event.wait()
        yield True  # Must re-check cache
    else:
        event = asyncio.Event()
        _inflight_locks[key] = event
        try:
            yield False # Go fetch data
        finally:
            event.set()
            _inflight_locks.pop(key, None)
```

### Bulk Invalidation Warning
`invalidate_pattern(pattern: str)` uses `redis_client.scan_iter`. Because SCAN operations are slow on large keyspaces, this function is strictly limited and used sparingly.

---

## Code Structure & Detailed Logic

### Centralized Key Builders
All cache keys are generated via centralized functions in `cache.py` to prevent naming collisions and ensure consistency. Hashes are used for complex queries.
```python
def key_movie_list(params_dict: dict) -> str:
    param_str = json.dumps(params_dict, sort_keys=True)
    hash_ = hashlib.md5(param_str.encode()).hexdigest()[:8]
    return f"movie:list:{hash_}"

def key_taste_profile(user_id: str) -> str:
    return f"taste:profile:{user_id}"

def key_explore_page(params_dict: dict) -> str:
    clean = {k: v for k, v in params_dict.items() if v is not None and v != ""}
    param_str = json.dumps(clean, sort_keys=True)
    hash_ = hashlib.md5(param_str.encode()).hexdigest()[:12]
    return f"explore:{hash_}"
```

### Telemetry Integration
Every `get_cached` operation logs to `app.telemetry.cache_ops` (if available) with tags `{"op": "hit" | "miss", "key_type": <prefix>}`.

---

## Tables & Summaries

### Cache TTL Assignments

| Domain | Key Pattern | TTL (Seconds) | Rationale |
|---|---|---|---|
| **Catalog** | `movie:detail:v4:{id}` | 86400 (24h) | Movie details rarely change |
| **Catalog** | `catalog:{type}:{id}` | 86400 (24h) | ML feature rows are static |
| **Explore** | `explore:{hash}` | 14400 (4h) | Shared category pages |
| **Explore** | `movie:trending` | 18000 (5h) | Trending lists update slowly |
| **Search** | `search:v2:{hash}` | 600 (10m) | Standard search results |
| **Search** | `autocomplete:{prefix}`| 300 (5m) | Live typing cache |
| **News** | `news:feed:{uid}:p{page}`| 300 (5m) | Personalised news feed |
| **News** | `news:feed:latest:p{page}`| 120 (2m) | Unpersonalised live news |
| **Recs** | `recs:similar:{type}:{id}`| 1800 (30m)| Similar items blend |
| **User** | `user:recommendations:{uid}`| 900 (15m)| Personalised feed refresh |
| **User** | `user:ratings:{uid}` | 300 (5m) | Dashboard lists |
| **User** | `taste:profile:{uid}`| 120 (2m) | Very short TTL due to rapid feedback updates |

---

## Workflows & Lifecycles

### Get / Set Cache Flow with Stampede Lock
```mermaid
flowchart TD
    A[Client Request] --> B[get_cached(key)]
    B -->|HIT| C[Return Data]
    B -->|MISS| D[inflight_lock(key)]
    D --> E{Wait for Lock?}
    E -->|Yes| B
    E -->|No| F[Fetch from Database / TMDB]
    F --> G[set_cached(key, TTL)]
    G --> H[Release Lock & Return Data]
```
