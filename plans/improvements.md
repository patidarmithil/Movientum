# Movientum — Improvements & Architecture Plan

---

## 1. Search: Ranking, Cold-Start & TMDB Fallback

### 1.1 Root Cause Analysis

**Bug A — "Passengers 2016" not showing:**

Current flow in `search.py`:
1. Query hits PostgreSQL FTS (`search_vector @@ websearch_to_tsquery`)
2. Ranked by `ts_rank x log(popularity + 2)`
3. If local DB results < 5 then call `tmdb.multi_search(query_str)` fallback
4. Merge results, then sort by `release_year DESC` (line 321)

**The real problem:** Final sort is `release_year DESC` only. This completely ignores title exactness and popularity. A movie called "Passenger" (2026 Horror stub) with recent year ranks above "Passengers" (2016, blockbuster) purely because 2026 > 2016. The TMDB result for the real "Passengers" gets pushed down after the sort.

**Bug B — "Dandadan" shows nothing on first search, works after 2 refreshes:**

Flow:
1. First request: Redis MISS -> Supabase FTS -> 0 results (Dandadan not in DB)
2. `len(results) < 5` -> triggers TMDB fallback
3. TMDB returns results -> merged into `results` list
4. `results` is non-empty -> **cached for 10 minutes** -> returned
5. BUT: if TMDB itself is slow (cold start, first request lock delay), the `multi_search` call may timeout or return empty
6. Empty results -> NOT cached (line 323-333 skips cache for empty)
7. Next request -> Redis MISS again -> repeat -> now TMDB is warm -> returns data

**Secondary cause of Bug B:** `tmdb._get()` has `async with lock:` + `REQUEST_DELAY = 0.25s`. On cold start, first request acquires lock, sleeps 0.25s, may timeout at 10s limit. Second parallel TMDB call waits for lock. This serializes TMDB calls and cold start can fail.

**Additional Constraint:**
- Final ranking MUST NOT depend on release_year or any single field.
- All ranking must strictly use multi-factor relevance scoring (see Section 6.1).

---

### 1.2 Proposed Fix: Search Ranking

#### Step 1: Replace final release_year sort with multi-factor scoring

Current (BAD):
`results.sort(key=lambda x: x.get("release_year") or 0, reverse=True)`

New multi-factor relevance score:

```python
import difflib, math

def _relevance_score(item: dict, query: str) -> float:
    title = (item.get("title") or "").lower()
    q = query.lower().strip()

    exact    = 2.0 if title == q else 0.0          # exact title match
    starts   = 1.5 if title.startswith(q) else 0.0 # starts-with bonus
    contains = 1.0 if q in title else 0.0           # contains bonus
    word_match = sum(1 for w in q.split() if w in title) / max(len(q.split()), 1)
    similarity = difflib.SequenceMatcher(None, q, title).ratio()  # fuzzy
    pop = math.log(max(item.get("popularity") or 1.0, 1.0))       # log-scale pop
    length_penalty = 0.3 if abs(len(title) - len(q)) > 10 else 0.0

    return (
        exact * 2.0 +
        starts * 1.5 +
        contains * 1.0 +
        word_match * 1.2 +
        similarity * 0.5 +
        pop * 0.1
    ) - length_penalty

results.sort(key=lambda x: _relevance_score(x, query_str), reverse=True)
```

#### Step 2: Merge TMDB results BEFORE sorting, not appended after

Currently: local DB results first, TMDB appended at end, then sorted by year.
TMDB's highly popular result (Passengers 2016, popularity ~80) gets sorted to bottom.

Fix — merge into single deduplicated pool then score all together:

```python
all_results = {}
# Deduplication MUST use composite key: id + "_" + media_type to prevent movie/TV collisions
for r in local_results:
    key = f"{r['id']}_{r.get('media_type', 'movie')}"
    all_results[key] = r
for r in tmdb_results:
    key = f"{r['id']}_{r.get('media_type', 'movie')}"
    if key not in all_results:
        all_results[key] = r

results = sorted(all_results.values(), key=lambda x: _relevance_score(x, query_str), reverse=True)
```

#### Step 3: Fix cold-start TMDB timeout (Bug B)

Add timeout wrapper around TMDB search call:

```python
try:
    tmdb_resp = await asyncio.wait_for(
        _tmdb.multi_search(query_str),
        timeout=5.0  # max 5s for search TMDB fallback
    )
except asyncio.TimeoutError:
    logger.warning("TMDB multi_search timeout for q=%r", query_str)
    tmdb_resp = None
```

Replace global lock with semaphore in TMDBService to allow concurrent calls:

```python
# In TMDBService.__init__:
self._semaphore = asyncio.Semaphore(4)  # max 4 concurrent TMDB calls

# In _get(): replace async with self._lock: with:
async with self._semaphore:
    ...
```

#### Step 4: Autocomplete should also fallback to TMDB

Currently autocomplete only queries local DB. If title not in Supabase, no suggestions appear while typing.

Plan: after local DB lookup, if suggestions < 3, call `tmdb.multi_search(prefix)` with 2s timeout, merge top 3 results, cache as normal (5min TTL).

### 1.3 Proposed Fix: Search Execution Flow (CRITICAL FIX ADD)

- Run Supabase + TMDB in parallel (NOT fallback)
- Supabase query + TMDB `multi_search` must run concurrently.
- Always apply timeout on TMDB calls: TMDB `multi_search` must have max timeout = 5 seconds.

**Hard Rule:**
- Supabase and TMDB must ALWAYS run in parallel.
- Fallback-only execution is not allowed.

**Reason:** Avoids 1–3s delay + fixes cold-start empty results and prevents request hanging/slow page load.

---

### 1.4 Files to Modify

| File | Change |
|------|--------|
| `backend/app/routers/search.py` | Replace year-sort with relevance scoring, fix TMDB merge order, add timeout wrapper |
| `backend/app/services/tmdb_service.py` | Replace global lock with semaphore |
| `backend/app/services/search_service.py` | Add TMDB fallback to autocomplete |

