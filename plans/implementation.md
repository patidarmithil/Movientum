# Movientum — Phase 1 Implementation Guide

Developer execution guide. What gets built, what files get created, how each piece works, in what order.

---

## Credentials Locked In

| Key | Location |
|-----|----------|
| TMDB API Key | `backend/.env` → `TMDB_API_KEY` |
| TMDB Read Token | `backend/.env` → `TMDB_READ_ACCESS_TOKEN` |
| Supabase DB (migrations) | `backend/.env` → `DATABASE_URL` (port 6543, transaction pooler) |
| Supabase DB (runtime) | `backend/.env` → `ASYNC_DATABASE_URL` (port 5432, session pooler, asyncpg) |
| Redis (Upstash) | `backend/.env` → `REDIS_URL` |
| JWT Secret | `backend/.env` → `JWT_SECRET_KEY` |

---

## Backend Folder Structure (Phase 1 creates this)

```
backend/
├── .env                          ← DONE (already created)
├── .env.example                  ← DONE (safe to commit)
├── requirements.txt              ← CREATE (all Python deps)
├── alembic.ini                   ← CREATE (Alembic config)
│
├── app/
│   ├── __init__.py
│   ├── main.py                   ← FastAPI app entry point
│   ├── config.py                 ← Pydantic BaseSettings reads .env
│   │
│   ├── db/
│   │   ├── __init__.py
│   │   ├── database.py           ← Async SQLAlchemy engine + session
│   │   └── orm_models.py         ← All ORM table definitions
│   │
│   └── services/
│       ├── __init__.py
│       └── tmdb_service.py       ← TMDB API fetch functions
│
├── alembic/
│   ├── env.py                    ← Alembic env (points to ORM models)
│   ├── script.py.mako
│   └── versions/
│       └── 001_create_movie_tables.py   ← First migration
│
└── scripts/
    └── seed_movies.py            ← One-time TMDB data ingestion script
```

> Phase 2 (backend full) adds: `/routers`, `/services` (all), `/repositories`, `/models`, `/middleware`, `/utils`, `/tasks`

---

## Step 1 — Install Dependencies

**File: `backend/requirements.txt`**

```
# Web framework
fastapi==0.111.0
uvicorn[standard]==0.29.0

# Database
sqlalchemy[asyncio]==2.0.30
asyncpg==0.29.0           # async PostgreSQL driver
alembic==1.13.1           # migrations
psycopg2-binary==2.9.9    # sync driver for Alembic

# Cache
redis==5.0.4
hiredis==2.3.2

# Auth
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4

# Config
python-dotenv==1.0.1
pydantic-settings==2.2.1

# HTTP client (TMDB fetch)
httpx==0.27.0

# Celery (background tasks + cron)
celery==5.3.6
celery[redis]==5.3.6

# Utilities
python-multipart==0.0.9
```

**Install command:**
```bash
cd backend
pip install -r requirements.txt
```

---

## Step 2 — Config System

**File: `app/config.py`**

How it works:
- `pydantic-settings` `BaseSettings` class reads all vars from `.env` automatically
- Single `Settings` object imported everywhere — no raw `os.getenv()` calls scattered
- Type-safe: wrong type in `.env` = error at startup, not runtime

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # TMDB
    tmdb_api_key: str
    tmdb_read_access_token: str
    tmdb_base_url: str = "https://api.themoviedb.org/3"
    tmdb_image_base_url: str = "https://image.tmdb.org/t/p"

    # Database
    async_database_url: str
    database_url: str          # sync — for Alembic

    # Redis
    redis_url: str

    # JWT
    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # App
    app_env: str = "development"
    debug: bool = False
    allowed_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"

settings = Settings()
```

---

## Step 3 — Database Connection (Async SQLAlchemy → Supabase)

**File: `app/db/database.py`**

How it works:
- SQLAlchemy `create_async_engine` connects to Supabase via `asyncpg` driver
- `async_sessionmaker` creates DB sessions on-demand per HTTP request
- `get_db()` is FastAPI dependency injected into route handlers — yields session, closes after response
- `pool_size=10` → max 10 open connections (Supabase free tier allows ~15, stay under)
- `pool_pre_ping=True` → tests connection before use, handles Supabase idle disconnects

```python
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.config import settings

