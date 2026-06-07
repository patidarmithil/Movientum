# Docker — Movientum Containerization

## Overview

Movientum uses **two tiers** for containerization:

| Tier | What runs in Docker | What stays external |
|------|-------------------|-------------------|
| **Local dev** | Backend (FastAPI + Uvicorn) · Celery worker · Frontend (Vite dev server, optional) | Supabase PostgreSQL · Upstash Redis (cloud-managed) |
| **Production** | Backend image on Azure App Service | Vercel (frontend SPA) · Supabase · Upstash |

> **Why no local Postgres/Redis containers?**
> The project uses **Supabase** (managed Postgres) and **Upstash** (serverless Redis TLS). These are cloud services — you connect to them over the internet. No local database containers are needed or recommended (connection-pooling behavior differs between local Postgres and Supabase pooler ports).

---

## Actual Stack (vs. original docker.md)

| Component | Original plan | Actual implementation |
|-----------|-------------|----------------------|
| Frontend build tool | Create React App / Nginx | **Vite 8** — `npm run dev` (dev) / `vite build` (prod) |
| Frontend hosting | Docker + Nginx container | **Vercel** (SPA with `vercel.json` rewrites) |
| Backend runtime | Uvicorn 4 workers | **Uvicorn + Gunicorn** (`python:3.13-slim`) |
| Database | Local PostgreSQL container | **Supabase** PostgreSQL — two URLs (sync/async) |
| Cache | Local Redis container | **Upstash** Redis (TLS `rediss://`) |
| Backend hosting | Docker Compose VPS | **Azure App Service** |
| ML tracking | MLflow container | Not in production yet (`fedpcl/` is research only) |

---

## Container Architecture (Dev)

```
Developer Machine
│
├─ [Docker] backend container          → http://localhost:8000
│    └─ FastAPI + Uvicorn (--reload)
│
├─ [Docker] celery container           → background tasks via Redis broker
│    └─ celery -A app.celery_app worker
│
├─ [Local / Docker] frontend           → http://localhost:5173
│    └─ Vite dev server (npm run dev)
│
└─ [Cloud — no container needed]
     ├─ Supabase PostgreSQL  (port 5432 session pooler / 6543 tx pooler)
     └─ Upstash Redis        (TLS rediss://)
```

---

## Individual Container Designs

### 1. Backend Container

**Base image:** `python:3.13-slim`

> Requirements.txt explicitly states "Python 3.13 compatible (prebuilt wheels)". Use `python:3.13-slim`, not `python:3.11-slim`.

**Contents:**
- `backend/app/` — FastAPI application
- `backend/requirements.txt` — all Python dependencies
- `backend/alembic/` — migration scripts (run separately, not on startup)
- `backend/.env` — **never baked into image**, injected at runtime

**Dev entrypoint:**
```
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Prod entrypoint (Azure App Service):**
```
gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000 --workers 4
```

**Key dependencies (from requirements.txt):**
```
fastapi==0.115.0
uvicorn[standard]==0.30.6
gunicorn==23.0.0
sqlalchemy[asyncio]==2.0.36
asyncpg==0.30.0          ← async driver (FastAPI runtime, port 5432)
psycopg2-binary==2.9.10  ← sync driver (Alembic migrations, port 6543)
alembic==1.14.0
redis==5.2.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
pydantic==2.11.7
pydantic-settings==2.7.0
httpx==0.27.2
celery[redis]==5.4.0
pyyaml==6.0.2
```

**Port exposed:** 8000

**Health check endpoint:** `GET /api/health` → `{ status, dependencies: { database, cache } }`

**Environment variables (from `.env`, never hardcoded):**
```
# TMDB
TMDB_API_KEY
TMDB_READ_ACCESS_TOKEN
TMDB_BASE_URL=https://api.themoviedb.org/3
TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p