---

---

## 2. TMDB-First Architecture — Moving Beyond 980 Movies

### 2.1 Current State (Problem)

- Supabase `movies` table has ~980 seeded movies
- Search, Explore, recommendations all query this fixed table
- Rare/new movies not in Supabase -> return 404 or empty
- Movie stubs inserted by `insert_movie_if_not_exists()` in search are **minimal** — no runtime, no genres, no directors -> bad detail pages
- TV shows have **zero** Supabase rows (all live from TMDB)

### 2.2 Target Architecture

```
User Request
     |
     +-> Redis Cache --HIT--> Return immediately
     |
     +-> TMDB API (source of truth)
              |
              +-> Persist to Supabase IF:
              |     - popularity >= threshold (20.0)
              |     - has full detail (runtime, genres, director)
              |     - not already stored
              |
              +-> Return to user (from TMDB live, cached to Redis)
```

### 2.3 Movie Detail Endpoint — TMDB-First Flow

Current `GET /movies/{id}` hits Supabase first, returns 404 if not found.

New flow:

```python
async def get_movie_by_id(movie_id: int, db: AsyncSession):
    # 1. Redis
    cache_key = key_movie_detail(movie_id)
    cached = await get_cached(cache_key)
    if cached:
        return cached

    # 2. Supabase (fast, already indexed)
    movie = await db_get_movie(db, movie_id)
    if movie:
        data = _movie_to_detail(movie)
        await set_cached(cache_key, data, TTL_MOVIE_DETAIL)
        return data

    # 3. TMDB (live fallback — always works for any movie ID)
    raw = await tmdb.fetch_movie_detail(movie_id)
    if not raw:
        raise HTTPException(404, "Movie not found")

    data = _tmdb_detail_to_dict(raw)

    # 4. Selective Supabase persistence
    if raw.get("popularity", 0) >= PERSIST_POPULARITY_THRESHOLD:  # e.g. 20.0
        await persist_movie_full(db, raw)  # full insert: genres + directors

    # 5. Cache and return
    await set_cached(cache_key, data, TTL_MOVIE_DETAIL)
    return data
```

### 2.4 Selective Persistence Rules

| Condition | Action |
|-----------|--------|
| `popularity >= 20.0` AND full detail available | Full persist to Supabase + Redis |
| `popularity >= 5.0` AND `< 20.0` | Redis only (24h TTL), no Supabase |
| `popularity < 5.0` | Redis only (1h TTL), no Supabase |
| Already in Supabase | Skip insert, just cache |
| TV show (any popularity) | Redis only — no Supabase TV table |

**Global Persistence Rule (UNIFY ADD):**
All persistence MUST go through a single guard function: `_is_persistable(raw)`. No direct DB insert allowed outside this guard.

Conditions for `_is_persistable(raw)`:
- `title` exists
- `poster_path` exists
- `popularity >= threshold`

Popularity threshold rationale: TMDB popularity >20 means movie has been searched/viewed enough to justify DB storage. "Passengers" (2016) has popularity ~80 — persisted. Niche one-time search won't pollute DB.

### 2.5 persist_movie_full() — New Function

Replaces minimal `insert_movie_if_not_exists()` in search.py.

```python
async def persist_movie_full(db: AsyncSession, raw_tmdb: dict):
    """
    Full movie upsert from TMDB raw detail response.
    Inserts: movie row + genres (many-to-many) + directors (crew filter).
    Idempotent — uses INSERT ... ON CONFLICT DO UPDATE.
    """
    movie_id = raw_tmdb["id"]
    title = raw_tmdb.get("title") or ""
    overview = raw_tmdb.get("overview") or ""

    stmt = insert(Movie).values(
        id=movie_id,
        title=title,
        overview=overview,
        release_date=_parse_date(raw_tmdb.get("release_date")),
        runtime=raw_tmdb.get("runtime"),
        poster_path=raw_tmdb.get("poster_path"),
        backdrop_path=raw_tmdb.get("backdrop_path"),
        popularity=raw_tmdb.get("popularity", 0.0),
        vote_average=raw_tmdb.get("vote_average", 0.0),
        vote_count=raw_tmdb.get("vote_count", 0),
        original_language=raw_tmdb.get("original_language"),
        search_vector=func.to_tsvector('english', f"{title} {overview}"),
        fetched_at=utcnow(),
    ).on_conflict_do_update(
        index_elements=["id"],
        set_={
            "popularity": raw_tmdb.get("popularity", 0.0),
            "vote_average": raw_tmdb.get("vote_average", 0.0),
            "fetched_at": utcnow(),
        }
    )
    await db.execute(stmt)

    # Persist genres (many-to-many)
    for genre_raw in raw_tmdb.get("genres", []):
        await db.execute(
            insert(Genre).values(id=genre_raw["id"], name=genre_raw["name"])
            .on_conflict_do_nothing()
        )
        await db.execute(
            insert(MovieGenre).values(movie_id=movie_id, genre_id=genre_raw["id"])
            .on_conflict_do_nothing()
        )

    await db.commit()
```

### 2.6 Supabase Table Size Control

Add a scheduled cleanup to prevent unbounded growth:

```sql
-- Keep only movies with popularity >= 10 OR that have user activity
DELETE FROM movies
WHERE popularity < 10.0
  AND id NOT IN (
    SELECT DISTINCT movie_id FROM ratings
    UNION
    SELECT DISTINCT movie_id FROM watch_history
    UNION
    SELECT DISTINCT movie_id FROM watchlist
  )
  AND fetched_at < NOW() - INTERVAL '30 days';
```

Estimated steady-state: ~5,000-10,000 movies (popular + user-touched).

### 2.7 Search — Parallel Supabase + TMDB

Update `search.py` to call TMDB in parallel with Supabase, not just as fallback:

