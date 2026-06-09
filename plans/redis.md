# Movientum — Redis Optimization Plan

## 1. Current Redis Infrastructure

**Client:** `redis.asyncio` (Upstash TLS)  
**Module:** `backend/app/db/cache.py`  
**Pattern:** get → miss → fetch (DB/TMDB) → set  
**Stampede protection:** `inflight_lock` (asyncio.Event per key)  
**Serialization:** JSON (json.dumps / json.loads)  

### TTL Constants (current)
| Key Pattern | TTL | Notes |
|---|---|---|
| `movie:detail:{id}` | 3600s (1h) | Full movie detail |
| `movie:trending` | 18000s (5h) | Trending list |
| `movie:list:{hash}` | 1800s (30m) | Paginated list |
| `genre:all` | 86400s (24h) | Genre list |
| `search:v2:{hash}` | 600s (10m) | Search results |
| `autocomplete:{prefix}` | 300s (5m) | Autocomplete |
| `user:recommendations:{uid}` | 900s (15m) | Personalized recs |
| `tmdb:config` | 86400s (24h) | TMDB config |
| `news:articles` (hash) | permanent | News (TTL via sorted set) |
| `news:article_dates` (zset) | 3 day expire | Article expiry tracking |
| `explore:{hash}` | 600s (10m) | Explore page |
| `home:genre:{id}` | 1800s (30m) | Genre section |
| `home:top_rated` | 3600s (1h) | Top rated section |
| `home:upcoming:v5:{filter}` | 1800s (30m) | Upcoming section |
| `tv:detail:{id}` | 24h (popular-scaled) | TV detail |
| `tmdb:credits:{movie_id}` | 86400s (24h) | Movie credits |
| `tmdb:tv:{id}:credits` | 86400s (24h) | TV credits |
| `tmdb:person:{id}` | 86400s (24h) | Person detail |
| `person:{id}:credits:v3` | 3600s (1h) | Person credits |
| `rec:item:{id}:{type}:{uid}` | 900s (15m) | Similar items |
| `rating:dist:{movie_id}` | 300s (5m) | Rating distribution |
| `auth:blacklist:{jti}` | TTL=token remaining | Logout blacklist |

---

## 2. Current Redis Usage — Per Page

### 2.1 Home Page
**Frontend calls:** trending, top_rated, upcoming, genre sections  
**API endpoints:** `/movies/trending`, `/movies/top_rated`, `/movies/upcoming`, `/movies/genre/{id}`

**Current logic:**
```
GET movie:trending           → HIT → return immediately
                             → MISS → inflight_lock → 4x parallel TMDB calls → merge/sort → SET (5h TTL)

GET home:top_rated           → HIT → return
                             → MISS → 2x parallel TMDB → merge → SET (1h TTL)

GET home:upcoming:v5:{filter}→ HIT → return
                             → MISS → 2x parallel TMDB → date-filter → SET (30m TTL)

GET home:genre:{id}          → HIT → return
                             → MISS → 4x parallel TMDB → merge → SET (30m TTL)
```

**Problems:**
- Home loads 4+ API calls on first page load (all miss simultaneously on cold start)
- No prefetching/warming — cold start = 4 concurrent TMDB round trips stacked
- `home:genre:{id}` called per-genre-tab click. If 6 genres shown, 6 separate keys, all miss on cold start
- `movie:trending` inflight_lock good but others (`top_rated`, `upcoming`, genre) **lack** it → stampede risk on cache expiry

**Fix:**
- Add `inflight_lock` to `top_rated`, `upcoming`, `genre` routes (same as trending)
- Warm all home keys at startup (lifespan event) via background task
- Consider single combined `home:all` key returning {trending, top_rated, upcoming} → 1 round trip instead of 3+

---

### 2.2 Explore Page
**API endpoint:** `/movies/explore`  
**Cache key:** `explore:{md5(params)[:12]}`

