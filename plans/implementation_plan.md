# Phase 3 Implementation Plan (Refactored)

## Current State Snapshot

| Layer | Status | Evidence |
|-------|--------|----------|
| DB schema (movies/genres/directors) | ✅ Done | `alembic/versions/20260526_...create_all_tables.py` |
| Users/ratings/watchlist tables | ✅ In migration | same migration file |
| Backend movies router | ✅ Done | `routers/movies.py` |
| Redis cache | ✅ Done | `config.py` |
| Frontend: Home, MovieList, MovieDetail | ✅ Done | `src/pages/` |
| Frontend: Aurora, BorderGlow, MovieCard | ✅ Done | `src/components/` |
| Frontend: `movieService.js`, `api.js` | ✅ Done (partial) | `src/services/`, `src/utils/` |
| Auth system | ❌ Not started | no `routers/auth.py`, no `utils/jwt_utils.py` |
| Search, Ratings, Watch, Recommendations routers | ❌ Not started | `routers/` has only `movies.py` |
| Frontend Login/Register/Dashboard/Search pages | ❌ Not started | `pages/` has only Home/MovieList/MovieDetail |
| Frontend AuthContext, interceptors | ❌ Not started | no `context/` dir |
| Frontend ↔ Backend wiring (Phase 2C) | ⚠️ Partial | movies only; Home/MovieList still use dummy data |

> [!NOTE]
> One Alembic migration exists (`create_all_tables`). All tables including `users`, `ratings`, `watch_history`, `watchlist` appear to be in it. Run `alembic upgrade head` before Phase 3.1 to confirm tables exist.

---

## Pre-Phase Check (MANDATORY — run before 3.1)

```bash
# 1. Apply all migrations
alembic upgrade head

# 2. Verify tables exist (run in psql or Supabase SQL editor)
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('users','ratings','watch_history','watchlist');
# Expected: 4 rows returned
```

> [!WARNING]
> If any table is missing → create a new Alembic migration for missing tables before continuing. Do NOT proceed to Phase 3.1 with missing tables.

---

## Execution Order: STRICT

```
Pre-Phase Check → 3.1 → 3.2 → 3.3 → 3.4 → 3.5A → 3.5B → 3.5C
```

No phase skips. Each phase tested before next begins.

---

# Phase 3.1 — Auth Foundation

## Purpose
Build user identity system. Everything in 3.3, 3.4, 3.5 depends on this.

## Dependencies
- `users` table must exist in DB (run `alembic upgrade head`)
- Redis running (for token blacklist on logout)
- `python-jose`, `passlib[bcrypt]` in `requirements.txt`

## Inputs Required
- DB connection (already configured in `config.py`)
- Redis connection (already configured)
- `SECRET_KEY`, `ALGORITHM` env vars in `.env`

## Scope

### Backend Files to Create

#### [NEW] `backend/app/utils/jwt_utils.py`
```python
# create_access_token(user_id, email, role) → 60-min JWT
# create_refresh_token(user_id) → 30-day JWT
# decode_token(token) → payload dict or raises HTTP 401
```

#### [NEW] `backend/app/utils/password_utils.py`
```python
# hash_password(plain) → bcrypt hash (rounds=12)
# verify_password(plain, hashed) → bool
```

#### [NEW] `backend/app/utils/deps.py`
```python
# get_current_user(request) → FastAPI dependency, returns user payload or 401
# get_optional_user(request) → returns user or None
```

#### [NEW] `backend/app/schemas/user.py`
```python
# UserRegisterRequest, UserLoginRequest, UserResponse, TokenResponse
```

#### [NEW] `backend/app/routers/auth.py`
```
POST /api/v1/auth/register   → create user, return JWT + refresh
POST /api/v1/auth/login      → verify creds, return JWT + refresh
POST /api/v1/auth/refresh    → rotate refresh token
POST /api/v1/auth/logout     → blacklist jti in Redis (TTL = remaining lifetime)
GET  /api/v1/auth/me         → [AUTH] current user profile
```

