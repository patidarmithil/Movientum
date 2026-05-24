# Code Implementation Plan — Movientum

Developer execution roadmap. Phase by phase. Build in order. Each phase produces deployable/testable output.

---

## Phase 1: Data Fetch Setup

**Goal:** Populate DB with movie data from TMDB. Without this, frontend has nothing to show.

### Step 1: TMDB API Setup

- Register at [themoviedb.org](https://www.themoviedb.org/), get API key
- Store in `.env`: `TMDB_API_KEY=your_key`
- Verify: hit `GET https://api.themoviedb.org/3/movie/popular?api_key=KEY` manually — confirm JSON returns

### Step 2: PostgreSQL Schema — Create Tables

Run Alembic migration to create these tables (see `database_system.md` for full schema):

```
movies          → id, title, overview, release_date, runtime, poster_path,
                  backdrop_path, popularity, vote_average, vote_count,
                  original_language, imdb_id, metadata, fetched_at

genres          → id, name
movie_genres    → movie_id, genre_id
directors       → id, name, biography, profile_path
movie_directors → movie_id, director_id
```

Execution:
```
alembic revision --autogenerate -m "create_movie_tables"
alembic upgrade head
```

Verify: connect to DB, confirm tables exist with correct columns.

### Step 3: TMDB Data Ingestion Service

Build `app/services/tmdb_service.py`:

Functions to implement:
- `fetch_popular_movies(page)` → calls `/movie/popular?page=N`, returns list
- `fetch_movie_detail(movie_id)` → calls `/movie/{id}`, returns full object
- `fetch_movie_credits(movie_id)` → calls `/movie/{id}/credits`, extracts directors
- `fetch_configuration()` → gets image base URL, cache 24hrs

Rate limiting: add 0.25s sleep between requests (stays within 40 req/10s limit).
Timeout: 10s per request. Retry on 429: backoff 2s → 4s → 8s.

### Step 4: One-Time Seed Script

Build `scripts/seed_movies.py`:

```
Execution flow:
  1. Fetch 25 pages of /movie/popular     → 500 movie IDs
  2. Fetch 25 pages of /movie/top_rated   → 500 more IDs (deduplicate)
  3. For each unique ID:
       a. GET /movie/{id}          → full movie details
       b. GET /movie/{id}/credits  → director names
       c. INSERT into movies, genres, movie_genres, directors, movie_directors
       d. Sleep 0.25s between requests
  4. Log progress every 100 movies
  5. On completion: print total inserted, skipped, failed
```

Run once:
```
python scripts/seed_movies.py
```

Expected time: ~30–60 min (rate limit sleep + network).
Expected result: ~800–1000 unique movies in DB (many overlap between popular + top_rated).

### Step 5: Caching Setup (Redis)

Connect Redis in `app/db/cache.py`:
- `get_cached(key)` → Redis GET, returns None if miss
- `set_cached(key, value, ttl)` → Redis SETEX
- `invalidate(key)` → Redis DEL

TTLs per data type (from `params.yaml`):
```
movie_detail:     3600s  (1hr)
trending_list:    1800s  (30min)
genre_list:       86400s (24hr)
search_results:   600s   (10min)
```

Wrap every repo function with cache check:
```
async def get_movie_by_id(id):
    key = f"movie:detail:{id}"
    cached = await redis.get(key)
    if cached: return json.loads(cached)
    movie = await db.execute(SELECT...)
    await redis.setex(key, 3600, json.dumps(movie))
    return movie
```

### Step 6: Cron Sync (Daily Refresh)

Build `app/tasks/sync_movies.py` as Celery task:

```
@celery.task
def daily_movie_sync():
    1. Fetch /movie/now_playing (3 pages)
    2. Fetch /movie/upcoming (3 pages)
    3. For each movie_id NOT in DB → fetch detail + credits → insert
    4. For top 1000 movies already in DB → update popularity + vote_average only
    5. Log results
```

Register cron in Celery beat schedule:
```
"daily-sync": {
    "task": "tasks.sync_movies.daily_movie_sync",
    "schedule": crontab(hour=3, minute=0)   ← 3 AM daily
}
```

### Phase 1 Deliverable Checklist
- [ ] `movies` table populated with 800+ movies
- [ ] `genres`, `directors` tables populated
- [ ] Redis cache working (verify cache HIT on second request)
- [ ] `GET /api/v1/movies` returns paginated list
- [ ] `GET /api/v1/movies/{id}` returns movie detail
- [ ] Celery cron registered (verify with `celery inspect scheduled`)

---

## Phase 2: Frontend System

**Goal:** Deployable React UI that shows movies, allows search, handles auth, and shows placeholder recommendations. Advanced ML integrated later.

### Step 1: Project Setup

```
npx create-react-app movientum-frontend --template cra-template
cd movientum-frontend
npm install react-router-dom axios
```

File structure:
```
/src
  /pages        → Home, Login, Register, MovieList, MovieDetail, Dashboard, Search
  /components   → Navbar, MovieCard, SearchBar, RatingModal, GenreTag, Spinner
  /services     → authService, movieService, ratingService, watchService, recommendService
  /context      → AuthContext, MovieContext
  /hooks        → useAuth, useMovies
  /utils        → api.js (axios instance with interceptors)
```

### Step 2: Axios Instance with JWT Interceptor

Build `src/utils/api.js`:
- Base URL: `process.env.REACT_APP_API_URL`
- Request interceptor: attach `Authorization: Bearer {token}` from localStorage
- Response interceptor: on 401 → attempt token refresh → retry → on second 401 → logout

All service files import from this instance. Never use raw `fetch` in components.

### Step 3: Auth Context

Build `src/context/AuthContext.js`:

State: `{ user, token, isLoggedIn, isLoading }`

Methods:
- `login(email, password)` → calls authService.login → stores token → sets state
- `register(name, email, password)` → calls authService.register → stores token → sets state
- `logout()` → clears localStorage → resets state → redirect to /login
- `refreshToken()` → calls authService.refresh → updates token in storage + state

Wrap entire app in `<AuthProvider>`. On mount: check localStorage for token, validate, restore session.

### Step 4: Routing Setup

`src/App.js` routes:
```
/                    → Home (public)
/login               → Login (redirect to / if logged in)
/register            → Register (redirect to / if logged in)
/movies              → MovieList (public)
/movies/:id          → MovieDetail (public)
/search              → SearchResults (public)
/dashboard           → Dashboard (protected)
/dashboard/history   → WatchHistory tab
/dashboard/watchlist → Watchlist tab
/dashboard/ratings   → MyRatings tab
```

Protected route wrapper: checks `isLoggedIn` → if false → `<Navigate to="/login?redirect={currentPath}" />`

### Step 5: Pages — Build Order

**Build in this order** (each independently testable):

**A. MovieList Page** (`/movies`)
- Fetch `GET /api/v1/movies?page=1&genre=&sort=popularity`
- Render grid of `<MovieCard>` components
- Filter sidebar: genre multi-select, year range, sort dropdown
- Filter change → new API call with updated params
- Pagination: "Load More" button or page numbers

**B. MovieDetail Page** (`/movies/:id`)
- Fetch `GET /api/v1/movies/{id}` on mount
- Display: poster, title, year, genres, runtime, overview, director, vote_average
- Buttons (show only if logged in): "Mark Watched", "Add to Watchlist", "Rate"
- Rating modal: sliders for Story / Acting / Direction / Visuals / Overall
- "Movies You Might Like" row: fetch `GET /api/v1/recommendations/similar/{id}`

**C. Search Page** (`/search?q=`)
- On mount: read `q` from URL params → fetch `GET /api/v1/search?q=...`
- Display results as MovieCard grid
- Empty state: "No results found. Try a different search."

**D. Home Page** (`/`)
- Hero section: first trending movie
- Trending row: `GET /api/v1/movies/trending`
- Genre rows: `GET /api/v1/movies?genre=action&sort=popularity`
- "For You" row (logged in only):

  > ⚠️ **Developer Note:** The "For You" recommendations section currently uses **placeholder / rule-based recommendations** for deployment. This calls `GET /api/v1/recommendations` which returns genre-affinity-based picks. **Advanced ML recommendations (collaborative filtering → FedPCL) will be integrated in Phase 5 and will use the same API endpoint — no frontend changes needed.**

  Show 10 movie cards from rule-based rec API. Same `<MovieCard>` component.

- "Continue Watching" row (logged in, has history): `GET /api/v1/watch/watchlist`

**E. Login / Register Pages**
- Simple forms with inline validation
- On success: redirect to home or `?redirect=` param
- Error display: show backend message under form

**F. User Dashboard** (`/dashboard`)
- Tabs component (Watch History / Watchlist / My Ratings)
- Each tab: fetch respective API, render MovieCard grids
- Empty states per tab

### Step 6: Key Shared Components

**`<MovieCard>`** props: `{ movie: {id, title, poster_path, year, vote_average} }`
- Show poster (TMDB image URL: `https://image.tmdb.org/t/p/w342{poster_path}`)
- Show title, year, rating badge
- Click → navigate to `/movies/{id}`
- Fallback: if no poster_path → show gradient placeholder with title text
- Used in: Home rows, MovieList grid, Search results, Dashboard

**`<Navbar>`**
- Logo left
- `<SearchBar>` center (autocomplete, debounced 300ms)
- Right: Login button (guest) OR Avatar + dropdown (logged in)
- Dropdown: Dashboard, Logout

**`<SearchBar>`**
- Input with 300ms debounce
- On keystroke (≥2 chars): `GET /api/v1/search/autocomplete?q=...`
- Show dropdown with up to 8 results (title + year + thumbnail)
- Click result → navigate to `/movies/{id}` directly
- Press Enter → navigate to `/search?q=...`

### Step 7: Recommendation Display (Frontend Approach)

> ⚠️ **Throughout the frontend, all recommendation UI components use the same `GET /api/v1/recommendations` and `GET /api/v1/recommendations/similar/{id}` endpoints. These currently return rule-based picks. When the ML system (Phase 5) is integrated, the backend endpoint logic changes but the API contract stays identical — zero frontend changes required for ML upgrade.**

Place a small info badge on the "For You" section:
`"Personalized by Movientum · AI-powered recommendations coming soon"`

This manages user expectations while deploying early.

### Step 8: Error Handling & Loading States

- All API calls: show skeleton screen while loading (not spinner — better UX)
- 401 responses: interceptor handles refresh / logout
- 404: show "Not Found" component
- 500: show "Something went wrong" + "Try again" button
- Network offline: show toast "Check your internet connection"
- Toast notifications: top-right, auto-dismiss after 4 seconds

### Phase 2 Deliverable Checklist
- [ ] All 6 pages render with real data from backend
- [ ] Auth flow works: register → login → protected routes accessible
- [ ] MovieCard used consistently across all pages
- [ ] Search autocomplete working
- [ ] Rating modal submits successfully
- [ ] "Mark Watched" + "Add to Watchlist" buttons work
- [ ] Home page "For You" row shows rule-based recs (clearly marked as placeholder in code comments)
- [ ] Responsive on mobile (basic breakpoints)
- [ ] Build passes: `npm run build` produces production bundle

---

## Phase 3: Backend System

**Goal:** Full FastAPI backend with all endpoints, JWT auth, Redis cache, and clean modular structure.

### Step 1: Project Structure

```
/app
  main.py              → FastAPI app init, middleware, router mounting
  config.py            → Settings (pydantic BaseSettings reads from .env)
  
  /routers             → HTTP layer (thin)
    auth.py
    movies.py
    search.py
    ratings.py
    watch.py
    recommendations.py
    news.py
    admin.py
    fedpcl.py          → stubbed for Phase 5
  
  /services            → Business logic (thick)
    auth_service.py
    movie_service.py
    search_service.py
    rating_service.py
    watch_service.py
    recommendation_service.py
    news_service.py
  
  /repositories        → DB queries only
    user_repo.py
    movie_repo.py
    rating_repo.py
    watch_repo.py
  
  /models              → Pydantic schemas (request + response shapes)
    user_models.py
    movie_models.py
    rating_models.py
  
  /db
    database.py        → SQLAlchemy async engine + session factory
    orm_models.py      → SQLAlchemy ORM table classes
  
  /middleware
    auth_middleware.py
    error_handler.py
    logging_middleware.py
  
  /utils
    jwt_utils.py
    password_utils.py
    cache_utils.py
  
  /tasks               → Celery tasks
    sync_movies.py
    fetch_news.py
    invalidate_cache.py
```

### Step 2: Database Connection

`app/db/database.py`:
- Async SQLAlchemy engine: `create_async_engine(DATABASE_URL, pool_size=10)`
- Session factory: `async_sessionmaker(engine, expire_on_commit=False)`
- Dependency: `async def get_db() → AsyncSession` (used in router params)

### Step 3: Auth System (Implement First — Everything Depends On It)

**User Registration:**
```
POST /api/v1/auth/register
  Body: { name, email, password }
  Flow:
    1. Validate email format, password strength
    2. Check email not in users table → 409 if exists
    3. bcrypt.hash(password, rounds=12)
    4. INSERT user (UUID, email, username, password_hash)
    5. Generate JWT access + refresh tokens
    6. Return 201: { token, refresh_token, user }
```

**Login:**
```
POST /api/v1/auth/login
  Body: { email, password }
  Flow:
    1. SELECT user WHERE email = ?
    2. bcrypt.verify(submitted, stored_hash)
    3. Return 401 "Invalid credentials" for BOTH wrong email + wrong password
    4. Generate tokens
    5. Return 200: { token, refresh_token, user }
```

**JWT Utils** (`app/utils/jwt_utils.py`):
- `create_access_token(user_id, email, role)` → signed JWT, 60min expiry
- `create_refresh_token(user_id)` → signed JWT, 30 days expiry
- `decode_token(token)` → returns payload or raises HTTPException

**Auth Middleware** (`app/middleware/auth_middleware.py`):
- Extracts Bearer token from Authorization header
- Calls `decode_token()`
- Checks Redis blacklist for `jti` (token ID) — for logout invalidation
- Attaches `request.state.user` = `{id, email, role}`
- Skips validation for public routes (GET /movies, GET /search, etc.)

**Protected route dependency:**
```python
async def get_current_user(request: Request) → UserPayload:
    if not request.state.user:
        raise HTTPException(401)
    return request.state.user
```
Use as: `user = Depends(get_current_user)` in protected router functions.

### Step 4: Movie Endpoints

```
GET /api/v1/movies
  Params: page, genre, sort, year_from, year_to, min_rating, language
  Service: movie_service.get_movie_list(filters, page)
  Cache key: movie:list:{hash(params)}   TTL 30min

GET /api/v1/movies/{id}
  Service: movie_service.get_movie_by_id(id)
  Cache key: movie:detail:{id}           TTL 1hr

GET /api/v1/movies/trending
  Service: movie_service.get_trending()
  Cache key: movie:trending              TTL 30min
```

### Step 5: Search Endpoints

```
GET /api/v1/search?q={query}
  Service: search_service.full_search(query, filters)
  Flow:
    1. Check Redis cache
    2. PostgreSQL full-text: WHERE search_vector @@ to_tsquery(query)
    3. Rank by ts_rank + popularity + rating blend
    4. If results < 5: augment with TMDB search API
    5. Cache results 10min
    6. Return ranked list

GET /api/v1/search/autocomplete?q={prefix}
  Service: search_service.autocomplete(prefix)
  Flow:
    1. Check Redis: autocomplete:{prefix}
    2. SELECT id, title, release_date, poster_path
       FROM movies WHERE LOWER(title) LIKE '{prefix}%'
       LIMIT 8
    3. Cache 5min
    4. Return list
```

**PostgreSQL full-text setup** (one-time migration):
```sql
ALTER TABLE movies ADD COLUMN search_vector tsvector;
UPDATE movies SET search_vector = to_tsvector('english', title || ' ' || COALESCE(overview, ''));
CREATE INDEX movies_fts_idx ON movies USING GIN(search_vector);
CREATE TRIGGER movies_fts_trigger BEFORE INSERT OR UPDATE ON movies
  FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger(search_vector, 'pg_catalog.english', title, overview);
```

### Step 6: Ratings Endpoints

```
POST /api/v1/ratings          → [AUTH] create rating
  Body: { movie_id, story_score, acting_score, direction_score, visuals_score, overall_score, review_text }
  Validate: 0 ≤ all scores ≤ 10, overall required
  DB: INSERT with ON CONFLICT(user_id, movie_id) DO UPDATE (upsert)
  After: background task → invalidate user:recommendations:{user_id}

GET  /api/v1/ratings/me       → [AUTH] my ratings, paginated
GET  /api/v1/ratings/movie/{id} → avg scores for movie
PUT  /api/v1/ratings/{id}     → [AUTH] update own rating
DELETE /api/v1/ratings/{id}   → [AUTH] delete own rating
```

### Step 7: Watch History Endpoints

```
POST /api/v1/watch                 → [AUTH] mark movie watched
  DB: INSERT/UPDATE watch_history
  After: background → invalidate rec cache

GET  /api/v1/watch/history         → [AUTH] user's watch history, paginated
POST /api/v1/watch/watchlist       → [AUTH] add to watchlist
DELETE /api/v1/watch/watchlist/{id}→ [AUTH] remove from watchlist
GET  /api/v1/watch/watchlist       → [AUTH] user's watchlist
GET  /api/v1/watch/status/{movie_id} → [AUTH] have I watched/listed this?
```

### Step 8: Recommendation Endpoint (Rule-Based — Phase 3 Implementation)

> ⚠️ **Developer Note:** `GET /api/v1/recommendations` currently implements **rule-based recommendations only**. This is intentional for Phase 3 deployment. The endpoint contract is fixed — the backend logic will be upgraded in Phase 5 (ML integration) without any API change.

```
GET /api/v1/recommendations         → [AUTH] personalized picks
  Service: recommendation_service.get_rule_based(user_id)
  
  Rule-based logic:
    1. Load user's top genres (from watch_history JOIN movie_genres)
    2. Find movies in top genres NOT yet watched, sort by popularity
    3. Find directors user watched 2+ times → their other movies
    4. Blend: 40% genre picks + 20% director picks + 20% similar-rated + 20% trending
    5. Deduplicate, filter watched, return top 20
    6. Cache: user:recommendations:{user_id}  TTL 15min

GET /api/v1/recommendations/similar/{movie_id}  → public
  Service: Find movies with same genres, similar vote_average
  Cache: movie:similar:{movie_id}  TTL 1hr
```

### Step 9: Error Handling & Middleware

`app/middleware/error_handler.py`:
- Catch all unhandled exceptions → log traceback → return 500 JSON
- Catch Pydantic validation errors → return 422 with field-level messages
- Catch custom exceptions (MovieNotFoundException, etc.) → map to HTTP codes

All errors return consistent shape:
```json
{ "error": "ERROR_CODE", "message": "Human message", "status_code": 404 }
```

### Step 10: Celery Background Tasks

Tasks that run async (don't block HTTP response):
```
invalidate_rec_cache(user_id)     → Redis DEL user:recommendations:{user_id}
fetch_news_batch()                → NewsAPI fetch, cron 2hr
daily_movie_sync()                → TMDB sync, cron 3AM
```

### Phase 3 Deliverable Checklist
- [ ] All endpoints respond correctly (test with Swagger at `/docs`)
- [ ] Auth: register → login → protected endpoint → refresh → logout
- [ ] Movies: list (filtered/sorted), detail, trending return correct data
- [ ] Search: full search + autocomplete working with FTS index
- [ ] Ratings: create, read, update, delete working
- [ ] Watch history: mark watched, add/remove watchlist working
- [ ] Recommendations: rule-based endpoint returns 20 movies for logged-in user
- [ ] Redis cache: verify HIT on repeated requests (log "CACHE HIT" in dev)
- [ ] Celery: run worker + beat, verify cron tasks execute
- [ ] Error responses: correct codes and JSON shape on all error cases

---

## Phase 4: Deployment Setup

**Goal:** Platform running on a server, accessible via domain, with HTTPS.

### Step 1: Dockerize All Services

**Directory structure:**
```
/movientum
  /frontend     → React app
  /backend      → FastAPI app
  docker-compose.yml
  docker-compose.prod.yml
  .env
  .env.example  → commit this (no secrets)
  nginx.conf
```

**Containers to build:**
1. `frontend` — multi-stage (Node build → Nginx serve)
2. `backend` — `python:3.11-slim`, uvicorn 4 workers
3. `celery_worker` — same backend image, celery entrypoint
4. `postgres` — `postgres:15-alpine`, named volume
5. `redis` — `redis:7-alpine`, named volume
6. `nginx` — `nginx:alpine`, custom config

See `docker.md` for full Dockerfile designs per container.

### Step 2: Nginx Configuration

`nginx.conf`:
```
server {
  listen 80;
  server_name movientum.com www.movientum.com;
  return 301 https://$host$request_uri;    # Force HTTPS
}

server {
  listen 443 ssl;
  server_name movientum.com;

  ssl_certificate /etc/letsencrypt/live/movientum.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/movientum.com/privkey.pem;

  # Frontend SPA
  location / {
    root /usr/share/nginx/html;
    try_files $uri $uri/ /index.html;
  }

  # Backend API
  location /api/ {
    proxy_pass http://backend:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Authorization $http_authorization;
  }

  # Rate limits
  limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
  location /api/v1/auth/login {
    limit_req zone=login burst=5;
    proxy_pass http://backend:8000;
  }
}
```

### Step 3: Server Setup

On fresh VPS (Ubuntu 22.04 recommended):

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Install Docker Compose
apt install docker-compose-plugin

# Clone repo
git clone https://github.com/yourteam/movientum.git
cd movientum

# Copy and fill env
cp .env.example .env
nano .env    # fill: DB creds, JWT secret, TMDB key, etc.

# SSL certificate (Let's Encrypt)
apt install certbot
certbot certonly --standalone -d movientum.com

# Run all containers
docker compose -f docker-compose.prod.yml up -d

# Verify all running
docker compose ps

# Run DB migrations
docker compose exec backend alembic upgrade head

# Seed movies (first time only)
docker compose exec backend python scripts/seed_movies.py
```

### Step 4: CI/CD Pipeline (GitHub Actions)

`.github/workflows/deploy.yml`:

```yaml
Triggers: push to main branch

Jobs:
  test:
    - Run: pytest (backend tests)
    - Run: npm test (frontend tests)
  
  build_and_push:
    - docker build backend → push to registry
    - docker build frontend → push to registry
    - Tag with git SHA
  
  deploy:
    - SSH to production server
    - docker compose pull (get new images)
    - docker compose up -d --no-deps backend frontend celery_worker
    - docker compose exec backend alembic upgrade head
    - curl https://movientum.com/api/health → verify 200
    - On failure: docker compose rollback (re-deploy previous images)
```

Secrets stored in GitHub Actions Secrets:
- `SSH_PRIVATE_KEY`, `SERVER_IP`, `DOCKER_USERNAME`, `DOCKER_PASSWORD`

### Step 5: Health Checks and Monitoring

Backend health endpoint: `GET /api/health` → `{ status: "ok", version: "1.0", db: "ok", cache: "ok" }`
- Checks DB connection
- Checks Redis connection
- Returns 503 if either fails

Basic uptime monitoring:
- UptimeRobot (free): ping `/api/health` every 5 min → email alert on downtime

Log access:
```
docker compose logs -f backend     → backend logs
docker compose logs -f nginx       → access logs
docker compose logs -f celery_worker → background task logs
```

### Phase 4 Deliverable Checklist
- [ ] All containers start with `docker compose up -d`
- [ ] `https://movientum.com` loads React app in browser
- [ ] `https://movientum.com/api/health` returns 200
- [ ] HTTPS works, HTTP redirects to HTTPS
- [ ] GitHub Actions: push to main → auto-deploy works end-to-end
- [ ] Celery cron tasks running (news fetch, movie sync)
- [ ] DB migrations run on deploy
- [ ] UptimeRobot monitoring configured
- [ ] Rollback tested: bad deploy → auto-rollback restores previous version

---

## Phase 5: Future ML & MLOps Integration

> ⚠️ **DO NOT IMPLEMENT NOW. This is Phase 5 — future work. The system architecture is already designed to support this. No Phase 1–4 code needs to change.**

### What This Phase Covers (Overview Only)

**Recommendation Evolution:**

```
Current (Phase 3):   Rule-based recommendations
                     GET /api/v1/recommendations → genre affinity logic
                     ↓ (same API endpoint, backend logic upgrades)
Phase 5a:            Collaborative Filtering (Matrix Factorization)
                     → train offline on all user-movie interactions
                     → serve top-N via pre-computed model in memory
                     ↓ (same API endpoint, no frontend change)
Phase 5b:            FedPCL (Federated Prototypical Contrastive Learning)
                     → privacy-preserving, distributed training
                     → GNN-based user-item graph modeling
                     → cluster-based personalization
                     → see fedpcl_system_implemented.md for full design
```

**Why no frontend changes needed:** Phase 3 already wires frontend to `GET /api/v1/recommendations`. Backend upgrades logic behind same endpoint.

**ML Pipelines to build:**
- ETL pipeline: extract watch_history + ratings → clean → format as training data
- Offline training: matrix factorization on full dataset
- FedPCL training: federated rounds (see fedpcl_system_implemented.md)
- Evaluation: HR@10, NDCG@10 per training run

**MLflow Tracking (future):**
- Log all training runs (params, metrics, artifacts)
- Model registry with staging → production promotion
- Track HR@10 over rounds, compare model versions
- See `mlops.md` for full setup

**CI/CD for ML (future):**
- Automated retraining pipeline (bi-weekly or drift-triggered)
- Model validation gate (HR@10 ≥ 0.60) before deployment
- Shadow testing: serve new model to 10% traffic before full promotion
- Auto-rollback if engagement drops > 10%
- See `mlops.md` for full pipeline

**FedPCL client integration (future):**
- `GET /api/v1/fedpcl/round/status` — check if round active
- `GET /api/v1/fedpcl/model/latest` — download personalized embedding table
- `POST /api/v1/fedpcl/update` — submit LDP-noised gradient update
- Client-side: TensorFlow.js or WebAssembly for local training in browser
- See `fedpcl_system_implemented.md` for full design

**Key design decision already made:** `app/routers/fedpcl.py` and `app/services/recommendation_service.py` are already structured to accept ML model injection. Phase 5 fills in the implementation without restructuring Phase 3 code.

### Phase 5 Prerequisites (Ready After Phase 4)
- ✅ User interaction data accumulating (watch history, ratings)
- ✅ DB schema supports all ML input tables
- ✅ API endpoints stubbed (fedpcl router exists, returns 501 until Phase 5)
- ✅ MLflow can be added as new Docker service to existing Compose file
- ✅ `params.yaml` + `definitions.yaml` already define all FedPCL hyperparameters