```python
# Run Supabase + TMDB concurrently
supabase_task = asyncio.create_task(query_local_db(db, query_str, page, limit))
tmdb_task     = asyncio.create_task(_tmdb.multi_search(query_str))

local_results, tmdb_resp = await asyncio.gather(
    supabase_task, tmdb_task, return_exceptions=True
)

# Merge deduplicated -> score -> sort by _relevance_score()
# Persist qualifying TMDB-only results to Supabase
```

This eliminates the "0 results -> fallback" two-step that causes Dandadan cold-start bug.

### 2.8 TV Detail Endpoint — TMDB-First Flow

Same pattern as movie detail (Section 2.3) applied to `GET /tv/{tv_id}`.

Current: TMDB-only (no Supabase). TV fully live. No 404 issue.

New additions:
- On TMDB fetch, if `popularity >= 20` AND `poster_path` AND `title` → optionally cache extended metadata in Redis 24hr (already done)
- On TMDB 404 → HTTP 404 (no fallback, no stub)
- TV never persisted to Supabase movies table except lazily on user rate/watchlist

```python
async def get_tv_by_id(tv_id: int):
    cache_key = f"tmdb:tv:{tv_id}"
    cached = await get_cached(cache_key)
    if cached:
        return cached

    raw = await tmdb.fetch_tv_detail(tv_id)
    if not raw:
        raise HTTPException(404, "TV show not found")

    data = _tmdb_tv_to_dict(raw)
    await set_cached(cache_key, data, TTL_TMDB_CREDITS)  # 24hr
    return data
```

TV credits: same empty-cache bypass rule as movie credits.

```python
if cached and (cached.get("cast") or cached.get("crew")):
    return cached
# else re-fetch TMDB
```

### 2.9 Person Detail Endpoint — TMDB-First Flow

Same pattern applied to `GET /person/{person_id}`.

Current: TMDB-only (person detail + credits both from TMDB).
Person never stored in Supabase. Redis 24hr TTL.

New additions:
- Person detail: if TMDB returns empty `known_for` → do NOT cache → allow retry
- Person credits (Known For): if `credits` list empty after filter → do NOT cache → allow retry on next request
- Ensure `known_for` always computed from credits fetch, not from person detail stub

```python
async def get_person_credits(person_id: int):
    cache_key = f"person:{person_id}:credits:v2"
    cached = await get_cached(cache_key)
    if cached:  # any non-None = valid (may be [])
        return cached

    raw = await tmdb.fetch_person_credits(person_id)
    credits = _filter_person_credits(raw)  # dedupe, filter, sort

    if credits:  # only cache if non-empty
        await set_cached(cache_key, credits, TTL_USER_RECS)  # 1hr
    return credits
```

---

---

## 3. Redis Cache System — Current Flow, All Pages

### 3.1 Redis Infrastructure

| Property | Value |
|----------|-------|
| Provider | Upstash Redis (serverless, TLS) |
| Client | `redis.asyncio` single module-level client in `cache.py` |
| Serialization | JSON (`json.dumps` / `json.loads`) |
| Error policy | All Redis errors non-fatal — log warning, return None, fall through to DB/TMDB |
| Timeout | 5s connect, 5s socket, retry on timeout |
| Health check | `redis_client.ping()` every 30s |

---

### 3.1.1 Cache Stampede Protection (CRITICAL ADD)

**Add:**
- Implement per-key in-memory inflight lock.
- If same cache key is already being fetched:
  → wait for existing request instead of calling TMDB again.

**Reason:**
Prevents multiple TMDB calls → reduces latency spikes.

---

### 3.2 Home Page — Cache Flows

#### Trending (`GET /movies/trending`)

```
Key:    movie:trending
TTL:    18000s (5 hours) — or 10s if TMDB failed (fallback mode)
Source: tmdb.fetch_trending(movie|tv, day|week) x4 concurrent
Check:  cached.get("movies")  — skips empty dict

Flow:
  1. Redis HIT -> return immediately
  2. MISS -> 4 parallel TMDB calls (asyncio.gather)
  3. Merge day+week, deduplicate by id_mediatype
  4. Score: popularity x 1.2 (day) or x 1.0 (week)
  5. Enforce balance: >=6 movies + >=6 tv in final 20
  6. TMDB success -> cache 18000s
  7. TMDB fail/empty -> Supabase fallback -> cache 10s (retry soon)
```

#### Top Rated (`GET /movies/top_rated`)

```
Key:    home:top_rated
TTL:    3600s (1 hr)
Source: tmdb.fetch_top_rated_movies(page=1) + tmdb.fetch_top_rated_tv(page=1)
Check:  cached.get("movies")

Flow:
  1. Redis HIT -> return
  2. MISS -> 2 parallel TMDB calls
  3. Merge, deduplicate, sort by vote_average DESC, slice top 20
  4. TMDB empty -> Supabase fallback -> cache 10s
```

#### Genre Section (`GET /movies/genre/{genre_id}`)

```
Key:    home:genre:{genre_id}
TTL:    1800s (30 min) — or 10s fallback
Source: tmdb.discover_movies + tmdb.discover_tv x2 pages each = 4 concurrent calls
Check:  cached.get("movies")

Flow: Same structure as top_rated but filtered by genre_id.
      Sorted by (vote_average DESC, vote_count DESC).
```

#### Most Interested / Upcoming (`GET /movies/upcoming`)

```
Key:    home:upcoming:v5:{filter}   (filter = week|month|year)
TTL:    1800s (30 min) — or 10s fallback
Source: tmdb.fetch_upcoming(page=1) + tmdb.fetch_on_the_air(page=1)

Note: "v5" version suffix in key means old entries (v1-v4) still exist in Redis
      but are never read. They expire naturally. No flush needed.
      Date filtering applied after TMDB fetch based on filter param.
```

#### Personalized Recommendations (`GET /recommendations`)

```
Key:    user:recommendations:{user_id_uuid}
TTL:    900s (15 min)
Auth:   REQUIRED — no anonymous access
Source: recommendation_service.get_personalized_recommendations()
        -> if watched >= 3: genre affinity from Supabase watch_history
        -> if watched < 3:  trending fallback (generic)
Invalidation: POST /watch, POST/PUT/DELETE /ratings
              -> invalidate(key_user_recommendations(user_id))
```