**Auth rules:**
- bcrypt cost=12
- Access token: 60min, Refresh token: 30 days
- Same `"Invalid credentials"` for wrong email AND wrong password (no enumeration)
- Logout: store jti in Redis with TTL = remaining token lifetime

**Redis blacklist implementation:**
```python
# On logout:
key = f"auth:blacklist:{jti}"
await redis.set(key, "true", ex=remaining_seconds)

# In decode_token() — MUST check blacklist before accepting:
jti = payload.get("jti")
if await redis.get(f"auth:blacklist:{jti}"):
    raise HTTPException(status_code=401, detail="Token revoked")
```

#### [MODIFY] `backend/app/main.py`
Mount auth router:
```python
app.include_router(auth.router, prefix="/api/v1/auth")
```

## Endpoints
| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/auth/register` | public |
| POST | `/api/v1/auth/login` | public |
| POST | `/api/v1/auth/refresh` | refresh token |
| POST | `/api/v1/auth/logout` | access token |
| GET | `/api/v1/auth/me` | access token |

## What This Does NOT Include
- ratings, watchlist, watch history
- recommendations
- frontend changes
- email verification (OTP) — deferred to Phase 4

> [!NOTE]
> Email verification via OTP is intentionally excluded. Phase 3.1 uses email+password only. OTP flow planned for Phase 4.

## Outputs Produced
- Working register/login endpoints
- JWT access + refresh token flow
- `get_current_user` dependency ready for use in 3.3+

### Service Layer Files (Phase 3.1)

#### [NEW] `backend/app/services/auth_service.py`
```python
# authenticate_user(db, email, password) → User or None
# create_user(db, name, email, password) → User
# get_user_by_email(db, email) → User or None
# get_user_by_id(db, user_id) → User or None
```
> Routers call service functions — no raw DB queries in router handlers.

## Deliverable Test
```bash
# Register
POST http://localhost:8000/api/v1/auth/register
{"name": "Test User", "email": "test@test.com", "password": "password123"}
→ 201 + {access_token, refresh_token}

# Login
POST http://localhost:8000/api/v1/auth/login
{"email": "test@test.com", "password": "password123"}
→ 200 + {access_token, refresh_token}

# Protected
GET http://localhost:8000/api/v1/auth/me
Authorization: Bearer {access_token}
→ 200 + user profile
```

### Health Check
- `POST /auth/register` → 201, no 500s
- `POST /auth/login` → 200 with both tokens
- `GET /auth/me` with valid token → 200
- `GET /auth/me` with logged-out token → 401
- No unhandled exceptions in backend logs
- DB `users` table has inserted row

---

# Phase 3.2 — Search System

## Purpose
Independent feature: movie discovery. Has zero dependency on auth, ratings, or watchlist.

## Dependencies
- `movies` table with data (✅ already seeded)
- `search_vector` column + GIN index on `movies` table

## Inputs Required
- DB connection
- Movies already seeded (~800+ movies)

## Scope

### Step 1 — Setup SQL (MANDATORY, run once before this phase)
```sql
-- FTS column + index
ALTER TABLE movies ADD COLUMN IF NOT EXISTS search_vector tsvector;
UPDATE movies SET search_vector = to_tsvector('english', coalesce(title,'') || ' ' || coalesce(overview,''));
CREATE INDEX IF NOT EXISTS idx_movies_search_vector ON movies USING GIN(search_vector);
```

### Step 2 — Trigram Setup (OPTIONAL — improves autocomplete, not required for initial impl)
> Optional optimization: install only if Step 1 search is working and you want fuzzy matching
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_movies_title_trgm ON movies USING GIN(title gin_trgm_ops);
```

### Backend Files to Create

#### [NEW] `backend/app/schemas/search.py`
```python
# SearchResult, SearchResponse, AutocompleteItem
```

