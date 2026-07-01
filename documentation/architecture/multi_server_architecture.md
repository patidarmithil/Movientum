# Multi-Server & Deployment Architecture

## Overview & Architecture

Movientum's infrastructure is decoupled across multiple specialized hosting environments to optimize for cost, performance, and workload type. 

- **Frontend**: Edge-deployed via Vercel (or similar CDN).
- **Backend / Workers**: Containerized environments (Docker) suitable for Azure Container Apps, Render, or Railway.
- **Data & Cache**: Managed external services (Supabase, Upstash) to offload stateful operational burden.

---

## Logics & Business Rules

### Separation of Compute
The API server and the background task processors (Celery) are built from the exact same Docker image (simplifying CI/CD). However, they are deployed as separate services scaling independently.
- The **FastAPI Backend** scales based on incoming HTTP request volume.
- The **Celery Worker** scales based on queue depth (e.g., massive backlogs of TMDB catalog ingestions).
- The **Celery Beat** scheduler is strictly deployed as a singleton (1 instance only) to prevent duplicate cron jobs (like the nightly retrain).

---

## Code Structure & Detailed Logic

### Deployment Configuration (`docker-compose.yml` baseline)
The local `docker-compose.yml` perfectly mirrors the production container topology:
```yaml
services:
  backend:
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
  celery_worker:
    command: celery -A app.celery_app worker --loglevel=info
  celery_beat:
    command: celery -A app.celery_app beat --loglevel=info
```

### Routing & CORS
The frontend connects to the backend via a single API gateway URL. The backend strictly enforces CORS to allow only trusted origins (`app.config.Settings.allowed_origins`).

---

## Tables & Summaries

### Infrastructure Topology

| Tier | Provider / Environment | Compute Type |
|---|---|---|
| **Frontend SPA** | Vercel | Global CDN / Edge Nodes |
| **API Server** | Azure / Render (Docker) | Stateless Web Containers |
| **Celery Workers**| Azure / Render (Docker) | Background Worker Containers |
| **PostgreSQL DB** | Supabase | Managed Database (with pgvector/JSONB) |
| **Redis Cache** | Upstash | Serverless Redis (TLS required) |
| **Telemetry** | Azure Monitor | Application Insights Agent |

---

## Workflows & Lifecycles

### Multi-Tier Request Flow
```mermaid
flowchart TD
    A[User Browser] -->|Static Assets| B[Vercel CDN]
    A -->|API Calls (HTTPS)| C[Load Balancer]
    C --> D[FastAPI Container 1]
    C --> E[FastAPI Container 2]
    D <--> F[(Upstash Redis)]
    D <--> G[(Supabase PostgreSQL)]
    D -->|Dispatch Task| F
    H[Celery Worker Container] <-->|Consume Task| F
    H <--> G
```