**Current logic:**
```
GET explore:{hash}   → HIT → return
                     → MISS → 2x parallel TMDB discover → merge/sort/dedupe → SET (10m TTL)
```

**Problems:**
- High key cardinality: each unique filter combo = new key. 1000s of keys possible
- No inflight_lock → stampede on popular combos
- Genre list fetched from DB **every** request regardless of cache hit (line 406-407 in movies.py)
- 10m TTL is fine for data freshness but too short for popular combos (Action, Drama always hit)

**Measurements:**
- Default Explore (no filter) = `explore:{hash_of_defaults}` → very high hit rate potential
- But: genre DB query ALWAYS runs even on cache HIT (separate from cache path)

**Fix:**
- Cache the genre list separately (`genre:all` key, TTL 24h) — already exists but NOT used in explore endpoint
- Move genre list fetch BEFORE cache check so it too benefits from caching
- Actually: move genre fetch INTO the cache response — include `all_genres` in cached data
- Add `inflight_lock` on explore endpoint
- Increase TTL for popular no-filter combo to 30m; keep 10m for rare combos
- Consider `explore:genres_only` permanent key (genre names rarely change)

---

### 2.3 Movie Detail Page (`/movie/:id`)
**API endpoint:** `/movies/{movie_id}`, `/movies/{movie_id}/credits`, `/recommendations/similar/{id}`

**Current logic:**
```
GET movie:detail:{id}      → HIT → return full detail
                           → MISS → TMDB fetch + optional DB persist → SET (popularity-scaled TTL)

GET tmdb:credits:{id}      → HIT → return credits
                           → MISS → TMDB credits fetch → SET (24h TTL)

GET rec:item:{id}:movie:{uid} → HIT → return similar
                              → MISS → ML pipeline → SET (15m TTL)

GET rating:dist:{id}       → HIT → return distribution
                           → MISS → DB aggregate → SET (5m TTL)
```

**Problems:**
- Movie detail page fires 4 parallel requests (detail + credits + similar + rating dist) — all 4 can be cold miss simultaneously
- `movie:detail:{id}` inflight_lock **not used** in movie detail route (only trending uses it)
- `rec:item:{id}:movie:{uid}` is **per-user** key → authenticated users get no benefit from other users' computations for same movie
  - For "guest" users, key = `rec:item:{id}:movie:guest` → shared, good
  - For logged-in users, similar recs differ per user which is correct but expensive
- rating dist is per movie only (shared) — fine

**Fix:**
- Add `inflight_lock` to `movie:detail` route
- Split similar-recs into two-layer cache:
  - `rec:item:{id}:{type}:base` → public top-20 similar (TTL 1h, shared)
  - `rec:item:{id}:{type}:{uid}` → user-personalized re-ranking (TTL 15m, per-user)
- Prefetch credits when movie detail is fetched (fire-and-forget `asyncio.create_task`)
- Batch movie detail + rating dist into single Redis `MGET` call → 1 round trip instead of 2 separate GETs

---

### 2.4 TV Detail Page (`/tv/:id`)
**API endpoint:** `/tv/{tv_id}`, `/tv/{tv_id}/credits`

**Current logic:**
```
GET tv:detail:{id}         → HIT (validate title + poster_path) → return
                           → MISS → inflight_lock → TMDB fetch → SET (popularity-scaled)

GET tmdb:tv:{id}:credits   → HIT → return
                           → MISS → inflight_lock → TMDB credits + TMDB detail (AGAIN!) → SET (24h)
```

**Problems:**
- `get_tv_credits` calls `tmdb.fetch_tv_detail(tv_id)` to get `created_by` — **second TMDB detail call** if detail page wasn't cached yet
- If user navigates directly to credits route, TMDB detail is fetched twice (once for detail, once inside credits)

**Fix:**
- Cache `created_by` inside `tv:detail:{id}` payload — it's already fetched there
- Credits route reads `created_by` from `get_cached(key_tv_detail(tv_id))` before falling to TMDB detail
- Eliminates redundant TMDB API call for every TV credits request that misses cache