#### [NEW] `backend/app/routers/search.py`
```
GET /api/v1/search?q={query}&page=1    → FTS ranked results
GET /api/v1/search/autocomplete?q={q}  → top 8 title matches (cached 5min)
```

**Logic:**
- Full-text: `search_vector @@ websearch_to_tsquery(q)` ranked by `ts_rank + popularity`
- Autocomplete: `title ILIKE '{prefix}%'` LIMIT 8, Redis cache `search:auto:{prefix}` TTL 300s
  - If pg_trgm installed: use `title % q` for fuzzy match instead
- TMDB fallback: optional — skip if local results >= 5

#### [MODIFY] `backend/app/main.py`
```python
app.include_router(search.router, prefix="/api/v1/search")
```

## Endpoints
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/search?q=&page=` | public |
| GET | `/api/v1/search/autocomplete?q=` | public |

## What This Does NOT Depend On
- auth
- ratings / watchlist
- frontend

## Outputs Produced
- Search endpoint returning ranked movie results
- Autocomplete endpoint with caching

## Deliverable Test
```bash
GET http://localhost:8000/api/v1/search?q=inception
→ 200 + {results: [...], total, page}

GET http://localhost:8000/api/v1/search/autocomplete?q=inc
→ 200 + [{id, title, year, poster_url}, ...]  (max 8)
```

### Health Check
- `GET /search?q=inception` → 200 with ranked results
- `GET /search/autocomplete?q=in` → 200 with ≤8 items
- Second call to autocomplete same prefix → faster (Redis cache hit)
- No unhandled exceptions in logs

---

# Phase 3.3 — User Interaction Layer

## Purpose
Capture user behavior: ratings, watch history, watchlist. Powers recommendations in 3.4.

## Dependencies
- Phase 3.1 complete (auth + `get_current_user` dependency working)
- `ratings`, `watch_history`, `watchlist` tables exist in DB
- Redis running (for cache invalidation)

## Inputs Required
- Valid JWT access token (all endpoints are auth-gated)
- Movie IDs from existing movies table

### Pre-3.3 Ratings Schema Verification (MANDATORY)

Verify the `ratings` table uses a category column, not numeric score:

```sql
-- Check current column types:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'ratings';
```

**Expected:** `category` column with type `VARCHAR` or `USER-DEFINED` (Postgres enum).

**If a numeric `score` column exists instead:**
```python
# Create new Alembic migration:
# alembic revision --autogenerate -m "ratings_add_category_column"

# Migration content:
def upgrade():
    op.add_column('ratings', sa.Column('category', sa.String(), nullable=True))
    # Migrate existing data if any: op.execute("UPDATE ratings SET category='timepass' WHERE score IS NOT NULL")
    op.drop_column('ratings', 'score')  # only after data migrated
```

> [!WARNING]
> Do NOT proceed to implementing `routers/ratings.py` until `ratings.category` column (VARCHAR/Enum) is confirmed in DB.

## Scope

### Backend Files to Create

#### [NEW] `backend/app/schemas/rating.py`
```python
import enum

class RatingCategory(str, enum.Enum):
    skip = "skip"
    timepass = "timepass"
    go_for_it = "go_for_it"
    perfection = "perfection"

