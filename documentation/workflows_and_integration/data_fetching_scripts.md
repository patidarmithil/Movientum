# Data Fetching & Maintenance Scripts

## Overview & Architecture

To support the Movientum machine learning pipeline and graph generation, the database must be pre-populated with a rich catalog of interconnected movies, TV shows, and talent. Because doing this on-the-fly via TMDB APIs would be too slow, a suite of offline Python scripts in `backend/scripts/` is used to ingest, seed, and migrate data en masse.

These scripts bypass FastAPI routers and connect directly to the database via SQLAlchemy, utilizing `asyncio.Semaphore` to parallelize high-volume API ingestion without hitting rate limits.

---

## Logics & Business Rules

### Rate Limiting & Concurrency
- TMDB permits roughly 50 requests per second on the v3 API. 
- The ingestion scripts (`seed_catalog.py`, `seed_movies.py`) use `httpx.AsyncClient` alongside an `asyncio.Semaphore(30)` to strictly limit concurrent outbound HTTP requests, preventing `429 Too Many Requests` bans.

### Upsert Logic
When parsing TMDB payloads, the scripts extract highly dimensional data (cast IDs, crew IDs grouped by role, keywords) and upsert them into the `content_catalog` table. The `is_seed=True` flag is set to differentiate initial bulk loads from on-the-fly user-triggered ingestions.

---

## Code Structure & Detailed Logic

### Active Maintenance Scripts

| Script Name | Purpose |
|---|---|
| `seed_catalog.py` | Master ingestion script. Pulls thousands of TMDB items, resolves `/credits` and `/keywords`, and formats the `ARRAY(Integer)` and `JSONB` columns required for the ML feature matrix. |
| `seed_movies.py` | Similar to catalog seeder, but strictly focused on populating the `movies` table with basic metadata for standard browsing (Phase 1). |
| `load_ratings.py` | Ingests bulk user ratings (skip, timepass, go_for_it, perfection) to simulate a cold-start userbase or backfill historical data. |
| `load_tv_ratings.py` / `load_movie_ratings_2026.py` | Integrations with external rating sources (`moctale_scrapper`) to populate the `movie_ratings` and `tv_ratings` meter tables for display. |
| `ingest_search_index.py` | Scans the database and updates the PostgreSQL `TSVECTOR` columns to ensure rapid full-text search capabilities across titles and overviews. |
| `migrate_and_load.py` | Orchestration script that runs Alembic migrations (`alembic upgrade head`) and immediately follows up by triggering seed scripts in a fresh environment. |
| `generate_dashboards.py` | Infrastructure script that dynamically generates Grafana JSON dashboard definitions based on the OpenTelemetry metrics exported by `telemetry.py`. |
| `test_app_insights.py` | Telemetry validation script to ensure custom metrics are correctly arriving in Azure Monitor. |
| `create_admin.py` | Simple utility to forcefully inject a user with the `admin` role directly into the database. |

---

## Tables & Summaries

### Execution Environments
| Script Type | Run Frequency | Environment |
|---|---|---|
| **Seeders** | Once per environment deployment | Local / CI Server |
| **Migrations** | On every deployment | CI/CD Pipeline |
| **Rating Importers**| Weekly/Monthly (via Cron) | Celery Beat / Cron Job |

---

## Workflows & Lifecycles

### Bulk Ingestion Flow (`seed_catalog.py`)
```mermaid
flowchart TD
    A[Start Script] --> B[Fetch TMDB Top/Popular Lists]
    B --> C[Extract distinct TMDB IDs]
    C --> D[Initialize asyncio.Semaphore(30)]
    D --> E[Spawn concurrent httpx GET /movie/{id}]
    D --> F[Spawn concurrent httpx GET /movie/{id}/credits]
    E & F --> G[Parse JSON into dict]
    G --> H[Upsert into content_catalog via SQLAlchemy]
    H --> I[Commit Transaction]
```
