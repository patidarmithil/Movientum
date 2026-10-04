# Developer Guide

Everything a new developer needs to start working on Movientum.

## 1. Run it locally

Backend (from `backend/`):
```bash
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Frontend (from `frontend/`):
```bash
npm install
npm run assets:webp
npm run dev
```

Copy `backend/.env.example` to `backend/.env` and fill the keys. The frontend needs `VITE_API_URL=http://localhost:8000`.

Optional background workers:
```bash
celery -A app.celery_app worker --loglevel=info
celery -A app.celery_app beat --loglevel=info
```

## 2. Find your way around

Read in this order:
1. `AI_Context/ARCHITECTURE.md` and `AI_Context/FILE_MAP.md` — where every file lives.
2. `AI_Context/ROUTES.md`, `SERVICES.md`, `DATABASE.md` — details.
3. `map.md` — generated index of files and exports.
4. This `documentation/` folder — the logic in plain words (start with `guidance.md`).

## 3. Rules the code follows

| Rule | Why |
|---|---|
| Routers do HTTP only; logic in services; SQL in repositories/ORM | Keeps layers testable and easy to find |
| Register new routers in `main.py` | They are not auto-discovered |
| Static routes before `/{id}` | FastAPI matches in order |
| Settings only through `app/config.py` | One source of truth |
| Cache keys only from `db/cache.py`; bump the version on shape changes | No collisions, no manual purges |
| Movies and TV: always use `(id, type)` | TMDB reuses ids |
| Changes to `rating_needed`, `watching_tracker`, `temp_tracker`, `notifications` go in `main.py` too | Created by raw SQL at startup |
| After changing `content_catalog` in bulk, call `invalidate_graph()` | The graph is an in-memory copy |
| News stays in Redis | Keep Supabase small |
| Frontend calls go through `services/*.js`, auth storage through `storage.js` | Central retry/failover/token logic |
| API failures fall back to empty data (`.catch(() => setData([]))`) | Pages never crash on a bad response |

## 4. Performance rules

- Free tiers only: no extra workers, bigger plans, keep-alive pings or recurring warm-up jobs.
- Get speed from code: caching, gzip, page bundles, `BackgroundTasks`, `asyncio.to_thread`, smaller payloads, lazy frontend sections.
- Speed work must not change recommendation results or order.
- Recommendation quality changes need a measured before/after and no added latency.

## 5. Verifying a change

There is no test suite. Use scripts, run from `backend/` with the venv active:

```bash
python debug/scratch_test_recs.py
python debug/scratch_perf_check.py --save before.json
```

- `backend/debug/scratch_*.py` — one-off probes (hit an endpoint, inspect a record, clear a cache key).
- `backend/debug/scratch_*_eval.py` — quality measurements (search, DNA, ranker).
- `backend/scripts/*.py` — operational scripts (see `data_fetching_scripts.md`).

Frontend: `npm run lint` and `npm run build`.

## 6. Error handling

- Backend: global handlers return `{error, message, status_code, code}`.
- Frontend: `api.js` retries on the backup server; if both are down, a non-blocking toast appears. `ErrorBoundary` catches render crashes.

## 7. Deploying

- Frontend: push → Vercel builds.
- Backend: build and push the Docker image (see `../infrastructure_and_ops/docker_setup.md`), then restart Azure/Render.
- Run `alembic upgrade head` against production when a migration was added.

## 8. Housekeeping

After adding or moving files, update `map.md` and `AI_Context/FILE_MAP.md` so the indexes stay trustworthy.