# Supabase PostgreSQL — TWO separate URLs
DATABASE_URL          # psycopg2 sync — Alembic (port 6543 transaction pooler)
DATABASE_POOL_URL     # psycopg2 — fallback (port 5432 session pooler)
ASYNC_DATABASE_URL    # asyncpg async — FastAPI runtime (port 5432 session pooler)
DB_PASSWORD

# Upstash Redis (TLS)
REDIS_URL             # rediss://default:PASSWORD@HOST:6379

# JWT
JWT_SECRET_KEY
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# App
APP_ENV=development
APP_HOST=0.0.0.0
APP_PORT=8000
DEBUG=True

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://movientum.vercel.app

# Celery
CELERY_BROKER_URL     # same Redis URL
CELERY_RESULT_BACKEND # same Redis URL
```

> ⚠️ **Critical:** `ASYNC_DATABASE_URL` uses `asyncpg` driver (port 5432 session pooler). `DATABASE_URL` uses `psycopg2` (port 6543 transaction pooler). Never swap them — Alembic will fail on asyncpg, FastAPI ORM will fail on psycopg2.

---

### 2. Celery Worker Container

**Base image:** Same `python:3.13-slim` with same `requirements.txt`

**Entrypoint:**
```
celery -A app.celery_app worker --loglevel=info --concurrency=2
```

**Module path:** `app.celery_app` (not `app.celery`) — actual file is `backend/app/celery_app.py`

**What Celery handles:**
- Background news fetch (scheduled)
- Post-rating recommendation cache invalidation
- FedPCL round management (future)

**Broker / backend:** Upstash Redis via `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND`

**No exposed port** — communicates via Redis broker only.

---

### 3. Frontend (Vite — NOT a long-lived Docker service)

**Not containerized in production.** Deployed to **Vercel**.

**For local dev two options:**

Option A — run natively (recommended):
```bash
cd frontend
npm install
npm run dev   # Vite dev server → http://localhost:5173
```

Option B — Docker container (optional, for full containerized dev):
- Base: `node:20-alpine`
- Mount `./frontend/src` as volume for hot reload
- Command: `npm run dev -- --host 0.0.0.0`
- Port: 5173

**Build for production:**
```bash
npm run build   # outputs to frontend/dist/
```
Vercel picks up `dist/` automatically. `vercel.json` rewrites all paths to `/` for SPA routing.

**Frontend env var:**
```
VITE_API_URL=http://127.0.0.1:8000   # local dev
VITE_API_URL=https://movientum-ewhhfwahfdh2bfgd.southeastasia-01.azurewebsites.net  # production
```
If `VITE_API_URL` not set, `src/utils/api.js` auto-falls-back to Azure URL.

---

## Docker Compose (Development)

Full local dev setup — connects to cloud Supabase + Upstash:

```yaml
# docker-compose.yml (root or backend/)
version: "3.9"

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    volumes:
      - ./backend:/app         # hot reload on code change
    env_file:
      - ./backend/.env         # Supabase + Upstash credentials here
    ports:
      - "8000:8000"
    networks:
      - movientum_network

  celery:
    build:
      context: ./backend
      dockerfile: Dockerfile   # same image as backend
    command: celery -A app.celery_app worker --loglevel=info --concurrency=2
    volumes:
      - ./backend:/app
    env_file:
      - ./backend/.env
    depends_on:
      - backend
    networks:
      - movientum_network

  # Frontend: run natively with "npm run dev" — OR uncomment below
  # frontend:
  #   build:
  #     context: ./frontend
  #   command: npm run dev -- --host 0.0.0.0
  #   volumes:
  #     - ./frontend/src:/app/src
  #   ports:
  #     - "5173:5173"
  #   environment:
  #     - VITE_API_URL=http://backend:8000
  #   networks:
  #     - movientum_network

networks:
  movientum_network:
    driver: bridge
```

**No volumes for Postgres/Redis** — those are cloud services. No `postgres_data` or `redis_data` volumes needed.

**Dev-specific features:**
- `--reload` on Uvicorn: restarts on Python file change
- Source code mounted: edit → reflected immediately, no rebuild
- Backend accessible at `http://localhost:8000`
- CORS allows `http://localhost:5173` (Vite default) out of the box