# RatingCreateRequest: { movie_id: int, category: RatingCategory }
# RatingResponse: { id, movie_id, user_id, category, created_at }
# DistributionResponse: { skip: int, timepass: int, go_for_it: int, perfection: int, total: int }
```

> [!IMPORTANT]
> Rating is **category-only** — no numeric score. All distribution logic uses category counts.

#### [NEW] `backend/app/routers/ratings.py`
```
POST   /api/v1/ratings                          → [AUTH] submit rating (upsert: 1 per user per movie)
GET    /api/v1/ratings/me                       → [AUTH] my ratings, paginated
GET    /api/v1/ratings/distribution/{movie_id}  → public, bucket counts
PUT    /api/v1/ratings/{id}                     → [AUTH] update own rating
DELETE /api/v1/ratings/{id}                     → [AUTH] delete own rating
```

**Rating logic:**
- UPSERT: one rating per user per movie (ON CONFLICT DO UPDATE)
- Categories: `skip` / `timepass` / `go_for_it` / `perfection` (enum string, no numeric score)
- Distribution: count rows per category for given movie_id
- Distribution cache: `rating:dist:{movie_id}` TTL 300s, invalidated on POST/PUT/DELETE
- On POST/PUT/DELETE ratings → also invalidate recommendation cache:
  ```python
  await redis.delete(f"user:recs:{user_id}")
  ```
- TMDB seed fallback if local ratings < 5

#### [NEW] `backend/app/services/rating_service.py`
```python
# upsert_rating(db, user_id, movie_id, category) → Rating
# get_distribution(db, movie_id) → dict[str, int]
# get_user_ratings(db, user_id, page, limit) → list[Rating]
# delete_rating(db, rating_id, user_id) → bool
```
> Routers call service functions — no raw DB queries in router handlers.

#### [NEW] `backend/app/schemas/watch.py`
```python
# WatchMarkRequest, WatchlistAddRequest, WatchStatusResponse, WatchlistItem, HistoryResponse
```

#### [NEW] `backend/app/routers/watch.py`
```
POST   /api/v1/watch                          → [AUTH] mark movie watched
GET    /api/v1/watch/history                  → [AUTH] watch history, paginated
POST   /api/v1/watch/watchlist                → [AUTH] add to watchlist
DELETE /api/v1/watch/watchlist/{movie_id}     → [AUTH] remove from watchlist
GET    /api/v1/watch/watchlist                → [AUTH] get watchlist
GET    /api/v1/watch/status/{movie_id}        → [AUTH] {watched: bool, watchlisted: bool}
```

#### [MODIFY] `backend/app/main.py`
```python
app.include_router(ratings.router, prefix="/api/v1/ratings")
app.include_router(watch.router, prefix="/api/v1/watch")
```

## Endpoints
| Method | Path | Auth |
|--------|------|------|
| POST | `/api/v1/ratings` | ✅ required |
| GET | `/api/v1/ratings/me` | ✅ required |
| GET | `/api/v1/ratings/distribution/{movie_id}` | public |
| PUT | `/api/v1/ratings/{id}` | ✅ required |
| DELETE | `/api/v1/ratings/{id}` | ✅ required |
| POST | `/api/v1/watch` | ✅ required |
| GET | `/api/v1/watch/history` | ✅ required |
| POST | `/api/v1/watch/watchlist` | ✅ required |
| DELETE | `/api/v1/watch/watchlist/{movie_id}` | ✅ required |
| GET | `/api/v1/watch/watchlist` | ✅ required |
| GET | `/api/v1/watch/status/{movie_id}` | ✅ required |

## What This Does NOT Include
- recommendations (3.4)
- frontend (3.5)

## Outputs Produced
- User rating data in DB (feeds 3.4)
- Watch history in DB (feeds 3.4)
- Watchlist in DB

## Deliverable Test
```bash
POST /api/v1/ratings  {"movie_id": 1, "category": "go_for_it"}
→ 201 + {id, movie_id, user_id, category: "go_for_it", created_at}

POST /api/v1/ratings  {"movie_id": 1, "category": "perfection"}  # same movie, upsert
→ 200 + {category: "perfection"}  # updated

GET /api/v1/ratings/distribution/1
→ 200 + {skip: 0, timepass: 0, go_for_it: 0, perfection: 1, total: 1}

POST /api/v1/watch  {"movie_id": 1}
→ 201 + {watched: true}

GET /api/v1/watch/status/1
→ 200 + {watched: true, watchlisted: false}
```

### Cache Invalidation (on watch + ratings mutations)
```python
# In ratings.py — POST, PUT, DELETE handlers:
await redis.delete(f"rating:dist:{movie_id}")
await redis.delete(f"user:recs:{user_id}")