engine = create_async_engine(
    settings.async_database_url,
    pool_size=10,
    max_overflow=5,
    pool_pre_ping=True,
    echo=settings.debug,        # log SQL in dev
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    expire_on_commit=False,
)

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
```

> **Supabase note:** Supabase uses PgBouncer connection pooler. Session pooler (port 5432) is used for persistent async connections (FastAPI). Transaction pooler (port 6543) is used for Alembic migrations (sync, short-lived).

---

## Step 4 — ORM Models (SQLAlchemy table definitions)

**File: `app/db/orm_models.py`**

How it works:
- Python classes map 1:1 to DB tables
- SQLAlchemy reads these to auto-generate migration SQL
- Alembic diffs current DB state vs these models → generates `ALTER TABLE` / `CREATE TABLE` SQL

Tables defined (from `database_system.md`):

| ORM Class | DB Table | Purpose |
|-----------|----------|---------|
| `Movie` | `movies` | TMDB movie data |
| `Genre` | `genres` | Genre lookup |
| `MovieGenre` | `movie_genres` | Movie↔Genre junction |
| `Director` | `directors` | Director profiles |
| `MovieDirector` | `movie_directors` | Movie↔Director junction |
| `User` | `users` | Auth accounts |
| `Rating` | `ratings` | User ratings (4-category) |
| `WatchHistory` | `watch_history` | Watched records |
| `Watchlist` | `watchlist` | To-watch list |
| `UserGenrePreference` | `user_genre_preferences` | Explicit genre prefs |

All Phase 1 tables: `movies`, `genres`, `movie_genres`, `directors`, `movie_directors`
Remaining tables added in Phase 3 (auth system build).

---

## Step 5 — Alembic Setup (Schema Migrations)

**File: `alembic.ini`**

Points to sync `DATABASE_URL` (port 6543, transaction pooler) — Alembic uses sync psycopg2, not asyncpg.

**File: `alembic/env.py`**

How it works:
- Imports `Base.metadata` from `orm_models.py`
- `target_metadata = Base.metadata` tells Alembic to compare DB vs ORM models
- `--autogenerate` flag diffs them → produces migration file with exact SQL needed

**Migration run sequence:**
```bash
# From backend/ folder:

# 1. Init Alembic (one-time)
alembic init alembic

# 2. Generate first migration (auto-detects ORM vs empty DB)
alembic revision --autogenerate -m "create_movie_tables"

# 3. Apply to Supabase
alembic upgrade head

# 4. Verify in Supabase dashboard → Table Editor → tables should appear
```

> **What this does to Supabase:** Creates all tables in the `postgres` schema. Tables visible in Supabase Table Editor and SQL Editor. Row Level Security (RLS) is OFF by default — backend handles all auth, don't need RLS.

---

## Step 6 — TMDB Service

**File: `app/services/tmdb_service.py`**

How it works:
- Uses `httpx.AsyncClient` for async HTTP (non-blocking, fast)
- All requests use `TMDB_READ_ACCESS_TOKEN` in Bearer header (more reliable than API key param)
- Rate limiting: 0.25s sleep between requests → stays within TMDB's 40 req/10s limit
- Retry logic: on HTTP 429 → exponential backoff (2s → 4s → 8s)
- `fetch_configuration()` cached in Redis for 24hrs (image base URL doesn't change)

Functions:
```
fetch_configuration()           → GET /configuration, get image base URL
fetch_popular_movies(page)      → GET /movie/popular?page=N
fetch_top_rated_movies(page)    → GET /movie/top_rated?page=N
fetch_movie_detail(movie_id)    → GET /movie/{id}
fetch_movie_credits(movie_id)   → GET /movie/{id}/credits → extract directors only
```

All return typed Python dicts. All errors logged, `None` returned on failure (seed script skips failed movies).

---

## Step 7 — Seed Script

**File: `scripts/seed_movies.py`**

How it works — execution flow:

```
1. Load .env, connect to DB (sync psycopg2 for script simplicity)
2. Fetch pages 1–25 of /movie/popular   → collect movie IDs (up to 500)
3. Fetch pages 1–25 of /movie/top_rated → collect more IDs
4. Deduplicate IDs (popular + top_rated overlap heavily)
5. For each unique movie_id:
     a. GET /movie/{id}         → full detail
     b. GET /movie/{id}/credits → directors
     c. Upsert genres into genres table (ON CONFLICT DO NOTHING)
     d. Insert movie into movies table (ON CONFLICT UPDATE fetched_at)
     e. Insert movie_genres entries
     f. Upsert directors into directors table
     g. Insert movie_directors entries
     h. Sleep 0.25s
6. Log progress every 50 movies: "250/850 inserted"
7. On completion: print total inserted, skipped (already existed), failed
```

Why upsert (not plain INSERT):
- Script can be re-run safely (e.g., if it crashed mid-way)
- `ON CONFLICT DO NOTHING` for genres/directors (fixed lookup data)
- `ON CONFLICT (id) DO UPDATE SET fetched_at = NOW()` for movies (refresh timestamp)

Expected output:
```
[SEED] Starting: fetching popular movies (25 pages)...
[SEED] Fetching top_rated movies (25 pages)...
[SEED] Total unique movie IDs: 847
[SEED] 50/847 processed...
[SEED] 100/847 processed...
...
[SEED] DONE. Inserted: 802 | Skipped: 45 | Failed: 0
[SEED] Time elapsed: 38 minutes
```

Run:
```bash
python scripts/seed_movies.py
```

---

## Step 8 — Redis Cache Setup

**File: `app/db/cache.py`**

How it works:
- Connects to Upstash Redis via `REDIS_URL`
- Upstash is serverless Redis — connection is HTTP-based, handles cold starts
- All cache functions are async (non-blocking)

```python
import redis.asyncio as redis
from app.config import settings

