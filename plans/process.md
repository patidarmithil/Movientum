# Movientum — Docker Setup: Step-by-Step

Full guide to get the project running locally via Docker.

---

## Prerequisites

Install these before starting:

| Tool | Version | Download |
|------|---------|---------|
| Docker Desktop | Latest | https://docs.docker.com/desktop/install/windows-install/ |
| Node.js | 20+ | https://nodejs.org/ (for frontend dev without Docker) |
| Git | Any | https://git-scm.com/ |

Verify Docker works:
```powershell
docker --version
docker compose version
```

---

## Project Structure (relevant parts)

```
FedPCL code/
├── backend/
│   ├── app/              ← FastAPI application
│   ├── alembic/          ← DB migration scripts
│   ├── requirements.txt
│   ├── .env              ← your local secrets (never commit)
│   └── .env.example      ← template
├── frontend/
│   ├── src/
│   ├── .env              ← VITE_API_URL
│   └── package.json
├── docker-compose.yml    ← (you will create this)
└── plans/
```

---

## Step 1 — Clone and Open Project

```powershell
# If not already cloned:
git clone <repo-url> "FedPCL code"
cd "FedPCL code"
```

---

## Step 2 — Set Up Backend Environment File

Copy the example env file and fill in your real credentials:

```powershell
copy backend\.env.example backend\.env
```

Open `backend\.env` and fill in every value:

```env
# ── TMDB ─────────────────────────────────────────────
TMDB_API_KEY=<your_tmdb_api_key>
TMDB_READ_ACCESS_TOKEN=<your_tmdb_read_access_token>
TMDB_BASE_URL=https://api.themoviedb.org/3
TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p

# ── Supabase PostgreSQL ───────────────────────────────
# Get these from: Supabase → Project → Settings → Database → Connection string
DB_PASSWORD=<your_supabase_db_password>

# Alembic migrations — transaction pooler (port 6543, sync psycopg2)
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres

# FastAPI fallback — session pooler (port 5432, sync)
DATABASE_POOL_URL=postgresql://postgres.<ref>:<password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres

# FastAPI runtime — session pooler (port 5432, ASYNC asyncpg driver)
ASYNC_DATABASE_URL=postgresql+asyncpg://postgres.<ref>:<password>@aws-1-ap-south-1.pooler.supabase.com:5432/postgres

# ── Upstash Redis ─────────────────────────────────────
# Get from: Upstash console → your database → connection string (TLS)
REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379

# ── JWT ───────────────────────────────────────────────
JWT_SECRET_KEY=<64-char-random-hex>   # generate: openssl rand -hex 32
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# ── App ───────────────────────────────────────────────
APP_ENV=development
APP_HOST=0.0.0.0
APP_PORT=8000
DEBUG=True

# ── CORS ─────────────────────────────────────────────
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://movientum.vercel.app

# ── Celery ────────────────────────────────────────────
CELERY_BROKER_URL=rediss://default:<password>@<host>.upstash.io:6379
CELERY_RESULT_BACKEND=rediss://default:<password>@<host>.upstash.io:6379
```

> ⚠️ **Three separate DB URLs** — do NOT mix them up. `DATABASE_URL` = psycopg2 sync on port 6543. `ASYNC_DATABASE_URL` = asyncpg on port 5432. FastAPI will error if you use the wrong one.

---

## Step 3 — Set Up Frontend Environment File

```powershell
# frontend/.env already exists with local backend URL
# Verify it has:
type frontend\.env
```

Expected content:
```env
VITE_API_URL=http://127.0.0.1:8000
```

If running frontend inside Docker compose network, change to:
```env
VITE_API_URL=http://backend:8000
```

---

## Step 4 — Create the Dockerfile (Backend)

Create `backend/Dockerfile`:

```dockerfile
FROM python:3.13-slim

WORKDIR /app

# Copy deps first — Docker caches this layer
# Only re-runs pip if requirements.txt changes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

EXPOSE 8000

# Dev override via docker-compose command: adds --reload
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Create `backend/.dockerignore`:

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
*.egg-info
```

---

## Step 5 — Create docker-compose.yml

Create `docker-compose.yml` at project root:

```yaml
version: "3.9"

services:

  # ── FastAPI Backend ─────────────────────────────────
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: movientum_backend
    command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    volumes:
      - ./backend:/app          # hot reload — code changes reflect immediately
    env_file:
      - ./backend/.env          # Supabase + Upstash creds
    ports:
      - "8000:8000"
    networks:
      - movientum_network
    restart: unless-stopped

  # ── Celery Worker ────────────────────────────────────
  celery:
    build:
      context: ./backend
      dockerfile: Dockerfile    # same image as backend
    container_name: movientum_celery
    command: celery -A app.celery_app worker --loglevel=info --concurrency=2
    volumes:
      - ./backend:/app
    env_file:
      - ./backend/.env
    depends_on:
      - backend
    networks:
      - movientum_network
    restart: unless-stopped

  # ── Frontend (optional — can also run natively) ──────
  # Uncomment if you want everything in Docker.
  # Otherwise just run: cd frontend && npm run dev
  #
  # frontend:
  #   image: node:20-alpine
  #   container_name: movientum_frontend
  #   working_dir: /app
  #   command: sh -c "npm install && npm run dev -- --host 0.0.0.0"
  #   volumes:
  #     - ./frontend:/app
  #     - /app/node_modules     # prevent host node_modules from overwriting
  #   ports:
  #     - "5173:5173"
  #   environment:
  #     - VITE_API_URL=http://backend:8000
  #   depends_on:
  #     - backend
  #   networks:
  #     - movientum_network

networks:
  movientum_network:
    driver: bridge
```