---

## Dockerfile — Backend

```dockerfile
# backend/Dockerfile
FROM python:3.13-slim

WORKDIR /app

# Install deps first (Docker layer cache — only reinstalls if requirements.txt changes)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY . .

# Expose port
EXPOSE 8000

# Default: production-like startup
# Override in docker-compose for dev (--reload, volume mount)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`.dockerignore` for backend:
```
.git
__pycache__
*.pyc
*.pyo
.pytest_cache
tests/
*.md
.env
debug/
```

---

## Production Deployment

### Backend → Azure App Service

Azure App Service runs Docker containers directly. No local Docker Compose in production.

**Build + push:**
```bash
docker build -t movientum-backend ./backend
docker tag movientum-backend <registry>.azurecr.io/movientum-backend:latest
docker push <registry>.azurecr.io/movientum-backend:latest
```

**Azure App Service settings:**
- Container source: Azure Container Registry (or Docker Hub)
- Port: 8000
- Startup command: `uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4`
- Env vars: set in Azure portal → App Service → Configuration → Application settings

**Important:** Azure free/shared tier **sleeps after ~20 min inactivity** → cold start 15–30s.
Frontend Axios timeout = **45 000ms** (already set) — do NOT lower it.

### Frontend → Vercel

```bash
cd frontend
vercel deploy   # or push to main → auto-deploy via Vercel GitHub integration
```

`vercel.json` handles SPA routing (rewrites all paths to `/`).
Set `VITE_API_URL` in Vercel project → Environment Variables.

---

## Networking

| Connection | URL pattern | Notes |
|-----------|------------|-------|
| FastAPI → Supabase (async) | `postgresql+asyncpg://...@...supabase.com:5432/postgres` | Session pooler, asyncpg |
| Alembic → Supabase (sync) | `postgresql://...@...supabase.com:6543/postgres` | Transaction pooler, psycopg2 |
| FastAPI → Upstash Redis | `rediss://default:PWD@HOST:6379` | TLS (`rediss://`) |
| Celery → Upstash Redis | Same `CELERY_BROKER_URL` | Different DB index in URL (`/1`) |
| Frontend → Backend (dev) | `http://127.0.0.1:8000` | Via `VITE_API_URL` |
| Frontend → Backend (prod) | `https://movientum-ewhhfwahfdh2bfgd.southeastasia-01.azurewebsites.net` | Via `VITE_API_URL` or api.js fallback |

---

## Environment Management

```
backend/.env           → local dev secrets (git-ignored)
backend/.env.example   → template with placeholder values (committed)
frontend/.env          → VITE_API_URL only (git-ignored)
```

**Never commit** real `.env` files. `.env.example` is safe — has no real values.

**Production secrets:**
- Azure: set via App Service → Configuration → Application settings
- Vercel: set via Vercel dashboard → Project → Environment Variables

---

## Image Size Optimization

| Container | Strategy | Target Size |
|-----------|---------|------------|
| Backend | `python:3.13-slim`, `--no-cache-dir`, `.dockerignore` | < 500 MB |
| Celery | Same image as backend (shared) | < 500 MB |
| Frontend | No long-lived container — Vercel static CDN | N/A |

**Backend optimization:**
- `COPY requirements.txt .` before `COPY . .` → Docker caches pip layer if deps unchanged
- `--no-cache-dir` saves ~100MB on pip cache
- `.dockerignore` excludes: `.git`, `__pycache__`, `*.pyc`, `tests/`, `debug/`, `.env`

---

## Alembic Migrations (NOT in Docker startup)

Run **manually** before deploying schema changes:

```bash
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

Uses `DATABASE_URL` (psycopg2 sync driver, port 6543 transaction pooler).
FastAPI runtime uses `ASYNC_DATABASE_URL` (asyncpg, port 5432 session pooler).

**Do NOT** run `alembic upgrade head` as part of Docker `CMD` or startup script in production — it uses the wrong driver and connection mode.