---

### 2.5 Search Page
**API endpoints:** `/search?q=`, `/search/autocomplete?q=`

**Current logic:**
```
GET search:v2:{hash}        → HIT → return
                            → MISS → inflight_lock → parallel (FTS + TMDB) → merge/score → SET (10m)

GET search:auto:{prefix}    → via search_service (external) → HIT or MISS → SET (5m)
```

**Problems:**
- Autocomplete fires on every keystroke. For 4-char prefix "star", key = `search:auto:star`
- If user types "star wars", prefix sequence: s, st, sta, star, star , star w, star wa, star war, star wars = 9 Redis GETs
- Each 5m TTL is fine but 9 round trips to Upstash (each ~20ms) = 180ms total overhead per search session
- No local in-memory prefix cache for autocomplete (could avoid Redis for common short prefixes)

**Fix:**
- Add in-memory LRU cache (Python `functools.lru_cache` or `cachetools.TTLCache`) for autocomplete results
  - `maxsize=500` entries, `TTL=60s` → serves most common prefixes without Redis
  - Redis still used as L2 cache (fallback + shared across workers)
- Deduplicate: if `q=star wars` is cached, subsequence `q=star war` can still return cached partial
- Use `search:auto:v2:{prefix}` key versioning so future algorithm changes don't serve stale data

---

### 2.6 News Page (`/news`)
**API endpoint:** `/news/feed/latest`, `/news/feed/for-you`

**Current logic:**
```
news:articles (Redis Hash)  → hvals() fetches ALL articles → score in Python → paginate
news:article_dates (ZSet)   → used only for expiry
```

**Problems:**
- `hvals("news:articles")` fetches **entire article store** every request (could be 100+ JSON objects × 2KB = 200KB per request)
- Scoring done in Python per request — not cached per user
- For-you feed: 4 DB queries run on every request to get user preferences (genres, watch history, titles, directors) — none cached
- Latest feed (`get_latest_feed`) also fetches all articles + sorts — no caching at all

**Fix:**
- Add per-user personalized feed cache: `news:feed:{user_id}` TTL 300s (5m)
  - Invalidate on watch/rating mutations
- Add global latest feed cache: `news:feed:latest:page={page}` TTL 120s (2m)
- Cache user preference data: `user:prefs:{user_id}` TTL 900s (15m) — genres + watch history
  - Avoid 4 DB queries per news request
- For score+sort: pre-compute article scores using sorted set
  - `news:scored:{user_id}` ZSet (member=article_id, score=personalization_score)
  - Rebuild on user activity change, serve by ZREVRANGE with pagination
  - Eliminates full fetch + Python sort on every request

---

### 2.7 Dashboard Page
**API endpoint:** `/ratings/me`, `/watch/history`, `/watch/watchlist`, `/recommendations`

**Current logic:**
```
GET /ratings/me        → NO CACHE → DB query every request
GET /watch/history     → NO CACHE → DB query every request
GET /watch/watchlist   → NO CACHE → DB query every request
GET /recommendations   → CACHE user:recommendations:{uid} TTL 15m
```

**Problems:**
- Dashboard fires 3 uncached DB queries every page load
- limit=1500 on ratings/me and history — fetching up to 1500 rows per request, no caching
- Recommendation is cached but ratings/history/watchlist are not

**Fix:**
- Add cache for ratings list: `user:ratings:{uid}` TTL 300s (5m)
  - Invalidate in `_invalidate_caches()` when rating mutated (already invalidates movie:detail etc)
- Add cache for watchlist: `user:watchlist:{uid}` TTL 300s (5m)
  - Invalidate on add/remove watchlist
- Add cache for watch history: `user:history:{uid}` TTL 300s (5m)
  - Invalidate on mark_watched / remove_watch
- These are small payloads (list of IDs + basic movie info) — ideal for Redis

---

### 2.8 Auth (Login / Register / Logout)
**API endpoints:** `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/auth/me`