# In watch.py — POST /watch handler:
await redis.delete(f"user:recs:{user_id}")
```

### Health Check
- `POST /ratings` → 201, row in DB
- `POST /ratings` same movie → 200 (upsert, not duplicate)
- `GET /ratings/distribution/{id}` → correct category counts
- `POST /watch` → 201
- `GET /watch/status/{id}` → `{watched: true, watchlisted: false}`
- Redis keys `rating:dist:*` and `user:recs:*` deleted after mutation

---

# Phase 3.4 — Recommendation System (Simplified)

## Purpose
Personalized picks using data from 3.3. Simple rule-based logic only — no ML.

## Dependencies
- Phase 3.3 complete (`watch_history`, `ratings` tables populated)
- Phase 3.1 complete (`get_current_user` working)
- Redis running (recommendation cache)

## Inputs Required
- User must have watch history or ratings (fallback to trending if empty)
- Movie genres table populated (✅ already done)

## Scope

### Backend Files to Create

#### [NEW] `backend/app/routers/recommendations.py`
```
GET /api/v1/recommendations               → [AUTH] personalized picks
GET /api/v1/recommendations/similar/{id}  → public, similar movies
```

**Rule-based logic (simple — no ML):**

`GET /recommendations`:
1. Get user's top 3 genres from `watch_history JOIN movie_genres` (by frequency)
2. Fetch movies in those genres NOT yet in watch_history → sort by `popularity DESC`
3. If result count < 20 → **backfill with trending movies** (exclude already-in-list):
   ```python
   if len(genre_movies) < 20:
       needed = 20 - len(genre_movies)
       trending = fetch_trending(db, exclude_ids=watched_ids + [m.id for m in genre_movies], limit=needed)
       genre_movies.extend(trending)
   ```
4. Always return exactly 20 movies (or all available if DB has < 20 total)
5. If user < 3 watched movies → skip step 1-3, return top 20 trending directly (source: `trending_fallback`)
6. Deduplicate by movie_id before returning
7. Cache: `user:recs:{user_id}` TTL 15min
8. Invalidation: `await redis.delete(f"user:recs:{user_id}")` triggered by 3.3 mutations (POST /watch, POST/PUT/DELETE /ratings)

`GET /recommendations/similar/{id}`:
1. Get genres of target movie
2. Fetch movies sharing >=1 genre, exclude target movie
3. Sort by `popularity DESC`, return top 10
4. Cache: `similar:{movie_id}` TTL 1hr

#### [MODIFY] `backend/app/main.py`
```python
app.include_router(recommendations.router, prefix="/api/v1/recommendations")
```

## Endpoints
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/v1/recommendations` | ✅ required |
| GET | `/api/v1/recommendations/similar/{id}` | public |

## What This Does NOT Include
- Director affinity blending
- Complex weighted scoring
- ML model calls (Phase 5)
- Frontend (3.5)

## Outputs Produced
- Recommendations endpoint → 20 movies
- Similar movies endpoint → 10 movies

## Deliverable Test
```bash
GET /api/v1/recommendations
Authorization: Bearer {token}
→ 200 + {movies: [...20 items], source: "genre_affinity" | "trending_fallback"}

GET /api/v1/recommendations/similar/550
→ 200 + {movies: [...10 items]}
```

### Health Check
- `GET /recommendations` with 3+ watched movies → 200, source: `genre_affinity`
- `GET /recommendations` with 0 watched movies → 200, source: `trending_fallback`
- No duplicate movies in response
- `GET /recommendations/similar/{id}` → target movie NOT in results
- Second call within 15min → faster (cache hit)

---

# Phase 3.5A — Frontend: Auth Integration

## Purpose
Wire auth system into frontend. Required before any protected page or user feature.

