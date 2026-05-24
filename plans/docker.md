# Docker — Movientum Containerization

## Overview

Every Movientum service runs in a Docker container. Containers package the application + its dependencies into a portable, reproducible unit. Same container runs on developer laptop, staging, and production — no "works on my machine" problems.

Docker Compose orchestrates all containers together in development. In production, containers run on a VPS or cloud with Nginx in front.

---

## Container Architecture

```
┌──────────────────────────────────────────────────────┐
│              Docker Compose Network                   │
│               (movientum_network)                     │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐   │
│  │   FRONTEND   │    │        BACKEND           │   │
│  │  (Nginx +    │    │     (FastAPI +            │   │
│  │  React SPA)  │    │      Uvicorn)             │   │
│  │  Port: 3000  │    │      Port: 8000           │   │
│  └──────┬───────┘    └───────────┬──────────────┘   │
│         │                        │                   │
│         └────────────┬───────────┘                   │
│                      │                               │
│         ┌────────────▼───────────┐                   │
│         │       NGINX            │                   │
│         │  (Reverse Proxy)       │                   │
│         │  Port: 80, 443         │                   │
│         └────────────────────────┘                   │
│                                                      │
│  ┌───────────────┐   ┌──────────────────────────┐   │
│  │  POSTGRESQL   │   │         REDIS            │   │
│  │  Port: 5432   │   │         Port: 6379       │   │
│  │  Volume: pg   │   │         Volume: redis    │   │
│  └───────────────┘   └──────────────────────────┘   │
│                                                      │
│  ┌───────────────────────────────────────────────┐  │
│  │         CELERY WORKER (Background Tasks)       │  │
│  │         (shares backend image)                 │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

---

## Individual Container Designs

### 1. Frontend Container

**Base image:** `node:20-alpine` (build stage) → `nginx:alpine` (serve stage)

**Multi-stage build approach:**
- Stage 1 (build): Node.js environment installs dependencies and builds React production bundle
- Stage 2 (serve): Nginx serves the static output files

**Container responsibility:**
- Serve compiled React SPA (static HTML/JS/CSS)
- Handle client-side routing (all paths → `index.html`)
- Proxy `/api/*` requests to backend container

**Nginx config inside container:**
```
location / {
  try_files $uri $uri/ /index.html;   → SPA routing
}

location /api/ {
  proxy_pass http://backend:8000;     → forward to backend
}
```

**Why multi-stage:** Final image contains ONLY Nginx + static files. No Node.js runtime in production. Image size: ~15 MB vs ~500 MB single-stage.

**Port exposed:** 3000 (development) or 80 (production)

**Environment variables needed:**
```
REACT_APP_API_URL=http://localhost:8000   (dev)
REACT_APP_API_URL=https://movientum.com  (prod)
```

---

### 2. Backend Container

**Base image:** `python:3.11-slim` (minimal Python, no dev tools)

**Contents:**
- FastAPI application code
- All Python dependencies (from requirements.txt)
- No test files, no dev tools in production image

**Process inside container:**
```
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

`--workers 4` = 4 Uvicorn worker processes (uses all 4 vCPUs)
`--host 0.0.0.0` = accept from any IP inside Docker network

**Dependencies installed:**
```
fastapi
uvicorn[standard]
sqlalchemy
asyncpg          ← async PostgreSQL driver
redis
pydantic
python-jose      ← JWT
passlib[bcrypt]  ← password hashing
celery           ← background tasks
httpx            ← async HTTP for TMDB/News API calls
torch            ← for FedPCL model operations
numpy
scikit-learn     ← K-means clustering
mlflow           ← experiment tracking
```

**Port exposed:** 8000

**Health check:** `GET /api/health` → must return 200 before accepting traffic

**Environment variables (from .env file, never hardcoded):**
```
DATABASE_URL
REDIS_URL
JWT_SECRET_KEY
TMDB_API_KEY
NEWS_API_KEY
ENVIRONMENT
MLFLOW_TRACKING_URI
```

---

### 3. PostgreSQL Container

**Base image:** `postgres:15-alpine`

**Configuration:**
- Data stored in named Docker volume (persists across container restarts)
- `pg_hba.conf`: allow connections only from Docker network (not from internet)
- `postgresql.conf` tuning:
  - `max_connections = 100`
  - `shared_buffers = 256MB`
  - `work_mem = 16MB`

**Port exposed:** 5432 (internal Docker network only — NOT exposed to host in production)

**Initialization:**
- On first start: runs `init.sql` script (creates schemas, runs first Alembic migration)
- Volume: `postgres_data` → persists DB files even if container recreated

**Backup:**
- Cron inside container (or external cron): `pg_dump` daily → copy to backup volume or S3

---

### 4. Redis Container

**Base image:** `redis:7-alpine`

**Configuration:**
```
maxmemory 512mb                    → cap memory usage
maxmemory-policy allkeys-lru       → evict least recently used when full
save 900 1                         → RDB snapshot: save if 1 change in 900s
appendonly no                      → no AOF (cache = reconstructable, no need)
```

**Port exposed:** 6379 (internal Docker network only)

**Volume:** `redis_data` → persists RDB snapshot file

Redis data is cache — if lost, backend rebuilds from DB. Not critical persistence.

---

### 5. Celery Worker Container

**Base image:** Same as backend (`python:3.11-slim` with same dependencies)

**Process:**
```
celery -A app.celery worker --loglevel=info --concurrency=2
```

**What Celery handles:**
- Background news fetch (every 2 hours)
- Post-rating recommendation cache invalidation
- FedPCL round management (scheduling, client notification)
- Email sending (welcome, password reset — future)

Shares same codebase as backend. Different entrypoint command only.

**No exposed port** — Celery communicates via Redis broker, not HTTP.

---

## Docker Compose (Development)

Full multi-container setup for local development:

```yaml
Services:
  postgres:
    image: postgres:15-alpine
    environment: POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
    volumes: postgres_data:/var/lib/postgresql/data
    healthcheck: pg_isready -U movientum
    networks: movientum_network

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes: redis_data:/data
    networks: movientum_network

  backend:
    build: ./backend  (Dockerfile in backend folder)
    command: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
    volumes: ./backend:/app  (mount source for hot reload)
    env_file: .env
    depends_on: [postgres (healthy), redis]
    ports: "8000:8000"
    networks: movientum_network

  celery:
    build: ./backend  (same image as backend)
    command: celery -A app.celery worker --loglevel=info
    volumes: ./backend:/app
    env_file: .env
    depends_on: [redis, postgres (healthy)]
    networks: movientum_network

  frontend:
    build: ./frontend
    command: npm start  (development server with hot reload)
    volumes: ./frontend/src:/app/src  (hot reload src changes)
    ports: "3000:3000"
    environment: REACT_APP_API_URL=http://localhost:8000
    networks: movientum_network

  mlflow:
    image: ghcr.io/mlflow/mlflow:latest
    command: mlflow server --host 0.0.0.0 --port 5000 --backend-store-uri postgresql://...
    ports: "5000:5000"
    networks: movientum_network

volumes:
  postgres_data:
  redis_data:

networks:
  movientum_network:
    driver: bridge
```

**Dev-specific features:**
- `--reload` on uvicorn: backend auto-restarts when Python file changes
- Source code mounted as volume: change code → reflected immediately
- All ports exposed to host (8000, 5432, 6379, 3000) for direct access during development
- MLflow UI accessible at `http://localhost:5000`

---

## Docker Compose (Production)

Key differences from development:

```yaml
backend:
  image: movientum/backend:v1.8   ← pre-built image, no volume mount
  command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
  restart: always
  # port 8000 NOT exposed to host — only accessible via Nginx

frontend:
  image: movientum/frontend:v1.8   ← pre-built Nginx image with static files
  restart: always
  # port 80 exposed

postgres:
  image: postgres:15-alpine
  restart: always
  # port 5432 NOT exposed to host

redis:
  image: redis:7-alpine
  restart: always
  # port 6379 NOT exposed to host
```

**Production hardening:**
- No source code volumes — use pre-built images
- `restart: always` — auto-restart on crash
- DB and Redis ports NOT exposed to host machine (only accessible within Docker network)
- Secrets via Docker Secrets or mounted secrets file (never in docker-compose.yaml)

---

## Environment Management

### Three Environment Files

```
.env.development     → local dev (debug=True, local DB)
.env.staging         → staging server (production-like config, anonymized data)
.env.production      → live server (all real secrets, strict settings)
```

**Never commit any .env file to git.** Use `.env.example` with placeholder values.

**Secret management:**
- Development: .env files
- Staging/Production: environment variables injected by deployment system (e.g., GitHub Actions secrets, Docker Secrets, Vault)

---

## Networking Between Containers

All containers on same Docker network `movientum_network`. Communication by **service name** (DNS resolution built into Docker):

```
Backend connects to DB:   postgresql://postgres:5432/movientum
Backend connects to Redis: redis://redis:6379/0
Nginx proxies backend:     http://backend:8000
Celery broker:             redis://redis:6379/1  (different DB index)
MLflow backend store:      postgresql://postgres:5432/mlflow
```

No IP addresses needed. Docker handles DNS. If container restarts with new IP → DNS still resolves.

---

## Build Pipeline (CI/CD Integration)

On every git push to `main` branch:

```
GitHub Actions:
  1. Run tests (pytest for backend, jest for frontend)
  2. Build backend Docker image: docker build -t movientum/backend:$SHA
  3. Build frontend Docker image: docker build -t movientum/frontend:$SHA
  4. Tag as latest: docker tag ... movientum/backend:latest
  5. Push to container registry (Docker Hub or GitHub Container Registry)
  6. SSH to production server
  7. docker compose pull (pull new images)
  8. docker compose up -d --no-deps backend frontend (rolling restart)
  9. Run health checks: curl /api/health
  10. If health check fails → docker compose rollback (re-deploy previous image)
```

Zero-downtime deployment via Docker Compose `--no-deps` flag — restarts services one at a time.

---

## Image Size Optimization

| Container | Strategy | Target Size |
|-----------|---------|------------|
| Frontend | Multi-stage (Node→Nginx) | < 20 MB |
| Backend | python:3.11-slim, no dev deps | < 400 MB |
| PostgreSQL | postgres:15-alpine | < 70 MB |
| Redis | redis:7-alpine | < 15 MB |

**Backend optimization tips:**
- Use `--no-cache-dir` when pip installing
- Copy only `requirements.txt` first (Docker layer caching — don't reinstall if deps unchanged)
- Use `.dockerignore` to exclude: `.git`, `tests/`, `*.md`, `__pycache__`, `data/`
