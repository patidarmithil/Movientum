# Redis Caching

Redis (Upstash, TLS) does four jobs: **response cache**, **JWT blacklist**, **news storage**, and **Celery broker**. All helpers and key builders are in `backend/app/db/cache.py`.

## The pattern every cached endpoint uses

```python
cached = await get_cached(key)
if cached: return cached
async with inflight_lock(key) as waited:
    if waited:                      # someone else just fetched it
        cached = await get_cached(key)
        if cached: return cached
    data = ...                      # fetch from DB / TMDB
await set_cached(key, data, TTL)
```

`inflight_lock` stops a "stampede": if 50 requests miss the same key at once, only the first fetches; the rest wait and read its result.

## Three rules

1. **Build keys with the functions in `cache.py`** (`key_movie_detail`, `key_recs_pool`, …), never inline strings.
2. **Keys carry a version** (`movie:detail:v4:{id}`). When a response shape changes, bump the version instead of purging.
3. **Writes bust exactly what they change.** A rating busts that title's meter and that user's lists; watching something busts the user's library, taste profile and every recommendation pool, and switches recommendations to a 3-minute TTL.

## Page bundles

`routers/pages.py` stores each rendered page under one key (home, movie, TV, person, dashboard). A detail page is split in two: a **static** part shared by everyone (7 days) and a **per-user** part (6 h). On a miss, the bundle is rebuilt from section caches with a single `MGET`.

## Main lifetimes

| Data | TTL | Why |
|---|---|---|
| Movie/TV detail, credits, trailers, collections, streaming providers | 7 days | TMDB data rarely changes |
| Rating meter | 7 days | Busted when anyone rates |
| Trending | 10 h | Changes slowly |
| Explore pages | 4 h | Shared by all users |
| Home bundle | 30 min | |
| Similar items | 6 h user / 24 h guest | |
| For You pools | 15 min (3 min after a library change) | |
| Taste profile | 2 min | Feedback changes it often |
| Dashboard lists, collections | 48 h | Busted on write |
| Analysis page | 2–10 min | |
| DNA order / profile | 30 min; per-title PageRank 24 h | |
| AI recs | 6 h user / 24 h guest / 15 min rerun | |
| Tier template items | 7 days | |
| Google public keys | 6 h | |
| **Search** | **not cached** | Always fresh by design |

## News keys

News uses a generation scheme: `news:v3:{gen}:*` holds one snapshot (articles hash, `idx:latest`, `idx:quality`, `idx:cat:*`, `idx:entity:*`, `meta`), and `news:v3:gen` points to the live one. Page caches sit inside the generation, so a new snapshot invalidates them automatically. Views, saves and seen lists use generation-free keys (7 days). See `../features/news_integration.md`.

## Free-tier caveat

Upstash free tier can evict keys under memory pressure no matter the TTL. Everything in Redis must be rebuildable, and a missing key is not automatically a bug.

## Debug helpers

```bash
python debug/scratch_clear_cache.py
python debug/scratch_redis_memory.py
```