## Dependencies
- Phase 3.1 complete (all auth endpoints tested)
- Backend at `http://localhost:8000`, frontend at `http://localhost:5173`

## Inputs Required
- Existing `api.js` axios instance (`src/utils/api.js`)
- Existing `movieService.js` (`src/services/movieService.js`)

## Scope

### New Files (Phase 3.5A)

#### [NEW] `src/context/AuthContext.jsx`
```js
// state: { user, token, isLoggedIn, isLoading }
// methods: login(), register(), logout(), refreshToken()
// On mount: check localStorage → validate token → restore session
```

#### [NEW] `src/services/authService.js`
```js
// register(name, email, password)
// login(email, password)
// logout()
// refreshToken()
```

#### [NEW] `src/pages/Login.jsx` + `Login.css`
- Dark premium form: email + password + "Remember me"
- Inline validation, error display
- Redirect if already logged in, Aurora background

#### [NEW] `src/pages/Register.jsx` + `Register.css`
- Dark premium form: name + email + password + confirm + strength indicator
- Redirect if already logged in

### Modified Files (Phase 3.5A)

#### [MODIFY] `src/utils/api.js`
Add JWT interceptors:
- Request: attach `Authorization: Bearer {token}` from localStorage
- Response interceptor (with infinite loop prevention):

```js
let isRefreshing = false;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    // Skip retry for refresh endpoint itself — prevents infinite loop
    if (original.url?.includes('/auth/refresh')) {
      logout();
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && !original._retry && !isRefreshing) {
      original._retry = true;
      isRefreshing = true;
      try {
        await refreshToken();  // rotate tokens, update localStorage
        isRefreshing = false;
        return api(original);  // retry original request once
      } catch (refreshError) {
        isRefreshing = false;
        logout();              // force logout if refresh fails
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);
```

> [!IMPORTANT]
> The `isRefreshing` flag + `/auth/refresh` URL check together prevent infinite retry loops if the refresh token is also expired or revoked.

#### [MODIFY] `src/components/Navbar.jsx`
- Right: "Login" button (guest) OR avatar + dropdown (logged in)
- Dropdown items: Dashboard, Logout

#### [MODIFY] `src/App.jsx`
Add routes + ProtectedRoute wrapper:
```jsx
/login      → <Login />
/register   → <Register />
/dashboard  → <ProtectedRoute><Dashboard /></ProtectedRoute>
/search     → <Search />
```

## Deliverable Test (3.5A)
```
1. Register → redirected to Home, token in localStorage
2. Reload page → still logged in (session restored from localStorage)
3. Logout → token cleared, /dashboard redirects to /login
4. Login → session restored
5. Navbar shows avatar when logged in, "Login" button when guest
```

### Health Check
- Register flow works end-to-end
- Session persists on page reload
- Logout clears localStorage token
- Protected route redirects unauthenticated user
- axios interceptor attaches token to all requests

---

# Phase 3.5B — Frontend: Search Integration

## Purpose
Wire search backend into frontend. Independent of auth state (public feature).

## Dependencies
- Phase 3.2 complete (search endpoints tested)
- Phase 3.5A complete (Navbar exists, api.js configured)

### New Files (Phase 3.5B)

#### [NEW] `src/services/searchService.js`
```js
// search(query, page)
// autocomplete(prefix)
```

#### [NEW] `src/pages/Search.jsx` + `Search.css`
- Read `?q=` from URL → `GET /api/v1/search?q=...`
- MovieCard grid, empty state, loading skeletons

#### [NEW] `src/components/SearchBar.jsx` + `SearchBar.css`
- Debounced 300ms, >=2 chars → autocomplete
- Dropdown: 8 results (poster + title + year)
- Click → `/movies/{id}`, Enter → `/search?q=...`

### Modified Files (Phase 3.5B)

#### [MODIFY] `src/components/Navbar.jsx`
- Center: `SearchBar` component