**Current logic:**
```
POST /auth/logout       → SET auth:blacklist:{jti} with TTL = remaining token lifetime
GET  /auth/me           → decode JWT → DB user lookup → NO CACHE
Refresh token           → NO Redis storage of refresh tokens (stateless)
```

**Problems:**
- `/auth/me` hits DB on every navbar load (every page) — fetches user by id from DB
- No rate limiting on login attempts via Redis
- Refresh tokens are stateless (no Redis tracking) → can't invalidate before expiry

**Fix:**
- Cache `/auth/me` response: `user:profile:{uid}` TTL 300s (5m)
  - Invalidate on profile update
- Add Redis-based rate limiting for login: `ratelimit:login:{ip}` → INCR + EXPIRE
  - Allow 10 attempts per 60s per IP — lock for 15m after exceeded
- Optionally store refresh token jti in Redis set `auth:refresh:{uid}` → enables logout-all-devices

---

### 2.9 Person / Company / Country Pages
**API endpoints:** `/person/{id}`, `/person/{id}/credits`

**Current logic:**
```
GET tmdb:person:{id}       → HIT → return
                           → MISS → TMDB fetch → SET (24h if complete, 600s if incomplete)

GET person:{id}:credits:v3 → HIT → return
                           → MISS → TMDB credits fetch → SET (1h)
```

**Status:** ✅ Good — 24h TTL covers essentially all visits. No issues.

**Minor fix:**
- Both person detail and credits fetched separately — consider combining into single `tmdb:person:{id}:full` key
  - Saves 1 Redis round trip per person page if user loads both sections
  
---

## 3. Optimization Impact Calculations

### Assumptions (Baseline)
| Factor | Value |
|---|---|
| Upstash Redis round trip | ~20ms (from India to EU) |
| TMDB API call latency | ~400ms avg |
| Supabase DB query latency | ~80ms avg |
| Python scoring (news, search) | ~5ms per 100 items |
| Concurrent users (peak) | ~50 |

---

### 3.1 Home Page Improvement

**Current cold start (first user):**
```
trending  = inflight_lock + 4× TMDB (parallel) = 400ms
top_rated = 2× TMDB (parallel)                  = 400ms
upcoming  = 2× TMDB (parallel)                  = 400ms
genre ×3  = 4× TMDB (parallel) × 3              = 400ms × 3 = 1200ms

Total cold start wall time (all parallel): ~400-500ms
But without inflight_lock on top_rated/upcoming/genre:
50 concurrent users × 400ms each = 50 TMDB calls simultaneously on expiry
```

**After fix (inflight_lock + startup warm):**
```
Cold start: 0ms (pre-warmed at startup)
Cache HIT: 20ms (single Redis GET)
Stampede: eliminated — 50 users on expiry → 1 TMDB call, 49 wait on event

Saving per cache-miss event: 49 × 400ms = 19.6s of TMDB time eliminated
Saving per cached request: 400ms → 20ms = 380ms saved per request
Throughput improvement: 20× (from 2.5 req/s to 50 req/s per endpoint)
```

---

### 3.2 Movie Detail Page Improvement

**Current:**
```
4 parallel requests on page load:
  detail:  20ms cache HIT or 400ms MISS
  credits: 20ms HIT or 400ms MISS  
  similar: 20ms HIT or 400ms MISS (shared for guest)
  dist:    20ms HIT or 80ms MISS (DB only)

Cold miss: max(400, 400, 400, 80) = 400ms (parallel)
All HIT: max(20, 20, 20, 20) = 20ms
```

**After fix (prefetch credits + MGET for detail+dist):**
```
detail + dist: 1 MGET = 20ms (was 2 × 20ms = 40ms sequential)
credits: pre-warmed from detail fetch → 0ms extra
similar: unchanged

Saving: 20ms per detail page load (minor but compounds)
Prefetch credit warm: eliminates cold miss for credits if detail already cached
Credit cold miss rate: drops from ~30% to ~5% (credits warmed when detail is set)
```

