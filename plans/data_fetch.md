# Data Fetch System — Movientum

## Overview

Movientum fetches movie data from external APIs (primarily TMDB) and stores locally in PostgreSQL. Goal: minimize external API calls, maximize speed, maintain data freshness. Smart caching at multiple layers prevents redundant network requests.

---

## Primary External Source: TMDB (The Movie Database)

**TMDB API** is the backbone of Movientum's movie catalog.

Why TMDB:
- Free tier available (with API key)
- Comprehensive data: 500,000+ movies
- Poster/backdrop images hosted on TMDB CDN
- Regular updates
- JSON REST API — easy to consume

What we fetch from TMDB:
- Movie metadata (title, overview, release date, runtime, genres)
- Cast and crew (director names, actor names)
- Poster and backdrop image paths
- Popularity scores, vote averages
- Similar movies
- Movie trailers (YouTube links via TMDB videos endpoint)

---

## Data Ingestion Pipeline

### Phase 1: Initial Seed (One-Time Bulk Import)

When platform launches, DB is empty. Need to populate with baseline data.

**Process:**
1. Call TMDB `/movie/popular` → get top 500 popular movies (20 per page × 25 pages)
2. Call TMDB `/movie/top_rated` → get top 500 rated movies
3. Call TMDB `/movie/upcoming` → get upcoming releases
4. For each movie ID: call TMDB `/movie/{id}` to get full details
5. For each movie: call TMDB `/movie/{id}/credits` to get directors
6. Store everything in PostgreSQL
7. Mark each movie with `fetched_at` timestamp

This initial seed runs as a one-time background script. May take 30–60 min depending on API rate limits.

**TMDB Rate Limit:** ~40 requests/10 seconds. Script uses delay between requests to stay within limit.

### Phase 2: Incremental Sync (Recurring)

Keep DB fresh without re-fetching everything.

**Daily sync (cron job, runs at 3 AM):**
1. Call TMDB `/movie/now_playing` → movies currently in theaters
2. Call TMDB `/movie/upcoming` → movies releasing soon
3. Check for new movie IDs not in our DB
4. Fetch full details for new movies only
5. Update `popularity` and `vote_average` for existing movies (these change daily)

**Weekly sync:**
1. Re-fetch top 1000 popular movies → update popularity scores
2. Check for data corrections (plot edits, release date changes)

### Phase 3: On-Demand Fetch (Search Fallback)

If user searches for movie not in local DB:
1. Search TMDB `/search/movie?query={term}`
2. Get results
3. Store any new movies found into local DB
4. Return results to user

This lazily expands local DB based on user searches.

---

## Caching Strategy

Three-tier caching. Each tier has different TTL (time-to-live).

### Tier 1: Application-Level (In-Memory, FastAPI)
- Small, fast
- Caches: TMDB configuration data (image base URLs), genre list
- TTL: 24 hours
- Implementation: Python `functools.lru_cache` or `cachetools.TTLCache`
- Why: Genre list never changes day-to-day. TMDB config very stable.

### Tier 2: Redis (Distributed Cache)
- Medium, shared across multiple backend instances
- Caches: individual movie objects, search results, trending lists, recommendations
- TTL:
  - Movie detail: 1 hour (changes rarely within day)
  - Trending list: 30 minutes (updates frequently)
  - Search results: 10 minutes (balance freshness vs speed)
  - User recommendations: 15 minutes

**Cache Key Design:**
```
movie:detail:{movie_id}
movie:trending:page:{page}
movie:genre:{genre_id}:page:{page}
search:results:{query_hash}
user:recommendations:{user_id}
```

**Cache Invalidation:**
- Movie data in DB updated → delete `movie:detail:{id}` key
- Trending list rebuilt → delete `movie:trending:*` keys
- User rates/watches movie → delete `user:recommendations:{user_id}` key

### Tier 3: PostgreSQL (Persistent Storage)
- Slowest but permanent
- All fetched data stored here
- Source of truth
- Redis is always populated FROM here (never opposite)

---

## Fetch Decision Logic

For every data request, backend follows this decision tree:

```
Request arrives for movie data
  │
  ├── Check Redis cache
  │     ├── HIT → return cached data (fast path, ~1ms)
  │     └── MISS ↓
  │
  ├── Check PostgreSQL DB
  │     ├── HIT + data is fresh (fetched_at < 24h ago)
  │     │     → load from DB, populate Redis, return
  │     │
  │     ├── HIT + data is stale (fetched_at > 24h ago)
  │     │     → return stale DB data immediately (fast)
  │     │     → trigger background refresh from TMDB
  │     │     → next request gets fresh data
  │     │
  │     └── MISS (movie not in DB at all)
  │           → fetch from TMDB API
  │           → store in DB
  │           → populate Redis
  │           → return to user
  │
  └── TMDB fetch fails (API down)
        → return whatever DB has (even stale)
        → log error, alert monitoring
```

This "stale-while-revalidate" pattern ensures users always get a fast response.

---

## Handling Missing Data

Not every movie has complete data. Graceful degradation:

| Missing Field | Fallback Strategy |
|---------------|------------------|
| `poster_path` | Show placeholder gradient card with movie title |
| `overview` | Show "No description available" |
| `runtime` | Omit runtime display entirely |
| `release_date` | Show "Unknown release date" |
| `director` | Show "Director info unavailable" |
| `vote_average = 0` | Show "Not yet rated" instead of "0.0" |
| Full TMDB data missing | Show minimal card with title only |

Frontend handles nulls gracefully — no crashes on missing fields.

---

## Poster and Image Handling

TMDB does not host images at a fixed URL. Base URL changes. Process:

### TMDB Image URL Construction
1. Fetch TMDB configuration endpoint: `GET /configuration`
2. Get `images.secure_base_url` (e.g., `https://image.tmdb.org/t/p/`)
3. Choose size: `w185`, `w342`, `w500`, `w780`, `original`
4. Combine: `{base_url}{size}{poster_path}`
5. Example: `https://image.tmdb.org/t/p/w500/xxxxxposter.jpg`

### Sizes Used in Movientum
- MovieCard thumbnail: `w342` (small, fast)
- Movie Detail hero: `w780` (large, high quality)
- Backdrop banner: `w1280`
- Small thumbnails (watchlist): `w185`

### Image Optimization
- Never store images in our own DB or server
- Always reference TMDB CDN directly → they handle bandwidth
- TMDB CDN globally distributed → fast for users worldwide
- Cache image URLs in Redis (so we don't recalculate every render)
- In future: use own CDN with TMDB as origin (proxy caching)

---

## API Rate Limit Management

TMDB free tier: 40 requests per 10 seconds.

Strategies to stay within limits:
1. **Local DB first**: Only hit TMDB when data missing or stale
2. **Request batching**: Group movie ID fetches, not one-by-one
3. **Cron jobs at off-peak hours**: Run sync at 3 AM
4. **Exponential backoff**: If rate limited (429 response) → wait 2s, 4s, 8s before retry
5. **Request queue**: Background fetch queue with rate-aware throttling

---

## Data Quality and Consistency

### Validation on Ingest
Before storing TMDB data:
- Check required fields present (id, title)
- Clamp numeric values (popularity, ratings must be ≥ 0)
- Sanitize text (remove HTML tags from overview)
- Validate date formats
- Skip adult content (flag movies with `adult: true` if content policy requires)

### Conflict Resolution
If TMDB updates a movie's data between our syncs:
- When re-fetching: overwrite all TMDB-sourced fields
- Preserve user-generated data (our ratings, watch history) — never overwrite from TMDB
- Log significant data changes (title change, major metadata update) for review
