# Backend Architecture

The backend is a single FastAPI application in `backend/app/`. It is async from top to bottom (`asyncpg` for PostgreSQL, async Redis client), so one process can serve many requests while it waits on the network.

## Three layers

Every feature follows the same path:

```
routers/  →  services/  →  repositories/ + db/orm_models.py
 (HTTP)      (logic, cache, TMDB)     (SQL)
```

- **Routers** only handle HTTP: read parameters, check auth, validate with Pydantic, return JSON. No SQL, no business rules.
- **Services** hold the logic: caching, calling TMDB, scoring recommendations.
- **Repositories / ORM** talk to the database.

Every router must be registered by hand at the bottom of `app/main.py` under `/api/v1/<name>`. A new router file does nothing until it is added there.

## Folder guide

| Folder | What lives there |
|---|---|
| `routers/` | 26 endpoint files — movies, tv, search, auth, ratings, watch, watchlist, recommendations, rec-feedback, ai-recs, news, trailers, tierlist, explore, pages, users, admin, internal, contact, notifications, and more |
| `services/` | Business logic. Big ones: `advanced_recs.py` (similar items), `recommendation_service.py` (For You feed), `feedback_service.py` (taste updates), `news_service.py`, `search_service.py`, `tmdb_service.py` |
| `services/dna/` | Content DNA engine for basket recommendations. Mostly pure functions |
| `ml/` | XGBRanker model (`ranker.py`), nightly training (`training.py`), saved model `ranker.json` + approval file `ranker_meta.json` |
| `db/` | Database engine (`database.py`), table models (`orm_models.py`), Redis helpers and all cache key builders (`cache.py`) |
| `tasks/` | Celery jobs: TMDB sync, retrain, episode check, trailers, news fetch, nightly chain |
| `data/` | Baked static data: tier-list templates, covers, franchise lists, explore taxonomy |
| `schemas/` | Pydantic request/response shapes |
| `utils/` | JWT, auth dependencies, password hashing, Supabase Storage upload, persistence thresholds |

## Rules the code follows

- **Config** comes only from `app/config.py` (`settings`). Never call `os.getenv()` elsewhere.
- **Auth** uses FastAPI dependencies: `get_current_user` (login required), `get_optional_user` (personalise if logged in), `require_admin` (re-checks the role in the database).
- **Route order matters.** In `movies.py`, fixed paths like `/trending` must be declared before `/{movie_id}`, or FastAPI treats "trending" as a movie id.
- **Slow work leaves the request.** Taste-profile updates, catalog ingestion and signal processing run in FastAPI `BackgroundTasks` after the response is sent. CPU-heavy work uses `asyncio.to_thread`.
- **Errors** are normalised by global handlers in `main.py` to `{error, message, status_code, code}`.
- **Responses** over 1 KB are gzip-compressed.

## Startup

`main.py`'s `lifespan` checks the database and Redis, then opens the port immediately. Heavier warm-up runs in the background afterwards:
- `CREATE TABLE IF NOT EXISTS` for `rating_needed`, `watching_tracker`, `temp_tracker`, `notifications` (these four are not managed by Alembic — change them in `main.py`).
- Build the recommendation graph and DNA index.
- Delete unpopular movies nobody references that are older than 30 days.
- Open one TLS connection to TMDB so the first user does not pay for it.