## Deliverable Test (3.5B)
```
1. Type "inc" in Navbar → autocomplete dropdown appears
2. Click result → navigates to /movies/{id}
3. Press Enter → navigates to /search?q=inc
4. Search results page shows MovieCard grid
5. Empty query → empty state message shown
```

### Health Check
- Autocomplete fires after 300ms debounce, not on every keystroke
- Search page loads with `?q=` param
- Empty results show friendly message, not blank page
- No CORS errors in browser console

---

# Phase 3.5C — Frontend: User Features & API Wiring

## Purpose
Connect ratings, watchlist, recommendations. Replace all dummy data with live API calls.

## Dependencies
- Phase 3.3 complete (ratings/watch endpoints tested)
- Phase 3.4 complete (recommendations endpoint tested)
- Phase 3.5A complete (auth context available)
- Phase 3.5B complete (SearchBar in Navbar)

### New Files (Phase 3.5C)

#### [NEW] `src/services/ratingService.js`
```js
// submitRating(movieId, category)  ← category enum: skip|timepass|go_for_it|perfection
// getDistribution(movieId)
// getUserRating(movieId)
// deleteRating(id)
```

#### [NEW] `src/services/watchService.js`
```js
// markWatched(movieId)
// getHistory()
// addToWatchlist(movieId)
// removeFromWatchlist(movieId)
// getWatchlist()
// getStatus(movieId)
```

#### [NEW] `src/pages/Dashboard.jsx` + `Dashboard.css`
- Protected route (redirect to `/login?redirect=/dashboard` if not logged in)
- 3 tabs: Watch History / Watchlist / My Ratings
- Each tab: MovieCard grid from respective API

#### [NEW] `src/components/RatingMeter.jsx` + `RatingMeter.css`
- SVG semicircular gauge (Moctale Meter)
- 4 buckets: Skip `#FF4D6D` / Timepass `#FFC300` / Go for it `#00E5A0` / Perfection `#9B59FF`
- Center: dominant category % + total votes
- Guest: read-only. Logged-in: clickable pill buttons (sends category enum to API)

### Modified Files (Phase 3.5C)

#### [MODIFY] `src/pages/MovieDetail.jsx`
Add:
- `RatingMeter` → `GET /api/v1/ratings/distribution/{id}`
- "Mark Watched" button → `POST /api/v1/watch`
- "Add to Watchlist" button → `POST /api/v1/watch/watchlist`
- "Similar Movies" row → `GET /api/v1/recommendations/similar/{id}`

#### [MODIFY] `src/pages/Home.jsx`
Replace dummy data:
- Trending → `GET /api/v1/movies/trending`
- Genre rows → `GET /api/v1/movies?genre=Action&sort=popularity`
- "For You" row (logged-in only) → `GET /api/v1/recommendations`
- Hero → first trending movie

#### [MODIFY] `src/pages/MovieList.jsx`
- Paginated grid → `GET /api/v1/movies?page=N&genre=&sort=`
- Genre filter sidebar
- Sort dropdown: Popularity / Rating / Release Year

## Deliverable Test (3.5C)
```
1. Open MovieDetail → RatingMeter renders with distribution data
2. Rate movie (logged in) → select category pill → meter updates
3. Mark watched → Dashboard → Watch History shows it
4. Add to Watchlist → Dashboard → Watchlist shows it
5. Home page: Trending + genre rows load from API (no dummy data)
6. MovieList: genre filter + sort work
7. "For You" row visible only when logged in
8. Similar movies row appears on MovieDetail
```

### Health Check
- No `src/data/dummy.js` imports remaining in Home.jsx or MovieList.jsx
- RatingMeter shows correct category distribution
- Dashboard tabs each load data from correct endpoint
- Watched/Watchlisted state reflected on MovieDetail buttons
- Recommendations visible in "For You" row (logged-in users)

---

# Logging Requirement (Required — All Backend Phases)

Use structured logging across all routers. Pattern:

