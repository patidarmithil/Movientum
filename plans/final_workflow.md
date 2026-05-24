# Final Workflow — Movientum Complete System

Read this document to understand the entire Movientum system. Every component, every connection, every user action — explained end to end. After reading this, any developer can understand what happens when a user clicks anything on the platform.

---

## 1. High-Level System Overview

### Physical Components

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MOVIENTUM PLATFORM                               │
│                                                                         │
│  User's Browser                                                         │
│  ┌─────────────────────────────────┐                                    │
│  │   React SPA (Single Page App)   │                                    │
│  │   Pages: Home, Movies, Search,  │                                    │
│  │   Dashboard, Login, MovieDetail │                                    │
│  └──────────────┬──────────────────┘                                    │
│                 │ HTTPS JSON requests                                    │
│                 ▼                                                        │
│  ┌─────────────────────────────────┐                                    │
│  │    NGINX (Reverse Proxy /       │                                    │
│  │          API Gateway)           │                                    │
│  │  SSL · CORS · Rate Limit · Route│                                    │
│  └─────────┬────────────┬──────────┘                                    │
│            │            │                                               │
│     /api/* │     /* (SPA│static files)                                  │
│            ▼            ▼                                               │
│  ┌──────────────────┐  Frontend static HTML/JS served directly          │
│  │  FASTAPI BACKEND │                                                   │
│  │  (4 workers)     │                                                   │
│  │  Middleware:     │                                                   │
│  │  Auth·Log·Error  │                                                   │
│  │  Routers →       │                                                   │
│  │  Services →      │                                                   │
│  │  Repositories    │                                                   │
│  └──┬──────┬────────┘                                                   │
│     │      │                                                            │
│     ▼      ▼                                                            │
│  ┌──────┐ ┌──────┐ ┌─────────────────┐ ┌────────────────┐             │
│  │ PG   │ │Redis │ │  CELERY WORKER  │ │  EXTERNAL APIs │             │
│  │ DB   │ │Cache │ │  (Background)   │ │  TMDB · News   │             │
│  └──────┘ └──────┘ └─────────────────┘ └────────────────┘             │
└─────────────────────────────────────────────────────────────────────────┘
```

### How Components Talk

| From | To | Protocol | What Travels |
|------|----|----------|-------------|
| Browser | Nginx | HTTPS | HTTP requests + JWT in header |
| Nginx | FastAPI | HTTP (internal) | Same request, forwarded |
| FastAPI | PostgreSQL | TCP (asyncpg) | SQL queries → row data |
| FastAPI | Redis | TCP | GET/SET key-value |
| FastAPI | TMDB/NewsAPI | HTTPS | REST calls → JSON |
| FastAPI | Celery | Redis queue | Task messages |
| Celery | PostgreSQL | TCP | DB writes from background tasks |

### Data Flow Logic (Every Request)

```
1. Request arrives (e.g., GET /api/v1/movies/123)
2. Nginx validates origin, checks rate limits, routes to FastAPI
3. FastAPI Auth Middleware: validates JWT → attaches user to request
4. Router: matches path → calls service function
5. Service: checks Redis cache
     → HIT: return cached data (fast path, ~1ms)
     → MISS: call repository → DB query → enrich → cache in Redis → return
6. Router: serialize response to JSON via Pydantic model
7. FastAPI returns JSON with HTTP status code
8. Nginx passes response to browser
9. React: updates state → re-renders UI
```

### Caching Layer

```
Request hits Redis first. Database only hit on cache miss.

Cache key format:
  movie:detail:{id}              TTL: 1hr
  movie:trending                 TTL: 30min
  movie:list:{hash(params)}      TTL: 30min
  search:results:{query_hash}    TTL: 10min
  search:autocomplete:{prefix}   TTL: 5min
  user:recommendations:{user_id} TTL: 15min
  news:feed:global               TTL: 2hr

Cache invalidation:
  User rates/watches movie → delete user:recommendations:{user_id}
  Movie data updated → delete movie:detail:{id}
  New ML model deployed → delete user:recommendations:* (all users)
```

---

## 2. User Journey Workflows

### Workflow 2.1: Signup Flow

**Entry point:** User clicks "Sign Up" on any page.

```
Browser: Navigate to /register
  ↓
React renders <RegisterPage>
  ↓
User fills form: name, email, password, confirm password
  ↓
Frontend validation (instant, no API call):
  ├── All fields filled? → show red border if not
  ├── Email format valid? (regex) → show "Invalid email"
  ├── Password ≥ 8 chars? → show "Password too short"
  └── Passwords match? → show "Passwords do not match"
  ↓
User clicks "Create Account" (passes frontend validation)
  ↓
authService.register(name, email, password) called
  ↓
POST https://movientum.com/api/v1/auth/register
  Body: { name, email, password }
  ↓
Nginx: rate limit check (max 10 registrations/hr/IP)
  → If exceeded: 429 Too Many Requests → frontend shows "Try again later"
  ↓
FastAPI auth_router.register():
  ↓
auth_service.register_user(name, email, password):
  1. Validate email format + password strength
  2. SELECT COUNT(*) FROM users WHERE email = ?
       → If > 0: raise DuplicateEmailException
  3. bcrypt.hash(password, rounds=12) → password_hash
  4. INSERT INTO users (UUID, email, username, password_hash, created_at, role='user')
  5. create_access_token(user_id, email, role) → JWT (exp: 1hr)
  6. create_refresh_token(user_id) → JWT (exp: 30 days)
  7. Return { token, refresh_token, user: {id, email, username, role} }
  ↓
HTTP 201 Created response
  ↓
Frontend authService receives response:
  1. localStorage.setItem('access_token', token)
  2. localStorage.setItem('refresh_token', refresh_token)
  3. AuthContext.login(user, token) → sets state: isLoggedIn=true, user={...}
  ↓
Navigate to /onboarding (genre preference selection)
  ↓
User selects 3+ favorite genres → POST /api/v1/users/preferences
  ↓
Navigate to Home page
  → "For You" row now visible (uses genre preferences for rule-based recs)
```

**Error paths:**
- Email already exists → 409 → "This email is already registered. Login instead?"
- Password too weak → 400 → "Password must be 8+ chars with number and special char"
- Server error → 500 → "Something went wrong. Please try again."

---

### Workflow 2.2: Login Flow

**Entry point:** User clicks "Login" or is redirected from protected route.

```
Browser: Navigate to /login (or /login?redirect=/dashboard)
  ↓
React renders <LoginPage>
  ↓
User fills email + password → clicks "Login"
  ↓
authService.login(email, password) called
  ↓
POST /api/v1/auth/login
  Body: { email, password }
  ↓
Nginx: rate limit check (max 5 login attempts/min/IP → 429 if exceeded)
  ↓
FastAPI auth_service.login():
  1. SELECT * FROM users WHERE email = ?
       → No user found: return 401 "Invalid credentials"
         (same error as wrong password — prevents email enumeration)
  2. bcrypt.verify(submitted_password, stored_hash)
       → No match: return 401 "Invalid credentials"
  3. Check is_active == True
       → False: return 403 "Account disabled"
  4. Generate access + refresh tokens
  5. Return 200: { token, refresh_token, user }
  ↓
Frontend:
  1. Store tokens in localStorage
  2. Set AuthContext: isLoggedIn=true, user={...}
  3. Read redirect param: /login?redirect=/dashboard
       → Navigate to /dashboard
       → No redirect param → Navigate to /
```

**Token refresh (transparent to user):**
```
User is browsing. 1 hour passes. Access token expires.
  ↓
User clicks something → API call fires
  ↓
FastAPI returns 401 "Token expired"
  ↓
Axios response interceptor catches 401:
  1. POST /api/v1/auth/refresh { refresh_token }
  2. Backend validates refresh token → generates new access token
  3. Store new access token in localStorage
  4. Retry original failed request with new token
  ↓
User sees nothing — experience is seamless
```

**Logout:**
```
User clicks "Logout" in navbar dropdown
  ↓
authService.logout() called
  ↓
POST /api/v1/auth/logout (with current access token)
  ↓
Backend:
  1. Extract jti (token ID) from JWT
  2. Redis SETEX: "blacklist:{jti}" = "1" (TTL = token's remaining lifetime)
  3. Blacklist refresh token too
  ↓
Frontend:
  1. localStorage.removeItem('access_token')
  2. localStorage.removeItem('refresh_token')
  3. AuthContext.logout() → isLoggedIn=false, user=null
  4. Navigate to /login
```

---

### Workflow 2.3: Browse → Movie Detail → Watch → Rate

```
User is on Home page (/)
  ↓
Home page loads. Three parallel API calls fire:
  GET /api/v1/movies/trending          → "Trending Now" row
  GET /api/v1/recommendations          → "For You" row (auth required)
  GET /api/v1/movies?genre=action      → "Action" genre row
  ↓
Each API: check Redis cache → HIT: return fast / MISS: DB query + cache
  ↓
React: MovieCard grids render with real data
  ↓
─────────────── MOVIE DETAIL ───────────────
  ↓
User sees movie "Inception" — clicks MovieCard
  ↓
React Router: navigate to /movies/123
  ↓
MovieDetailPage mounts → three parallel API calls:
  GET /api/v1/movies/123                   → movie details
  GET /api/v1/recommendations/similar/123  → "Movies Like This"
  GET /api/v1/news/movie/123              → related articles
  GET /api/v1/watch/status/123            → [AUTH] have I watched this?
  ↓
All four resolve (independently, render as each arrives — no waterfall):
  → Poster, title, overview, genres, director render first
  → "Movies Like This" row renders when similar recs arrive
  → News articles render when news arrives
  → "Mark Watched" button state set (watched vs not watched) when status arrives
  ↓
─────────────── MARK WATCHED ───────────────
  ↓
User clicks "Mark as Watched" button
  ↓
watchService.markWatched(123) called
  ↓
POST /api/v1/watch
  Body: { movie_id: 123 }
  Headers: Authorization: Bearer {token}
  ↓
FastAPI watch_router.mark_watched():
  1. Auth middleware: validate JWT → user = {id: "uuid-abc"}
  2. watch_service.mark_watched(user_id, 123):
       → INSERT INTO watch_history (user_id, movie_id, watched_at)
         ON CONFLICT (user_id, movie_id) DO UPDATE SET watched_at=NOW()
  3. HTTP 201 Created
  4. Background task: invalidate Redis key "user:recommendations:uuid-abc"
  ↓
Frontend:
  → Button changes to green checkmark "Watched ✓"
  → No page reload needed
  ↓
─────────────── RATE MOVIE ───────────────
  ↓
User clicks "Rate This Movie" button
  ↓
<RatingModal> opens (overlay)
  Fields: Story (slider 0-10), Acting, Direction, Visuals, Overall (required)
  ↓
User adjusts sliders → clicks "Submit Rating"
  ↓
ratingService.submitRating({ movie_id:123, story:8, acting:9, direction:7.5, visuals:9, overall:8.5 })
  ↓
POST /api/v1/ratings
  Body: { movie_id: 123, story_score: 8.0, ... overall_score: 8.5 }
  ↓
FastAPI rating_service.create_rating():
  1. Validate: overall required, all scores 0≤x≤10
  2. INSERT INTO ratings (user_id, movie_id, story_score, ..., overall_score)
     ON CONFLICT (user_id, movie_id) DO UPDATE (upsert — allow re-rating)
  3. Background task: invalidate user:recommendations:{user_id}
  4. Background task: update movie's avg_rating in movies table
  ↓
HTTP 201 Created
  ↓
Frontend:
  → Modal closes
  → Movie detail page shows "Your Rating: 8.5/10"
  → Community rating badge updates (optimistic update)
```

---

### Workflow 2.4: Search → Click → Actions

```
User sees search bar in Navbar (always visible)
  ↓
─────────────── AUTOCOMPLETE ───────────────
  ↓
User starts typing: "inc"
  ↓
SearchBar component: debounce 300ms (wait for user to pause)
  ↓
If query length ≥ 2 chars:
  GET /api/v1/search/autocomplete?q=inc
  ↓
Backend:
  1. Check Redis: autocomplete:inc → MISS (first time)
  2. SELECT id, title, release_date, poster_path FROM movies
     WHERE LOWER(title) LIKE 'inc%' LIMIT 8
  3. Cache in Redis: autocomplete:inc (TTL 5min)
  4. Return: [{ id:123, title:"Inception", year:2010, poster_thumbnail:"..." }]
  ↓
Frontend: show dropdown below search bar
  → "Inception (2010)"
  → "In the Mood for Love (2000)"
  → "Incredibles, The (2004)"
  → ...
  ↓
─────────────── AUTOCOMPLETE CLICK ───────────────
  ↓
User clicks "Inception (2010)" in dropdown
  ↓
Navigate directly to /movies/123 (skip search results page)
  ↓
(Movie Detail workflow above takes over)
  ↓
─────────────── FULL SEARCH ───────────────
  ↓
User types "dark knight rises" → presses Enter
  ↓
Navigate to /search?q=dark+knight+rises
  ↓
SearchResults page mounts
  ↓
GET /api/v1/search?q=dark+knight+rises&page=1
  ↓
Backend search_service.full_search():
  1. Check Redis: search:results:{hash("dark knight rises")} → MISS
  2. PostgreSQL full-text query:
     WHERE search_vector @@ to_tsquery('english', 'dark & knight & rises')
     ORDER BY ts_rank(search_vector, query) * 0.5 + popularity * 0.3 + vote_avg * 0.2 DESC
  3. Result count: 4 movies found (> threshold of 5? No)
  4. Augment: GET TMDB /search/movie?query=dark+knight+rises
       → 12 additional results from TMDB
       → Store new ones in DB
       → Merge with local results → deduplicate
  5. Cache merged results (TTL 10min)
  6. Return: 16 ranked movies
  ↓
Frontend:
  → Renders MovieCard grid with 16 results
  → User can filter: Genre, Year Range, Min Rating
  → Each filter change: new GET /api/v1/search?q=...&genre=action
```

---

### Workflow 2.5: Recommendation Flow (End to End)

```
Logged-in user visits Home page
  ↓
GET /api/v1/recommendations
  Headers: Authorization: Bearer {token}
  ↓
FastAPI recommendation_router.get_recommendations():
  1. Auth middleware: validate JWT → user_id = "uuid-abc"
  2. recommendation_service.get_recommendations(user_id)
  ↓
recommendation_service:
  1. Check Redis: user:recommendations:uuid-abc
       → HIT (within 15min): return cached → done (fast path)
       → MISS: compute
  2. Load user behavior:
       watch_genres = GROUP BY genre from user's watch_history (top 3 genres)
       director_affinities = directors of movies user watched 2+ times
       liked_movies = ratings WHERE overall_score >= 6.0 (positive signal)
  3. Rule-based computation:
       genre_picks = movies in top genres, NOT watched, sorted by popularity
       director_picks = other movies by affinity directors, NOT watched
       similar_picks = movies with same genre + similar vote_average as liked movies
       trending_picks = global trending NOT watched
  4. Blend:
       final = deduplicate(
         genre_picks[:8]    (40% of 20)
         + director_picks[:4]  (20% of 20)
         + similar_picks[:4]   (20% of 20)
         + trending_picks[:4]  (20% of 20)
       )
  5. Trim to 20, attach recommendation reason per movie
  6. Cache: Redis SET user:recommendations:uuid-abc (TTL 15min)
  7. Return: 20 movie objects with { movie, reason: "Based on your love of Sci-Fi" }
  ↓
Frontend:
  → "For You" row renders with 20 MovieCards
  → Each card shows recommendation reason as tooltip/badge
  ↓
─────────────── CACHE INVALIDATION ───────────────
  ↓
Same user watches or rates a new movie (later)
  ↓
Background task fires: invalidate Redis key user:recommendations:uuid-abc
  ↓
Next GET /api/v1/recommendations → cache MISS → recompute with updated behavior
  → New movie included in preference signals
  → Recommendations updated automatically
```

---

### Workflow 2.6: Watchlist Management

```
User on Movie Detail page /movies/456
  ↓
GET /api/v1/watch/status/456 fires on page load
  → Returns: { watched: false, watchlisted: false }
  → Buttons show: "Add to Watchlist" (not added yet)
  ↓
User clicks "Add to Watchlist"
  ↓
watchService.addToWatchlist(456) called
  ↓
POST /api/v1/watch/watchlist
  Body: { movie_id: 456 }
  ↓
FastAPI:
  INSERT INTO watchlist (user_id, movie_id, added_at)
  ON CONFLICT (user_id, movie_id) DO NOTHING (idempotent)
  ↓
HTTP 201 Created
  ↓
Frontend:
  → Button changes to "Added to Watchlist ✓"
  ↓
User navigates to /dashboard → Watchlist tab
  ↓
GET /api/v1/watch/watchlist
  → Returns all user's watchlist movies
  → Render MovieCard grid
  ↓
User clicks movie → navigate to MovieDetail
User clicks "Remove from Watchlist"
  ↓
DELETE /api/v1/watch/watchlist/456
  → DELETE FROM watchlist WHERE user_id=? AND movie_id=456
  → Card disappears from list (optimistic UI update)
```

---

### Workflow 2.7: Data Ingestion (Background — No User Interaction)

```
Daily at 3:00 AM (Celery beat cron):
  ↓
Celery Worker: execute daily_movie_sync() task
  ↓
1. TMDB API: GET /movie/now_playing (3 pages = 60 movies)
2. TMDB API: GET /movie/upcoming (3 pages = 60 movies)
3. Deduplicate against movies already in DB
4. For each new movie:
   a. GET /movie/{id} → full details
   b. GET /movie/{id}/credits → director extraction
   c. INSERT movies, genres, movie_genres, directors, movie_directors
   d. Sleep 0.25s (rate limit respect)
5. For top 1000 movies already in DB:
   a. GET /movie/{id} → fetch updated popularity + vote_average
   b. UPDATE movies SET popularity=?, vote_average=? WHERE id=?
6. Invalidate Redis: movie:trending, movie:list:*
7. Log: "Sync complete: 23 new movies added, 847 updated"
  ↓
Separately, every 2 hours (news cron):
  ↓
Celery Worker: execute fetch_news_batch() task
  ↓
1. NewsAPI: GET /everything?q=movies+OR+cinema&pageSize=50
2. Filter: has image, not duplicate (check url_hash), published < 48hrs ago
3. For each valid article:
   a. Compute url_hash = SHA256(url)
   b. INSERT INTO news_articles IF NOT EXISTS (by url_hash)
   c. Try to link to movies mentioned in title (keyword match)
4. Delete articles older than 7 days
5. Invalidate Redis: news:feed:*
```

---

### Workflow 2.8: Token Refresh (Transparent)

```
User browsing normally. 60 minutes since login.
Access token expires silently.
  ↓
User clicks "Rate This Movie"
  ↓
ratingService.submitRating(...) fires
  ↓
POST /api/v1/ratings with expired token
  ↓
FastAPI auth_middleware: decode token → TokenExpiredException
  ↓
HTTP 401 { error: "TOKEN_EXPIRED" }
  ↓
Axios response interceptor (configured in src/utils/api.js):
  1. Detects 401 with error code TOKEN_EXPIRED
  2. Checks: am I already refreshing? (flag to prevent infinite loop)
  3. POST /api/v1/auth/refresh { refresh_token: "..." }
  4. Backend validates refresh token → returns new access_token
  5. localStorage.setItem('access_token', new_token)
  6. Retry original request with new token
  ↓
POST /api/v1/ratings fires again — succeeds
  ↓
User: saw a momentary delay (200ms), never saw an error
```

---

## 3. System Integration Overview

### All Component Connections

```
Frontend (React)
│
│ HTTPS + JWT          HTTPS redirect
├──────────────────► Nginx ──────────────► HTTP to FastAPI
│                      │
│                      └────────────────► Static SPA files

FastAPI Backend
├── Auth Middleware ──────────────────► Redis (blacklist check)
├── Routers → Services → Repositories
│     │             │          └──────► PostgreSQL (reads/writes)
│     │             └─────────────────► Redis (cache get/set)
│     └──────────────────────────────► Celery (background tasks)
└── External calls ────────────────────► TMDB API / NewsAPI

Celery Worker
├── News fetch task ──────────────────► NewsAPI → PostgreSQL
├── Movie sync task ──────────────────► TMDB → PostgreSQL
└── Cache invalidate ─────────────────► Redis (DEL keys)

PostgreSQL
└── Shared by: FastAPI backend + Celery worker + MLflow (Phase 5)

Redis
└── Shared by: FastAPI (cache + blacklist) + Celery (broker)
```

### Request Speed Expectations

| Request Type | Cache State | Expected Latency |
|-------------|-------------|-----------------|
| Movie detail | Redis HIT | < 10ms |
| Movie detail | Redis MISS, DB hit | 50–150ms |
| Movie list (filtered) | Redis HIT | < 10ms |
| Search (local FTS) | Redis MISS | 50–200ms |
| Search (+ TMDB fallback) | Full miss | 300–800ms |
| Recommendations (rule-based) | Redis HIT | < 10ms |
| Recommendations (rule-based) | Redis MISS | 100–300ms |
| Auth login | Always DB | 150–300ms (bcrypt) |
| Autocomplete | Redis HIT | < 5ms |

---

## 4. How Each Backend Layer Works

### Router → Service → Repository Chain

Example: `POST /api/v1/ratings`

```
1. ROUTER (app/routers/ratings.py):
   - Receives HTTP request
   - Validates body shape (Pydantic model)
   - Checks auth (Depends(get_current_user))
   - Calls: await rating_service.create_rating(user_id, rating_data)
   - Returns HTTP response (201 + rating JSON)
   Does NOT: touch DB, apply business rules, call external APIs

2. SERVICE (app/services/rating_service.py):
   - Applies business rules:
       "Is movie_id valid? Does user own this rating? Is score in range?"
   - Calls: await rating_repo.upsert_rating(user_id, movie_id, scores)
   - Calls: await cache_utils.invalidate(f"user:recommendations:{user_id}")
   - Dispatches: celery task to update movie avg_rating
   - Returns: Rating domain object
   Does NOT: know about HTTP, return JSON, touch DB directly

3. REPOSITORY (app/repositories/rating_repo.py):
   - Pure DB access:
       await db.execute(
         INSERT INTO ratings ... ON CONFLICT ... DO UPDATE ...
       )
   - Returns: ORM model or dict
   Does NOT: know about business rules, call cache, call external APIs
```

This strict layering means:
- Change DB → only touch repositories
- Change business rule → only touch service
- Change API shape → only touch router

---

## 5. Error Handling — End to End

```
Any unhandled exception in FastAPI
  ↓
error_handler.py middleware catches it
  ↓
Returns JSON (always):
  { "error": "INTERNAL_ERROR", "message": "Something went wrong", "status_code": 500 }
  ↓
Frontend:
  → Shows toast: "Something went wrong. Please try again."
  → Logs error to console (dev) or error tracking service (prod)

Specific handled errors:
  MovieNotFoundException (404) → "No movie found with id 999"
  InvalidCredentialsException (401) → "Invalid email or password"
  DuplicateEmailException (409) → "Email already registered"
  TokenExpiredException (401) → triggers refresh flow (see Workflow 2.8)
  RateLimitException (429) → "Too many requests. Try again in X minutes."
  ExternalAPIException (503) → "Movie info temporarily unavailable. Try again later."
```

---

## 6. Deployment Architecture

```
Domain: movientum.com → points to server IP (DNS A record)
  ↓
Server: VPS (Ubuntu 22.04, 4 vCPU, 8 GB RAM)
  ↓
Docker containers running on server:
  nginx        → port 80/443 (internet-facing)
  backend      → port 8000 (internal only)
  celery       → no port (task consumer)
  postgres     → port 5432 (internal only)
  redis        → port 6379 (internal only)
  ↓
All containers on Docker network: movientum_network
  → Communicate by container name (nginx → "backend:8000")
  → No container directly accessible from internet except nginx
  ↓
Process restart: restart:always in docker-compose.prod.yml
  → Any container crash → Docker restarts it automatically
  ↓
Health check:
  GET https://movientum.com/api/health → { status:"ok", db:"ok", cache:"ok" }
  UptimeRobot pings this every 5 min → email alert on failure
  ↓
Deployments:
  git push to main → GitHub Actions:
    1. Run tests
    2. Build new Docker images
    3. Push to registry
    4. SSH to server → docker compose pull + rolling restart
    5. Verify /api/health returns 200
    6. Rollback if health check fails
```

---

## 7. What a New Developer Needs to Know

**Codebase entry points:**
- `app/main.py` → start here to understand middleware + router registration
- `app/routers/` → where endpoints live (HTTP layer)
- `app/services/` → where business logic lives
- `app/db/orm_models.py` → DB table definitions
- `app/tasks/` → background jobs

**To add a new feature:**
1. Add table → `orm_models.py` + Alembic migration
2. Add repository function → `repositories/`
3. Add service function → `services/`
4. Add router endpoint → `routers/`
5. Add frontend service call → `src/services/`
6. Add React component/page → `src/pages/` or `src/components/`
7. Write tests → `tests/` (backend), `src/__tests__/` (frontend)

**Environment variables required:**
```
DATABASE_URL          PostgreSQL connection string
REDIS_URL             Redis connection string
JWT_SECRET_KEY        Secret for signing JWT tokens
JWT_ALGORITHM         HS256
TMDB_API_KEY          TMDB developer key
NEWS_API_KEY          NewsAPI key
ENVIRONMENT           development / production
REACT_APP_API_URL     Backend URL (frontend needs this)
```

**Dev setup:**
```
docker compose up -d postgres redis
cd backend && uvicorn app.main:app --reload
cd frontend && npm start
```

**Everything is in `/plans` folder:**
```
frontend_system.md         → React architecture deep dive
backend_system.md          → FastAPI structure + request lifecycle
database_system.md         → All tables, relationships, indexes
data_fetch.md              → TMDB ingestion pipeline
search_system.md           → Search + autocomplete logic
auth_system.md             → JWT, bcrypt, security
recommendation_system.md   → Rule-based → ML evolution
fedpcl_system_implemented.md → FedPCL deep technical design
mlops.md                   → ML lifecycle, MLflow, CI/CD for ML
docker.md                  → Container designs, Compose configs
api_gateway.md             → Nginx → Kong gateway design
system_integration.md      → How every component connects
storage_estimation.md      → DB size estimates, storage strategy
scalability_and_future.md  → Scaling path, future roadmap
config_design.md           → params.yaml + definitions.yaml design
code_implementation.md     → THIS build roadmap (phases 1-5)
workflows.md               → User flows (simpler version)
system_architecture.md     → Architecture diagrams
```