---

### 3.3 Movie Detail Page — Cache Flows

#### Movie Detail (`GET /movies/{movie_id}`)

```
Key:    movie:detail:{movie_id}
TTL:    3600s (1 hr)
Source: Supabase ORM query (selectinload genres + directors)

Current Flow:
  1. Redis HIT -> return
  2. MISS -> Supabase query
  3. Movie found -> cache 1hr -> return
  4. Movie NOT found in Supabase: (CRITICAL FIX ADD)
     → fetch from TMDB
     → return result
     → optionally persist (based on rules)

Fixed Flow (Section 2.3):
  1. Redis HIT -> return
  2. MISS -> Supabase query
  3. Found in Supabase -> cache -> return
  4. Not in Supabase -> TMDB fetch
  5. TMDB found -> selective persist -> cache -> return
  6. TMDB 404 -> HTTP 404
```

#### Movie Credits (`GET /movies/{movie_id}/credits`)

```
Key:    tmdb:credits:{movie_id}
TTL:    86400s (24 hr)
Source: tmdb.fetch_movie_credits(movie_id)
Check:  cached.get("cast") OR cached.get("crew")
        -> if both empty, treat as MISS (bypass stale empty cache)

Flow:
  1. Redis HIT with non-empty cast/crew -> return
  2. HIT with empty cast+crew -> treat as MISS (BUG FIX applied)
  3. MISS -> TMDB fetch
  4. cast OR crew non-empty -> cache 24hr
  5. Both empty -> don't cache -> next request retries TMDB
```

#### Similar Movies (`GET /recommendations/similar/{id}`)

```
Key:    movie:similar:{movie_id}:{media_type}
TTL:    3600s (1 hr)
Source: recommendation_service.get_similar_items()
        -> Supabase genre-match query
```

---

### 3.4 TV Show Page — Cache Flows

#### TV Detail (`GET /tv/{tv_id}`)

```
Key:    tmdb:tv:{tv_id}
TTL:    86400s (24 hr)
Source: tmdb.fetch_tv_detail(tv_id)

Flow (mirrors Movie Detail — Section 2.3 / 3.3):
  1. Redis HIT → return immediately (no TMDB call)
  2. MISS → TMDB fetch
  3. Found → normalize (genres, created_by, networks) → cache 24hr → return
  4. Not found → HTTP 404

Additions (mirror movie improvements):
  - Field validation before cache return:
    If cached TV data missing required fields (title, poster_path) → treat as MISS, re-fetch
  - Stale refresh (mirror 6.12):
    Track `fetched_at`. If > 7 days old → background asyncio.create_task(_refresh_tv(tv_id))
    Non-blocking — user gets stale data, refresh updates Redis silently.
  - Schema normalization (mirror 6.11):
    Both `title` and `name` fields always present in response.
    `name` = tv show name (TMDB uses "name" for TV), `title` = alias.

NOTE: NO Supabase storage for TV shows.
      Fully TMDB-driven. TV stubs only inserted into movies table
      lazily when user rates or watchlists a show.
```

#### TV Credits (`GET /tv/{tv_id}/credits`)

```
Key:    key_tv_credits(tv_id)  ← MUST use cache.py helper (not ad-hoc tmdb:tv:{id}:credits)
TTL:    86400s (24 hr)
Source: tmdb.fetch_tv_credits(tv_id) + tmdb.fetch_tv_detail(tv_id) for created_by
Check:  cached.get("cast") OR cached.get("crew")

Flow (mirrors Movie Credits — Section 3.3):
  1. Redis HIT with non-empty cast/crew → return
  2. HIT with empty cast+crew → treat as MISS (bypass stale empty cache) ← MIRROR movie fix
  3. MISS → TMDB fetch
  4. cast OR crew non-empty → cache 24hr
  5. Both empty → do NOT cache → next request retries TMDB ← MIRROR movie fix

Special: Injects "Creator" role from tv_detail.created_by.
         tv_detail usually Redis HIT (already cached) so no extra TMDB call.

Pre-processing (mirror 3.6 search pre-processing):
  - Remove cast/crew items where profile_path is null before returning.
  - These items must not appear in frontend crew list.

TMDB failure handling (mirror 3.6):
  - If TMDB credits fetch fails or times out:
    → return empty {cast: [], crew: []} without caching
    → next request retries TMDB

Cache key MUST use: key_tv_credits(tv_id) from cache.py
```

#### Similar TV Shows (`GET /recommendations/similar/{tv_id}?media_type=tv`)

```
Key:    movie:similar:{tv_id}:tv
TTL:    3600s (1 hr)
Source: recommendation_service.get_similar_items() — genre-match query
        (mirrors Similar Movies — Section 3.3)

Invalidation (mirror 6.8):
  - On user rate/watch TV show:
    → invalidate(movie:similar:{tv_id}:tv)
    → invalidate(user:recommendations:{uid})
```

#### TV Invalidation Rules (mirrors movie invalidation — Section 6.8)

```
On POST /ratings or POST /watch for a TV show:
  invalidate(tmdb:tv:{tv_id})                  ← TV detail
  invalidate(key_tv_credits(tv_id))            ← TV credits
  invalidate(movie:similar:{tv_id}:tv)         ← Similar TV
  invalidate(user:recommendations:{uid})        ← Recommendations

Ensures no stale UI data after user action. Mirrors movie invalidation completeness.
```

---

### 3.5 Person Page — Cache Flows

#### Person Detail (`GET /person/{person_id}`)

```
Key:    person:{person_id}:detail
TTL:    86400s (24 hr)
Source: tmdb.fetch_person_detail(person_id)

Flow:
  1. Redis HIT -> return
  2. MISS -> TMDB fetch
  3. Found -> calculate age from birthday/deathday -> cache 24hr
  4. Not found -> HTTP 404
```

#### Person Credits / Known For (`GET /person/{person_id}/credits`)