redis_client = redis.from_url(settings.redis_url, decode_responses=True)

async def get_cached(key: str):
    return await redis_client.get(key)

async def set_cached(key: str, value: str, ttl: int):
    await redis_client.setex(key, ttl, value)

async def invalidate(key: str):
    await redis_client.delete(key)
```

TTLs used (from `params.yaml`):
| Cache Key Pattern | TTL |
|-------------------|-----|
| `movie:detail:{id}` | 3600s (1hr) |
| `movie:trending` | 1800s (30min) |
| `movie:list:{hash}` | 1800s (30min) |
| `genre:all` | 86400s (24hr) |
| `search:{query_hash}` | 600s (10min) |
| `tmdb:config` | 86400s (24hr) |

---

## Step 9 — Basic FastAPI App (Phase 1 stub)

**File: `app/main.py`**

Phase 1 version — minimal. Just proves stack works end-to-end before building all routes.

```python
from fastapi import FastAPI
from app.config import settings

app = FastAPI(
    title="Movientum API",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,
)

@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}
```

Start server:
```bash
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Verify: open `http://localhost:8000/docs` → Swagger UI appears.

---

## Phase 1 Execution Order

Build in this exact order. Each step depends on previous.

| # | Action | File | Test |
|---|--------|------|------|
| 1 | Create requirements.txt | `backend/requirements.txt` | `pip install -r requirements.txt` succeeds |
| 2 | Create config.py | `app/config.py` | `python -c "from app.config import settings; print(settings.tmdb_api_key)"` prints key |
| 3 | Create orm_models.py | `app/db/orm_models.py` | Import without error |
| 4 | Create database.py | `app/db/database.py` | Import without error |
| 5 | Setup Alembic | `alembic.ini` + `alembic/env.py` | `alembic current` shows no error |
| 6 | Run migration | `alembic/versions/001_*.py` | `alembic upgrade head` → tables in Supabase |
| 7 | Create tmdb_service.py | `app/services/tmdb_service.py` | `fetch_popular_movies(1)` returns 20 movies |
| 8 | Create cache.py | `app/db/cache.py` | `set_cached("test", "1", 10)` → Redis shows key |
| 9 | Run seed script | `scripts/seed_movies.py` | 800+ movies in Supabase `movies` table |
| 10 | Create main.py stub | `app/main.py` | `GET /api/health` returns 200 |

---

## What Supabase Will Look Like After Phase 1

After `alembic upgrade head` + `seed_movies.py`:

| Table | Row Count | Notes |
|-------|-----------|-------|
| `movies` | ~800–1000 | TMDB popular + top_rated |
| `genres` | ~19 | TMDB has 19 official genres |
| `movie_genres` | ~2000–3000 | avg 2–3 genres per movie |
| `directors` | ~600–800 | one director per movie avg |
| `movie_directors` | ~800–1000 | matches movies count |
| `users` | 0 | Phase 3 auth |
| `ratings` | 0 | Phase 3 auth |

Verify in Supabase dashboard: Table Editor → click `movies` → should see populated rows.

---

## What Comes After Phase 1

| Phase | What | When |
|-------|------|------|
| **Phase 2** | Full React frontend (SPA) | After Phase 1 DB populated |
| **Phase 3** | Full FastAPI backend (all endpoints, auth, all routes) | Parallel with Phase 2 |
| **Phase 4** | Docker + deployment + CI/CD | After Phase 2 + 3 done |
| **Phase 5** | ML recommendations (FedPCL) | After data accumulates from real users |

Next immediate step: build all Phase 1 files in order above. Start with `requirements.txt`.

---

## Common Issues + Fixes

| Issue | Fix |
|-------|-----|
| `asyncpg` SSL error with Supabase | Add `?ssl=require` to `ASYNC_DATABASE_URL` |
| Alembic can't connect | Use `DATABASE_URL` (psycopg2 sync), NOT async URL |
| TMDB 401 | Token not in `Authorization: Bearer {token}` header — don't use as query param |
| Redis connection refused | Upstash requires TLS — URL starts with `rediss://` or use `ssl=True` flag |
| Supabase RLS blocks inserts | Disable RLS on tables: `ALTER TABLE movies DISABLE ROW LEVEL SECURITY;` |
| `ON CONFLICT` fails | Ensure PRIMARY KEY defined in ORM model matches DB |