---

### 3.3 Explore Page Improvement

**Current: genre list DB query on every request (even cache HIT)**
```
Per explore request: 1 Redis GET (20ms) + 1 DB SELECT genres (80ms) = 100ms minimum
Cache HIT still costs 80ms DB query!
```

**After fix (include all_genres in cached payload):**
```
Cache HIT: 1 Redis GET = 20ms
Cache MISS: TMDB (400ms) + SET cache (20ms) = 420ms (genres included in payload)

Saving on HIT: 80ms eliminated → 4× faster on cache hits
Cache hit rate for default explore: ~85% (10m TTL, popular combo)
Expected avg latency: 0.85 × 20ms + 0.15 × 420ms = 17ms + 63ms = 80ms
Was: 0.85 × 100ms + 0.15 × 500ms = 85ms + 75ms = 160ms
Improvement: 160ms → 80ms = 2× faster average response
```

---

### 3.4 Search Autocomplete Improvement

**Current (9 keystrokes to type "star wars"):**
```
9 × Redis GET = 9 × 20ms = 180ms total Redis overhead
First keystroke always MISS → TMDB call = 400ms
```

**After fix (in-memory LRU L1 cache, TTL 60s):**
```
Common prefix ("star") → L1 HIT → 0ms
New prefix → L2 Redis GET → 20ms
L1 cache hit rate for returning users: ~70% (same prefixes repeated)

Saving: 9 keystrokes → ~6 L1 hits (0ms) + 3 L2 hits (20ms) = 60ms total
Was: 9 × 20ms = 180ms
Improvement: 180ms → 60ms = 3× faster for returning user sessions
```

---

### 3.5 News Feed Improvement

**Current (for-you feed):**
```
4 DB queries on every request:
  genre prefs:     80ms
  watch history:   80ms  
  movie titles:    80ms
  director names:  80ms
  = 320ms DB overhead per request

hvals("news:articles") = fetch ALL articles = assume 100 × 2KB = 200KB per request
Python score sort: ~10ms

Total: 320ms DB + 20ms Redis + 10ms Python = 350ms
```

**After fix (cache user prefs + cache scored feed):**
```
user:prefs:{uid} HIT (300s TTL):
  0ms DB overhead
  hvals → 20ms Redis
  score + paginate: 10ms
  Total: 30ms

user:prefs:{uid} MISS:
  320ms DB → cache → then 30ms serving
  Only on first request or after cache expiry (5m)

news:feed:{uid} HIT (5m TTL):
  20ms single Redis GET
  Total: 20ms

Expected avg (80% prefs cached):
  Was: 350ms constant
  Now: 0.80 × 30ms + 0.20 × 350ms = 24ms + 70ms = 94ms
  Improvement: 350ms → 94ms = 3.7× faster

If news:feed:{uid} also cached:
  0.90 × 20ms + 0.10 × 350ms = 18ms + 35ms = 53ms
  Improvement: 350ms → 53ms = 6.6× faster
```

---

### 3.6 Dashboard Page Improvement

**Current:**
```
3 uncached DB queries on every page load:
  ratings/me:    80ms (up to 1500 rows)
  watch/history: 80ms (up to 1500 rows)
  watchlist:     80ms
  recommendations: 20ms Redis HIT (15m TTL)
  Total: 240ms + 20ms = 260ms
```

**After fix (cache all three with 5m TTL):**
```
All 3 HIT: 3 × 20ms = 60ms (or 1 MGET = 20ms)
All 3 MISS: 3 × 80ms DB + 3 × 20ms SET = 300ms (then cached)

Expected (90% hit rate after first load):
  Was: 260ms constant
  Now: 0.90 × 60ms + 0.10 × 300ms = 54ms + 30ms = 84ms
  Improvement: 260ms → 84ms = 3× faster
  
With MGET batching (1 round trip instead of 3):
  HIT: 20ms instead of 60ms
  Even better: 260ms → 50ms = 5.2× faster
```