```
Key:    person:{person_id}:credits:v2
TTL:    3600s (1 hr)
Source: tmdb.fetch_person_credits(person_id)

Flow:
  1. Redis HIT (any non-None value) -> return immediately
  2. MISS -> TMDB fetch all cast credits
  3. Deduplicate by (id, media_type), keep highest popularity
  4. Filter:
     - popularity >= 5.0 (exclude obscure appearances)
     - exclude self/himself/herself characters (guest/talk appearances)
     - exclude genre IDs: talk(10767), reality(10764), documentary(99), news(10763)
  5. Sort by popularity DESC, slice top 16
  6. Skip items without poster_path (no image = skip)
  7. Non-empty -> cache 1hr
  8. Empty -> return [] without caching -> retry allowed on next request

KNOWN ISSUE: popularity >= 5.0 filter may strip rare/indie works.
             Character actors with only niche work -> Known For shows nothing.
             Consider lowering to 2.0 or making filter configurable.
```

---

### 3.6 Search — Cache Flows

#### Full Search (`GET /search`)

```
Key:    search:v2:{md5(f"{query}:page={page}:limit={limit}")[:8]}
TTL:    600s (10 min)
Source: Supabase FTS + TMDB multi_search fallback

Current Flow (with bugs):
  1. Redis HIT -> return immediately (no DB hit at all)
  2. MISS -> Supabase FTS (websearch_to_tsquery, ranked by ts_rank x log(pop+2))
  3. results < 5 -> TMDB multi_search fallback (sequential, not parallel)
  4. Merge local + TMDB, sort by release_year DESC  <-- BUG: wrong sort
  5. Empty results -> NOT cached (allows retry)
  6. Non-empty -> cache 10min

Fixed Flow (parallel TMDB):
  1. Redis HIT -> return
  2. MISS -> Supabase FTS + TMDB multi_search CONCURRENTLY
     - Always apply timeout on TMDB calls: max timeout = 5 seconds (CRITICAL FIX ADD)
     - Failure Handling:
       If TMDB fails or times out:
       → proceed with Supabase results only
       → never block response
  3. Pre-processing:
     - Remove all items where poster_path is null BEFORE scoring.
     - These items must not be scored or returned.
  4. Merge into deduplicated pool:
     - Deduplication MUST use composite key: `id` + `_` + `media_type` to prevent movie/TV collisions.
  5. Sort by _relevance_score() (exact match + popularity + fuzzy + length penalty + word match)
  6. Persist qualifying TMDB-only results (pop >= 20) to Supabase
  7. Cache:
     - Normal results: cache 10min
     - Empty or fallback data: cache for short duration (10 seconds)
       → ensures repeated failures do not trigger repeated slow API calls (EXTEND)
```

#### Autocomplete (`GET /search/autocomplete`)

```
Key:    search:auto:{prefix.lower().strip()}
TTL:    300s (5 min)
Source: Supabase ILIKE prefix% query (autocomplete_search in search_repo)

Current problem: Only hits Supabase. New movies/TV not in DB -> no suggestions.
Fix: If suggestions < 3, call TMDB multi_search(prefix) with 2s timeout,
     merge top 3 results into suggestions, cache as normal.

**Frontend Constraint (ADD):**
- Autocomplete requests must be debounced (250ms)
- Prevents excessive API calls while typing
```

---

### 3.7 Redis Error Handling — Current Rules

| Scenario | Current Behavior | Status |
|----------|-----------------|--------|
| Redis GET fails | Log warning, return None -> falls to DB/TMDB | OK |
| Redis SET fails | Log warning, return False -> data still returned to user | OK |
| Redis DEL fails | Log warning, return False -> cache not invalidated | WARN: user sees stale data |
| Redis connection down | All ops return None/False -> app degrades gracefully | OK |
| Cached empty list [] | Treated as truthy miss for cached.get("movies") | OK |
| Cached {"cast":[],"crew":[]} | Old bug — was returned as HIT | FIXED |
| TMDB returns None | Not cached | OK |
| JSON serialization error | Log warning, skip cache, still return data | OK |

---

### 3.8 Redis Policy — Proposed General Rules

**Rule 1: Never cache empty collections**

```python
# BAD:
await set_cached(key, {"movies": []}, ttl)

# GOOD:
if data["movies"]:
    await set_cached(key, data, ttl)
```

**Rule 2: Short TTL on fallback data**

When Supabase serves as fallback (TMDB failed): cache max 10s so next request retries TMDB quickly. Already implemented for trending/genre/top_rated.

**Rule 3: Version keys on schema changes**

When response shape changes, bump key version string:
`home:upcoming:v5:{filter}` -> `home:upcoming:v6:{filter}`
Old keys expire naturally. No manual flush needed.

**Rule 4: Invalidation on write**

Any mutation (rate, watchlist, watch) must invalidate affected keys:
- User rates movie -> `invalidate(user:recommendations:{uid})` + `invalidate(movie:detail:{id})`
- User adds to watchlist -> `invalidate(user:recommendations:{uid})`

**Rule 5: Credits cache bypass on empty**

Both movies and TV credits: only serve cache if it has actual data.

```python
if cached and (cached.get("cast") or cached.get("crew")):
    return cached  # only serve if has actual data
# fall through to TMDB re-fetch
```

**Rule 6: Non-fatal everywhere**

Redis is a performance layer, NOT the source of truth. Every Redis error must be caught, logged at WARNING level, and execution continues to DB/TMDB. Never raise HTTP 500 due to Redis failure.

---

### 3.9 Exception & Edge Cases Reference

