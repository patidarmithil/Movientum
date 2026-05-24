# System Architecture — Movientum

## Overview

Movientum is a **modular monolith** at launch. All backend features live in one deployable service. Structured internally as if microservices (clear module boundaries) — easy to split later. Frontend is a separate React SPA deployed independently.

---

## High-Level Architecture (Text Diagram)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         INTERNET                                     │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         NGINX (Reverse Proxy)                        │
│  - SSL termination                                                   │
│  - Static file serving (React build)                                 │
│  - Rate limiting (basic)                                             │
│  - Route: /api/* → FastAPI backend                                   │
│  - Route: /* → React app                                             │
└───────────────┬─────────────────────────────┬───────────────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────┐       ┌─────────────────────────────────────┐
│   REACT FRONTEND      │       │         FASTAPI BACKEND             │
│  (Static files)       │       │                                     │
│  - SPA (index.html)   │       │  ┌─────────────────────────────┐   │
│  - React components   │       │  │         MIDDLEWARE           │   │
│  - Context API state  │       │  │  CORS │ Auth │ Rate │ Log   │   │
│  - Service layer      │       │  └─────────────┬───────────────┘   │
│  - React Router       │       │                │                   │
└───────────────────────┘       │  ┌─────────────▼───────────────┐   │
                                │  │          ROUTERS             │   │
                                │  │ auth │ movies │ ratings │   │   │
                                │  │ search │ recs │ news │ watch │  │
                                │  └─────────────┬───────────────┘   │
                                │                │                   │
                                │  ┌─────────────▼───────────────┐   │
                                │  │          SERVICES            │   │
                                │  │ Business logic per module   │   │
                                │  └──────────┬──────────────────┘   │
                                │             │                      │
                                │   ┌─────────┼─────────┐           │
                                │   │         │         │           │
                                │   ▼         ▼         ▼           │
                                │ ┌──────┐ ┌──────┐ ┌──────────┐   │
                                │ │Repos │ │Redis │ │External  │   │
                                │ │(DB)  │ │Cache │ │APIs      │   │
                                │ └──┬───┘ └──────┘ │(TMDB,    │   │
                                │    │              │ NewsAPI) │   │
                                │    ▼              └──────────┘   │
                                │ ┌──────────────────────┐        │
                                │ │    PostgreSQL DB      │        │
                                │ └──────────────────────┘        │
                                │                                  │
                                │  ┌───────────────────────────┐  │
                                │  │  FedPCL Training Module   │  │
                                │  │  (Background service)     │  │
                                │  └───────────────────────────┘  │
                                └─────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| Nginx | Nginx | Reverse proxy, SSL, static files |
| React Frontend | React + React Router | UI rendering, user interaction |
| FastAPI Backend | Python + FastAPI | API handling, business logic |
| PostgreSQL | PostgreSQL 15+ | Primary persistent data store |
| Redis | Redis 7+ | Cache, session data, rate limit counters |
| FedPCL Module | Python + PyTorch | Federated learning coordination |
| TMDB API | External | Movie metadata source |
| NewsAPI | External | News article source |

---

## Request Flow: Detailed Path

### Public Movie Browse Request

```
Browser: GET https://movientum.com/movies
  ↓
Nginx: serves React index.html (static file)
  ↓
React Router: renders /movies → MovieListPage component
  ↓
useEffect hook fires: movieService.getMovies({page: 1, genre: null})
  ↓
Browser: GET https://movientum.com/api/v1/movies?page=1
  ↓
Nginx: routes /api/* to FastAPI on port 8000
  ↓
FastAPI Middleware:
  - CORS: origin allowed
  - Auth: no token → user = null (public route, proceed)
  - Logger: log request
  ↓
FastAPI Router: matches GET /api/v1/movies
  ↓
movie_router.get_movies(page=1, filters={})
  ↓
movie_service.get_movie_list(page=1, filters={})
  ↓
Redis: check cache key "movies:list:page:1:no_filter"
  → Cache HIT: return JSON, log 1ms
  → Cache MISS: continue ↓
  ↓
movie_repo.get_movies_paginated(page=1, limit=20, filters={})
  ↓
PostgreSQL: SELECT + JOIN query, returns 20 movie rows
  ↓
Repo: map DB rows → Movie domain objects
  ↓
Service: enrich (add genre names, compute avg rating)
Service: cache in Redis (TTL: 30 min)
  ↓
Router: serialize via Pydantic response model → JSON
  ↓
FastAPI: HTTP 200 + JSON body
  ↓
Nginx: pass response back
  ↓
Browser: receives JSON
  ↓
React: updates state → renders MovieGrid with 20 MovieCards
```

---

## Microservices vs Monolith Decision

### Why Monolith (Now)

| Factor | Reasoning |
|--------|-----------|
| Team size | Small team → monolith faster to develop |
| Complexity | Microservices add deployment, networking, service discovery overhead |
| Performance | No inter-service network calls → faster |
| Data consistency | Single DB → no distributed transaction complexity |
| Iteration speed | Change business logic in one place |

### Why Modular Monolith (Not Spaghetti Monolith)

Code organized as if microservices:
- Each module (auth, movies, ratings, recs, news) is self-contained
- Clear interfaces between modules (service functions, not direct DB cross-module queries)
- Module A calls Module B's service, never Module B's repository directly

This enables clean future split into actual microservices when needed.

### When to Split (Future Triggers)

| Trigger | Module to Extract |
|---------|-------------------|
| FedPCL training becomes heavy | Extract FedPCL Training Service |
| News fetching causes latency issues | Extract News Service |
| Recommendation serving slows | Extract Recommendation Service |
| Search volume high | Extract Search Service (add Elasticsearch) |
| Multiple frontend clients (mobile) | Consider GraphQL gateway |

---

## Deployment Architecture (MVP)

Single server deployment:

```
1 VPS / Cloud VM (e.g., 4 vCPU, 8GB RAM)
  │
  ├── Nginx (port 80/443)
  ├── FastAPI via Uvicorn (port 8000, 4 workers)
  ├── PostgreSQL (port 5432, same server)
  ├── Redis (port 6379, same server)
  └── Celery Worker (background tasks)
```

**Process Manager**: Systemd or Supervisor to keep processes running. Auto-restart on crash.

**SSL**: Let's Encrypt (free, auto-renewing certificates).

---

## Deployment Architecture (Scale-Out)

When MVP outgrows single server:

```
Load Balancer (e.g., AWS ALB)
  │
  ├── FastAPI Instance 1 (2 vCPU, 4GB)
  ├── FastAPI Instance 2 (2 vCPU, 4GB)
  └── FastAPI Instance 3 (2 vCPU, 4GB)

Separate DB Server:
  └── PostgreSQL (8 vCPU, 16GB, SSD)

Separate Cache:
  └── Redis (2 vCPU, 4GB) or Redis Cluster

CDN:
  └── Cloudflare (static assets, poster images via proxy)
```

---

## Environment Separation

| Environment | Purpose | Data |
|-------------|---------|------|
| Development | Local dev, rapid iteration | Fake/seed data |
| Staging | Pre-production testing | Copy of production data (anonymized) |
| Production | Live users | Real data |

Config differs per environment via environment variables. Code is identical.

---

## Monitoring and Observability

Basic monitoring from day 1:

- **Health check endpoint**: `GET /api/health` → returns `{status: "ok", version: "1.0"}` — used by load balancer
- **Application logs**: Structured JSON logs → sent to centralized log aggregator (e.g., Datadog, Papertrail, Loki)
- **Error tracking**: Sentry integration — captures exceptions with stack traces
- **Performance metrics**: Request duration, DB query time, cache hit rate
- **Uptime monitoring**: External ping every minute (e.g., Better Uptime, UptimeRobot)
- **DB metrics**: Connection pool size, slow query log

Alert thresholds:
- Error rate > 1% → alert
- P95 response time > 2s → alert
- DB connection pool > 80% → alert
- Disk usage > 80% → alert