---

## 4. Summary: All Improvements

| Page | Issue | Fix | Latency Before | Latency After | Speedup |
|---|---|---|---|---|---|
| **Home** | No inflight_lock on 3/4 endpoints + cold start | inflight_lock + startup warm | 400ms (cold) | 20ms (warm) | **20×** |
| **Explore** | DB genre query on every request incl. cache HIT | Cache genres inside payload | 100ms (HIT) | 20ms (HIT) | **5×** |
| **Movie Detail** | 2 serial Redis GETs (detail+dist) | MGET batch | 40ms | 20ms | **2×** |
| **TV Credits** | Double TMDB detail fetch | Read from cached TV detail | 400ms (miss) | 20ms (hit) | **20×** |
| **Search Autocomplete** | 9 Redis GETs per session | L1 in-memory LRU cache | 180ms | 60ms | **3×** |
| **News Feed (for-you)** | 4 DB queries every request | Cache user prefs + scored feed | 350ms | 53ms | **6.6×** |
| **Dashboard** | 3 uncached DB queries | Cache ratings/history/watchlist | 260ms | 50ms | **5.2×** |
| **Auth (/me)** | DB lookup on every page | Cache user profile 5m | 80ms | 20ms | **4×** |

---

## 5. Implementation Priority (Ordered by ROI)

### 🔴 Priority 1 — Highest Impact, Low Effort
1. **Fix Explore genre list caching** — 3 lines of code, 5× speedup on cache HITs
2. **Add inflight_lock to top_rated, upcoming, genre routes** — 6 lines per route, eliminates stampedes
3. **Cache Dashboard: ratings/history/watchlist** — 3 Redis SET calls + 3 key invalidations

### 🟡 Priority 2 — Medium Impact
4. **Cache /auth/me response** — 1 SET + 1 GET = 4× speedup on every page navigation
5. **Cache news user prefs** — 15m TTL cache for 4 DB queries = 3.7× news feed speedup
6. **Cache news:feed:{uid}** — 5m TTL for scored feed = 6.6× total news speedup

### 🟢 Priority 3 — Polish
7. **In-memory LRU for autocomplete** — 3× search typing speedup
8. **MGET batching for movie detail + rating dist** — 2× improvement on detail page
9. **TV credits read from cached TV detail** — eliminates duplicate TMDB call
10. **Prefetch credits when movie detail fetched** — fire-and-forget, improves credit cache warm rate
11. **Startup cache warm** — pre-warm trending/top_rated/upcoming at lifespan start

---

## 6. New Cache Keys to Add

```python
# Dashboard caches
"user:ratings:{uid}"         TTL=300s   # GET /ratings/me
"user:watchlist:{uid}"       TTL=300s   # GET /watch/watchlist
"user:history:{uid}"         TTL=300s   # GET /watch/history

# Auth
"user:profile:{uid}"         TTL=300s   # GET /auth/me

# News
"user:prefs:{uid}"           TTL=900s   # genre prefs + watch data
"news:feed:{uid}:p{page}"   TTL=300s   # scored personalized feed
"news:feed:latest:p{page}"  TTL=120s   # unpersonalized latest feed

# Autocomplete (L1 in-memory, NOT Redis)
TTLCache(maxsize=500, ttl=60)  # in app process memory

# Explore (modification — embed all_genres in payload)
# No new key — include all_genres in existing explore:{hash} cached response
```

---

## 7. Invalidation Map (additions needed)

| Event | Keys to Invalidate |
|---|---|
| Rating submit/update/delete | `user:ratings:{uid}`, `user:history:{uid}` (unchanged), `rating:dist:{movie_id}`, `movie:detail:{movie_id}` |
| Mark watched | `user:history:{uid}`, `user:prefs:{uid}`, `news:feed:{uid}:*`, `user:recommendations:{uid}` |
| Watchlist add/remove | `user:watchlist:{uid}` |
| Profile update | `user:profile:{uid}` |