| Case | Where | Current | Fix |
|------|-------|---------|-----|
| Movie in Redis, detail missing fields | movie detail | Returns partial data | Add field validation before cache return |
| TV in Redis, detail missing fields | tv detail | Returns partial data | Same field validation before return (mirror movie fix) |
| TMDB rate limited (429) | All TMDB calls | Retry 3x with backoff 2/4/8s | Already handled |
| TMDB timeout (10s) | All TMDB calls | Returns None -> endpoint degrades | Already handled |
| Redis key collision (MD5[:8]) | search key | 1/4 billion chance | Acceptable |
| Concurrent writes same key | Any endpoint | Last write wins | OK - idempotent |
| JSON serialization fails | set_cached | Log warning, skip cache | Already handled |
| TV key naming inconsistency | TV credits | Ad-hoc key vs helper | Add key_tv_credits() to cache.py |
| TV credits empty on first load | TV credits | Cached empty → returned | Empty-cache bypass now applied (mirror movie fix) |
| TV stale data (7 days+) | TV detail | Stale Redis served forever | Background refresh triggered (mirror 6.12) |
| Person credits empty (niche actor) | person credits | Returns [], not cached | Correct |
| Search cache includes page param | search | Different page = different key | Correct |
| Search cached result has stale popularity | search | Served until TTL (10min) | Acceptable |
| Concurrent first request for same key | any endpoint | Both miss, both fetch, last write wins | Acceptable (cache stampede rare) |

---

## 4. Implementation Priority

| Priority | Item | Effort | Impact |
|----------|------|--------|--------|
| P0 - Critical | Fix search sort — refined relevance scoring (1.1) | Small | Exact/popular titles always win |
| P0 - Critical | Fix search pagination stability (1.3) | Small | No duplicate/missing results across pages |
| P0 - Critical | TMDB concurrent with Supabase in search | Medium | Fixes cold-start empty results |
| P0 - Critical | Cache stampede per-key lock (3.1) | Small | Prevents duplicate TMDB calls |
| P1 - High | TMDB-first movie + TV + person detail (2.3/2.8/2.9) | Medium | Fixes 404, stale data |
| P1 - High | persist_movie_full() with data guard (2.3/2.5/10.C) | Medium | Grows Supabase correctly, no garbage |
| P1 - High | Invalidation completeness — movie:detail + similar (3.3) | Small | No stale UI after user action |
| P1 - High | TV: empty credits bypass + full invalidation (3.4) | Small | TV credits behave same as movie credits |
| P1 - High | TV: stale refresh after 7 days (3.4/6.12) | Small | Fresh TV data in Redis |
| P1 - High | Person credits hybrid sort + role filter (5.1/5.2) | Small | Clean Known For section |
| P2 - Medium | Trending weighted score + India regional mix (6.1/6.2) | Small | More relevant trending |
| P2 - Medium | Stale Supabase refresh after 7 days (9.1) | Small | Keep movie data fresh |
| P2 - Medium | Duplicate persistence in-memory lock (2.2) | Tiny | Prevent wasted concurrent inserts |
| P2 - Medium | Cache version map (3.2) | Tiny | Consistent key naming |
| P2 - Medium | Autocomplete TMDB fallback | Small | Better suggestions for new content |
| P2 - Medium | Replace lock with semaphore in TMDBService | Small | Fixes cold-start serialization |
| P2 - Medium | Add key_tv_credits() helper to cache.py | Tiny | Code hygiene |
| P2 - Medium | Backend schema normalization — movie + TV (6.11/3.4) | Small | Eliminates frontend title/name confusion |
| P2 - Medium | TV similar shows caching (3.4) | Tiny | Consistent similar API for TV + movie |
| P3 - Low | Cold start personalization for new users (10.E) | Small | Better first-time UX |
| P3 - Low | Observability logging (10.I) | Tiny | Visibility into cache hit rate, TMDB errors |
| P3 - Low | Supabase cleanup cron job (2.6) | Medium | Long-term DB hygiene |

---

## 5. Open Questions — Resolved

1. **Popularity threshold:** >= 20.0 for Supabase persist, >= 5.0 Redis-only. **Decision: Keep as proposed.**
   - Also add poster_path + title guard before any persist (per 10.C).

2. **TV shows in Supabase:** Keep all TV as TMDB-only (Redis cached). **Decision: YES — also apply TMDB-first pattern to TV and person pages (sections 2.8, 2.9).**

3. **Search always parallel:** **Decision: Always call TMDB in parallel.** Latency cost (~300ms) acceptable. Fixes cold-start definitively. Worth the tradeoff.

4. **Supabase cleanup:** **Decision: Yes — add scheduled cleanup job** (SQL in section 2.6). Run monthly. Keep user-touched movies always.

---

---

## 6. Additional Improvements — Extended

---

### 6.1 Search Relevance — Refined Scoring (replaces 1.2 scoring)

**Problem:** Short queries ("Her", "It") break scoring. Popular-but-irrelevant titles rank above exact short matches.

**Fix — add length_penalty + word_match:**

```python
def _relevance_score(item: dict, query: str) -> float:
    title = (item.get("title") or "").lower()
    q = query.lower().strip()

    exact    = 2.0 if title == q else 0.0
    starts   = 1.5 if title.startswith(q) else 0.0
    contains = 1.0 if q in title else 0.0
    word_match = sum(1 for w in q.split() if w in title) / max(len(q.split()), 1)
    similarity = difflib.SequenceMatcher(None, q, title).ratio()
    pop = math.log(max(item.get("popularity") or 1.0, 1.0))
    length_penalty = 0.3 if abs(len(title) - len(q)) > 10 else 0.0

    return (
        exact * 2.0 +
        starts * 1.5 +
        contains * 1.0 +
        word_match * 1.2 +
        similarity * 0.5 +
        pop * 0.1
    ) - length_penalty
```

**Effect:** Exact/close titles always win. Long unrelated titles penalized. Multi-word queries behave correctly.

**File:** `backend/app/routers/search.py`

---

### 6.2 Search Pagination Stability

**Problem:** Paginating local + TMDB separately → same item on page 1 and page 2, or missing items.

**Fix — paginate after full stable sort:**

```python
all_results = list(merged_deduped_pool.values())
all_results.sort(key=lambda x: _relevance_score(x, query_str), reverse=True)

start = (page - 1) * limit
end = start + limit
return all_results[start:end]
```

Never paginate local and TMDB separately.

**File:** `backend/app/routers/search.py`

---