```python
import logging
logger = logging.getLogger(__name__)

# Auth
logger.info("USER_REGISTERED", extra={"user_id": user.id, "email": user.email})
logger.info("USER_LOGIN", extra={"user_id": user.id})
logger.warning("AUTH_FAILED", extra={"email": email, "reason": "invalid_password"})
logger.info("TOKEN_BLACKLISTED", extra={"jti": jti})

# Search
logger.info("SEARCH_QUERY", extra={"q": query, "results": len(results)})
logger.info("CACHE_HIT", extra={"key": cache_key})
logger.info("CACHE_MISS", extra={"key": cache_key})

# Ratings
logger.info("RATING_SUBMITTED", extra={"user_id": user_id, "movie_id": movie_id, "category": category})
logger.info("CACHE_INVALIDATED", extra={"keys": [f"rating:dist:{movie_id}", f"user:recs:{user_id}"]})

# Recommendations
logger.info("RECS_GENERATED", extra={"user_id": user_id, "source": source, "count": len(movies)})
logger.info("RECS_CACHE_HIT", extra={"user_id": user_id})
```

> [!NOTE]
> Apply these log calls inside the route handlers. No external logging library required — stdlib `logging` is sufficient.

---

# Master Verification Checklist

## Pre-Phase
- [ ] `alembic upgrade head` → no errors
- [ ] All 4 tables (`users`, `ratings`, `watch_history`, `watchlist`) visible in DB

## Phase 3.1
- [ ] `POST /api/v1/auth/register` → 201 + tokens
- [ ] `POST /api/v1/auth/login` → 200 + tokens
- [ ] `GET /api/v1/auth/me` with token → 200
- [ ] `GET /api/v1/auth/me` without token → 401
- [ ] Logout → `auth:blacklist:{jti}` key in Redis → `/me` returns 401

## Phase 3.2
- [ ] `GET /api/v1/search?q=inception` → ranked results
- [ ] `GET /api/v1/search/autocomplete?q=inc` → ≤8 results
- [ ] Cache hit on 2nd autocomplete call (same prefix)

## Phase 3.3
- [ ] `POST /api/v1/ratings` `{category: "go_for_it"}` → 201
- [ ] `POST /api/v1/ratings` same movie → 200 (upsert, category updated)
- [ ] `GET /api/v1/ratings/distribution/{id}` → category counts (no numeric scores)
- [ ] `POST /api/v1/watch` → 201
- [ ] `GET /api/v1/watch/status/{id}` → `{watched: true}`
- [ ] `POST /api/v1/watch/watchlist` → 201
- [ ] `DELETE /api/v1/watch/watchlist/{id}` → 204
- [ ] Redis keys `rating:dist:*` and `user:recs:*` invalidated after mutations

## Phase 3.4
- [ ] `GET /api/v1/recommendations` with history → 20 movies, source: `genre_affinity`
- [ ] `GET /api/v1/recommendations` with no history → source: `trending_fallback`
- [ ] `GET /api/v1/recommendations/similar/1` → ≤10 movies, movie 1 NOT in results
- [ ] Cache invalidated after new watch or rating

## Phase 3.5A
- [ ] Register → token in localStorage
- [ ] Reload → session restored
- [ ] Logout → token cleared, /dashboard → /login redirect
- [ ] axios interceptor attaches Bearer token
- [ ] Expired access token → refresh attempted, original request retried
- [ ] Failed refresh → logout triggered, no infinite loop

## Phase 3.5B
- [ ] SearchBar autocomplete fires with ≥2 chars
- [ ] Search page loads with ?q= param
- [ ] Empty query → empty state shown

## Phase 3.5C
- [ ] RatingMeter renders category distribution
- [ ] Rating pill click → submits category enum
- [ ] Dashboard 3 tabs load correct data
- [ ] Home.jsx has zero dummy.js imports
- [ ] "For You" row shows only when logged in