> **No Postgres or Redis services** — those are managed by Supabase and Upstash. Connect to them via the URLs in your `.env`.

---

## Step 6 — Run Database Migrations (FIRST TIME ONLY)

Before starting the app, schema must be applied to Supabase:

```powershell
# Option A: run Alembic locally (Python must be installed)
cd backend
pip install -r requirements.txt   # or use a venv
alembic upgrade head

# Option B: run Alembic inside a temporary Docker container
docker compose run --rm backend alembic upgrade head
```

> This uses `DATABASE_URL` (psycopg2, port 6543). Run once on fresh DB, then again after each `alembic revision`.

---

## Step 7 — Build and Start Docker Containers

```powershell
# From project root (where docker-compose.yml is)

# First time — builds images and starts
docker compose up --build

# Subsequent runs — starts without rebuilding
docker compose up

# Background (detached) mode
docker compose up -d
```

Expected output:
```
movientum_backend  | INFO: Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
movientum_backend  | INFO: Started reloader process
movientum_celery   | [2026-xx-xx] celery@... ready.
```

---

## Step 8 — Start Frontend (Separate Terminal)

Frontend runs natively for best hot-reload experience:

```powershell
cd frontend
npm install       # first time only
npm run dev       # Vite dev server → http://localhost:5173
```

Or if you uncommented the frontend service in docker-compose:
```powershell
docker compose up frontend
```

---

## Step 9 — Verify Everything Works

| Check | URL / Command | Expected |
|-------|-------------|---------|
| Backend health | `http://localhost:8000/api/health` | `{"status":"ok","dependencies":{"database":"ok","cache":"ok"}}` |
| Backend API docs | `http://localhost:8000/docs` | Swagger UI loads |
| Frontend | `http://localhost:5173` | Movientum home page loads |
| Movies trending | `http://localhost:8000/api/v1/movies/trending` | JSON with movie list |

If `cache: "error"` in health — Redis URL wrong or Upstash unreachable. App degrades gracefully (non-fatal).
If `database: "error"` — Supabase URL wrong or migrations not applied.

---

## Common Commands

```powershell
# View logs
docker compose logs backend
docker compose logs celery
docker compose logs -f backend   # follow (live tail)

# Stop all containers
docker compose down

# Stop + remove volumes
docker compose down -v

# Rebuild after requirements.txt change
docker compose up --build backend

# Open shell inside backend container
docker compose exec backend bash

# Run one-off command
docker compose run --rm backend python -c "from app.config import settings; print(settings.app_env)"

# Check container status
docker compose ps
```

---

## Rebuilding After Code Changes

| Change | Action needed |
|--------|-------------|
| Python code (`.py`) | Auto-reload via `--reload` (Uvicorn watches `/app`) |
| `requirements.txt` | `docker compose up --build backend` |
| Frontend code | Vite hot-reloads automatically |
| `frontend/package.json` | `npm install` in frontend dir (or rebuild frontend container) |
| DB schema (new migration) | `docker compose run --rm backend alembic upgrade head` |

---

## Troubleshooting

### Backend won't start — ModuleNotFoundError
```
# requirements.txt changed since image built
docker compose up --build backend
```

### `asyncpg` connection error / SSL required
```
# Check ASYNC_DATABASE_URL — must use port 5432 (session pooler)
# Must start with: postgresql+asyncpg://
# Supabase enforces SSL — asyncpg handles it automatically with asyncpg 0.30+
```

### `psycopg2` error during alembic
```
# DATABASE_URL must use port 6543 (transaction pooler)
# Must start with: postgresql:// (not postgresql+asyncpg://)
```

### Celery connects but tasks don't run
```
# Verify CELERY_BROKER_URL in .env — must be same Redis URL
# Check: docker compose logs celery
# Celery module path must be: app.celery_app (not app.celery)
```

### CORS error in browser
```
# Add your frontend origin to ALLOWED_ORIGINS in backend/.env
# Example: ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
# No trailing slash, no spaces between values
```

### Azure cold start (production)
```
# First request after ~20 min idle → 15-30s delay
# Frontend Axios timeout = 45 000ms — do NOT lower it
# This is expected behavior on Azure free/shared tier
```

### Hot reload not working
```
# Ensure volume mount in docker-compose.yml:
#   volumes:
#     - ./backend:/app
# Without this, container runs stale code copy
```

---

## Production Deployment

### Backend → Azure App Service

```powershell
# Build production image (no --reload, no volume mounts)
docker build -t movientum-backend ./backend

# Push to Azure Container Registry (or Docker Hub)
docker tag movientum-backend <acr-name>.azurecr.io/movientum-backend:latest
docker push <acr-name>.azurecr.io/movientum-backend:latest

# Azure App Service picks up new image on restart
# Startup command in Azure portal:
# uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Set all env vars in: **Azure portal → App Service → Configuration → Application settings**

### Frontend → Vercel

```powershell
cd frontend
npm run build           # generates frontend/dist/
vercel deploy           # or push to GitHub → auto-deploys
```

Set `VITE_API_URL` in: **Vercel → Project → Settings → Environment Variables**

---

## Environment Summary

| File | Purpose | Committed? |
|------|---------|-----------|
| `backend/.env` | Real secrets for local dev | ❌ No (git-ignored) |
| `backend/.env.example` | Template with placeholder values | ✅ Yes |
| `frontend/.env` | `VITE_API_URL` for local dev | ❌ No (git-ignored) |
| `docker-compose.yml` | Local dev orchestration | ✅ Yes |
| `backend/Dockerfile` | Backend image definition | ✅ Yes |
| `backend/.dockerignore` | Files excluded from image | ✅ Yes |