### 6.3 Cache TTL Discipline (Lightweight — your scale)

**Problem:** Unused keys accumulate. Old versions linger.

**Resolved TTL rules (all already correct or adjusted):**

| Key | TTL |
|-----|-----|
| `search:*` | 600s (10 min) |
| `movie:detail:*` | 3600s (1 hr) |
| `person:*:detail` | 86400s (24 hr) |
| `tmdb:credits:*` | 86400s (24 hr) |
| `tmdb:tv:*` | 86400s (24 hr) |
| `movie:trending` | 18000s (5 hr) |
| `home:top_rated` | 3600s (1 hr) |
| `home:genre:*` | 1800s (30 min) |
| `home:upcoming:*` | 1800s (30 min) |

No eviction system needed at current scale. Key prefix versioning only when schema changes.

---

### 6.4 Duplicate Persistence Race — In-Memory Lock

**Problem:** Parallel requests trigger same movie insert → wasteful ON CONFLICT calls.

**Fix — module-level in-memory lock dict:**

```python
_persist_locks: dict = {}

async def persist_safe(movie_id: int, db: AsyncSession, raw: dict):
    if movie_id in _persist_locks:
        return  # already in flight, skip
    _persist_locks[movie_id] = True
    try:
        await persist_movie_full(db, raw)
    finally:
        _persist_locks.pop(movie_id, None)
```

No Redis needed. Fine for 10–20 concurrent users.

**File:** `backend/app/routers/movies.py` (or shared `persist.py`)

---

### 6.5 Incomplete TMDB Data — Persist Guard

**Problem:** Movie without poster or title enters Supabase → bad UI rows.

**Rule (applied before any persist):**

```python
if (
    raw.get("poster_path") and
    raw.get("title") and
    raw.get("popularity", 0) >= 20
):
    await persist_safe(movie_id, db, raw)
else:
    # Redis only, skip Supabase
    await set_cached(cache_key, data, TTL_MOVIE_DETAIL)
```

**Files:** `movies.py`, `search.py` — both persist paths.

---

### 6.6 Cache Stampede — Per-Key In-Flight Lock

**Problem:** 5–10 concurrent users hit same cold endpoint → duplicate TMDB calls.

**Fix — in-flight task dict:**

```python
_inflight: dict[str, asyncio.Task] = {}

async def get_or_fetch(key: str, fetch_fn):
    cached = await get_cached(key)
    if cached:
        return cached

    if key in _inflight:
        await _inflight[key]  # wait for in-flight task
        return await get_cached(key)  # now should be cached

    task = asyncio.create_task(fetch_fn())
    _inflight[key] = task
    try:
        return await task
    finally:
        _inflight.pop(key, None)
```

Prevents duplicate TMDB calls under burst load.

**File:** `backend/app/db/cache.py` (new helper) or inline in each router.

---

### 6.7 Cache Version Map — Consistent Key Naming

**Problem:** Keys like v5, v2, ad-hoc naming → inconsistency over time.

**Fix — single version map in cache.py:**

```python
CACHE_VERSION = {
    "trending": "v1",
    "upcoming": "v5",
    "search":   "v2",
    "person_credits": "v2",
    "top_rated": "v1",
}

# Usage:
f"home:upcoming:{CACHE_VERSION['upcoming']}:{filter_type}"
f"search:{CACHE_VERSION['search']}:{hash_}"
```

Bump version in map when schema changes. Old keys expire naturally.

**File:** `backend/app/db/cache.py`

---

### 6.8 Invalidation Gaps — Complete Invalidation on Write

**Problem:** On rating/watch, only `user:recommendations:{uid}` invalidated. `movie:detail` and `movie:similar` serve stale data.

**Fix — complete invalidation set:**

```python
# On POST /ratings or POST /watch:
await invalidate(f"movie:detail:{movie_id}")
await invalidate(f"movie:similar:{movie_id}:movie")
await invalidate(f"user:recommendations:{user_id}")
```

**File:** `backend/app/routers/ratings.py`, `watch.py`

---

### 6.9 Person Credits — Hybrid Sort + Role Filter

**Problem:** Sort by popularity only → TV clutter + irrelevant appearances dominate Known For.

**Fix — hybrid score + order filter:**

```python
def _person_credit_score(item: dict) -> float:
    pop = item.get("popularity", 0.0)
    order = item.get("order", 999)
    return pop * 0.7 + (1 / (order + 1)) * 0.3

def _filter_person_credits(raw_credits: list) -> list:
    filtered = []
    for item in raw_credits:
        order = item.get("order", 999)
        dept = item.get("department", "Acting")
        char = (item.get("character") or "").lower()

        if order > 15:  # not a lead/supporting role
            continue
        if dept not in ["Acting", "Directing", "Writing"]:
            continue
        if any(x in char for x in ["himself", "herself", "self"]):
            continue
        if not item.get("poster_path"):
            continue
        filtered.append(item)

    filtered.sort(key=_person_credit_score, reverse=True)
    return filtered[:16]
```

**File:** `backend/app/routers/person.py`

---

### 6.10 Trending — Weighted Score + India Regional Mix

**Problem:** Day/week mix static. No regional relevance for Indian users.

**Fix part A — weighted day/week + recency boost:**

```python
from datetime import datetime

current_year = datetime.utcnow().year

def _trending_score(item: dict, source: str) -> float:
    pop = item.get("popularity", 0.0)
    day_boost = 1.3 if source == "day" else 1.0
    release_year = int((item.get("release_date") or "0000")[:4] or 0)
    recency_boost = 1.1 if release_year >= current_year else 1.0
    return pop * day_boost * recency_boost
```

**Fix part B — India regional top 4 injection:**

```python
india = [
    x for x in scored_results
    if x.get("original_language") == "hi"
]
india_top = sorted(india, key=lambda x: x["_score"], reverse=True)[:4]

picked_ids = {f"{x['id']}_{x.get('media_type')}" for x in india_top}
remaining = [x for x in scored_results if f"{x['id']}_{x.get('media_type')}" not in picked_ids]

final = india_top + remaining[:16]
```