---

## 8. Redis Memory Estimate

| Key Group | Count | Avg Size | Total |
|---|---|---|---|
| movie:detail | 5,000 | 2KB | 10MB |
| tv:detail | 1,000 | 2KB | 2MB |
| user:recommendations | 100 users | 10KB | 1MB |
| user:ratings | 100 users | 15KB | 1.5MB |
| user:history | 100 users | 15KB | 1.5MB |
| user:watchlist | 100 users | 5KB | 0.5MB |
| user:profile | 100 users | 0.5KB | 50KB |
| user:prefs | 100 users | 1KB | 100KB |
| news:articles (hash) | 150 articles | 2KB | 300KB |
| explore combos | 200 | 5KB | 1MB |
| search results | 500 | 3KB | 1.5MB |
| autocomplete | 300 | 1KB | 300KB |
| home keys | 20 | 10KB | 200KB |
| **Total estimate** | — | — | **~20MB** |

Upstash free tier = 256MB → well within limits even at 5× user growth.

---

## 9. Monthly Command Budget & 500k Limit Analysis

With a monthly budget of **500,000 commands** (Upstash Free Tier), optimizing both the **read pattern** and **write pattern** is essential. The current usage is **7.2K commands** (1,779 writes, 5,407 reads).

### 9.1 Redis Command Cost per Page Load / User Action

We optimize the total Redis requests by using batching (`MGET` / `MSET`), Process-Memory Caching (L1), and increasing TTLs for slow-changing pages.

| Page / Action | Redis Read Commands | Redis Write Commands | Optimization / Notes |
|---|---|---|---|
| **Home Page** | 3 (MGET/GET) | 0 (or 3 SETs on miss) | Uses `inflight_lock` to prevent parallel write stampedes. |
| **Explore Page** | 1 (GET) | 0 (or 1 SET on miss) | Genre list embedded in movie response, saving 1 command. |
| **Movie / TV Detail** | 1 (MGET) | 0 (or 1 MSET on miss) | Batches detail + ratings distribution using `MGET` (saves 1 read). |
| **Search Autocomplete**| 0 (L1 Local Cache) | 0 | Cached in-memory via `TTLCache`. **Saves ~9 Redis commands per search.** |
| **Search Results** | 1 (GET) | 0 (or 1 SET on miss) | Cache TTL 10m. |
| **News Feed** | 1 (GET) | 0 (or 1 SET on miss) | Scored feed cached per user (TTL 5m). |
| **Dashboard** | 1 (MGET) | 0 (or 1 MSET on miss) | Batches history + watchlist + ratings (saves 2 reads). |
| **Auth /me** | 1 (GET) every 5m | 0 (or 1 SET on miss) | Cached on client/server (TTL 5m). Reduces read commands per navigation. |
| **User Invalidation** | 0 | 1 - 4 (DEL/UNLINK) | Triggered only on writing/updating a rating, watchlist, or profile. |

---

### 9.2 Monthly Projections & Capacity Limits

Assuming a 90% cache HIT rate (where hits only read, and misses read + write):

* **Average Commands per Page View / Navigation:** ~1.2 commands (Mostly reads, occasional write on miss)
* **Average Commands per User Session (~15 min, 15 page views):** ~18 commands

#### Projections for 5-10 Active Users:
* With **5–10 active users** averaging **3 active sessions per day** (90–180 total sessions/day):
  * **Daily usage:** ~1,620 to ~3,240 commands/day
  * **Monthly usage:** **~48,600 to ~97,200 commands/month**
  * **Budget consumption:** Only **~9.7% to ~19.4%** of the 500,000 monthly limit.
* Even with heavier usage (e.g., 5 sessions per user per day), monthly usage remains at ~162,000 commands (~32% of the limit), leaving a large safety headroom.

#### Absolute Maximum Capacity:
* **~416,000 page views/month** (at ~1.2 commands/view)
* **~27,000 full user sessions/month** (at ~18 commands/session)


---