Effect: India-relevant content always represented, global feed not broken.

**File:** `backend/app/routers/movies.py` `get_trending()`

---

### 6.11 Backend Schema Normalization — One Field Name

**Problem:** Backend returns `title` for movies, some places use `name`. Frontend breaks when field missing.

**Fix — normalize in backend before return:**

```python
def normalize_media(m: dict) -> dict:
    return {
        "id":          m.get("id"),
        "title":       m.get("title") or m.get("name") or "",
        "name":        m.get("title") or m.get("name") or "",  # alias both
        "poster_path": m.get("poster_path"),
        "release_year": m.get("release_year") or m.get("release_date", "")[:4],
        "vote_average": m.get("vote_average", 0.0),
        "media_type":  m.get("media_type", "movie"),
    }
```

Frontend consumes one schema. Both `title` and `name` always present.

**File:** `backend/app/routers/movies.py`, `tv.py`, `search.py` — all `_tmdb_to_search_result()` helpers.

---

### 6.12 Stale Supabase Data Refresh

**Problem:** Same movie: Supabase version outdated (popularity/vote_average changed), TMDB version fresh. Mismatch.

**Fix — background refresh on stale Supabase hit:**

```python
from datetime import timedelta

STALE_THRESHOLD = timedelta(days=7)

async def get_movie_by_id(movie_id, db):
    cached = await get_cached(key)
    if cached:
        return cached

    movie = await db_get_movie(db, movie_id)
    if movie:
        data = _movie_to_detail(movie)
        await set_cached(key, data, TTL_MOVIE_DETAIL)

        # Background refresh if stale
        if movie.fetched_at < datetime.utcnow() - STALE_THRESHOLD:
            asyncio.create_task(_background_refresh(movie_id, db))

        return data
    ...
```

Non-blocking. User gets cached data immediately. Refresh updates Supabase + Redis in background.

**File:** `backend/app/routers/movies.py`

---

### 6.13 Data Validation Guard Before Persist

**Problem:** Incomplete TMDB responses (no title, no poster) enter Supabase → bad rows.

**Global Persistence Rule (UNIFY ADD):**
All persistence MUST go through a single guard function: `_is_persistable(raw)`. No direct DB insert allowed outside this guard.

**Strict guard (must pass ALL):**

```python
def _is_persistable(raw: dict) -> bool:
    return bool(
        raw.get("title") and
        raw.get("poster_path") and
        raw.get("popularity", 0) >= 20
    )
    # runtime optional — do not block on missing runtime
```

Anything failing guard → Redis only, never Supabase.

---

### 6.14 Cold Start Personalization

**Problem:** New users (0 watch history) get generic empty recommendations.

**Fix — trending + top_rated mix as default:**

```python
async def get_recommendations(user_id, db):
    history = await get_watch_history(user_id, db)

    if len(history) < 3:
        # Not enough data — serve trending + top_rated mix
        trending = await get_trending(db)  # cached, fast
        top_rated = await get_top_rated(db)  # cached, fast
        combined = trending["movies"][:10] + top_rated["movies"][:10]
        random.shuffle(combined)
        return {"movies": combined[:20], "is_personalized": False}

    # Normal genre-affinity path
    ...
```

**File:** `backend/app/services/recommendation_service.py`

---

### 6.15 Observability — Minimal Logging

**Problem:** No visibility into cache hit rate or TMDB failure rate.

**Fix — add structured log lines (no tools needed):**

```python
# In get_cached():
logger.info(f"CACHE {'HIT' if value else 'MISS'}: {key}")

# In set_cached():
logger.info(f"CACHE SET: {key} TTL={ttl}s")

# In TMDB fetch:
if not raw:
    logger.warning(f"TMDB FAIL: {endpoint} id={id_}")
else:
    logger.debug(f"TMDB OK: {endpoint} id={id_} pop={raw.get('popularity', 0):.1f}")

# In persist:
logger.info(f"PERSIST: movie_id={movie_id} title={title!r} pop={pop:.1f}")
```

No Sentry/Datadog needed at current scale. Just grep logs.

**Files:** `cache.py`, `tmdb_service.py`, `movies.py`

---

## 7. Critical Fix Additions

### 1.1 — Search Ranking (CRITICAL FIX ADD)
**Add:**
- Replace any release_year DESC sorting
- Use relevance-based scoring (already defined in 6.1)

**Reason:**
Wrong ranking = broken search UX

### 1.3 — Search Execution Flow (CRITICAL FIX ADD)
**Add:**
- Run Supabase + TMDB in parallel (NOT fallback)
- Supabase query + TMDB multi_search must run concurrently

**Reason:**
Avoids 1–3s delay + fixes cold-start empty results

### 3.1 — Cache Stampede Protection (CRITICAL ADD)
**Add:**
- Implement per-key in-memory inflight lock
- If same cache key is already being fetched:
  → wait for existing request instead of calling TMDB again

**Reason:**
Prevents multiple TMDB calls → reduces latency spikes

### 3.3 — Movie Detail Cache Flow (CRITICAL FIX ADD)
**Modify flow:**
Replace:
`Movie NOT found → HTTP 404`
With:
`Movie NOT found in Supabase:`
`→ fetch from TMDB`
`→ return result`
`→ optionally persist (based on rules)`

**Reason:**
Prevents broken navigation / missing pages

### 3.6 — Search Cache Flow (CRITICAL FIX ADD)
**Add:**
- Always apply timeout on TMDB calls
- TMDB multi_search must have max timeout = 5 seconds

**Reason:**
Prevents request hanging / slow page load

### 3.6 — Search Result Processing (CRITICAL ADD)
**Add:**
- Before returning results:
  → remove items where poster_path is null

**Reason:**
Prevents broken UI + useless renders

### 3.6 — Cache Policy Adjustment (CRITICAL ADD)
**Add:**
- If TMDB returns empty or fallback data:
  → cache for short duration (10 seconds)

**Reason:**
Avoid repeated slow API calls
