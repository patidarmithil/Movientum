# Data and Maintenance Scripts

Scripts in `backend/scripts/` fill the database and handle operations. They skip FastAPI and talk to the database directly. Each script adds `backend/` to `sys.path` and loads `.env` itself, so run them from `backend/` with the venv active:

```bash
python scripts/seed_catalog.py
```

## Seeding (run once per new environment)

| Script | What it does |
|---|---|
| `seed_catalog.py` | Main loader. Pulls thousands of TMDB titles with credits and keywords into `content_catalog` (`is_seed = true`). Limits parallel requests to stay under TMDB rate limits |
| `seed_movies.py` | Fills the `movies` table with basic details for browsing |
| `seed_people.py` | Fills the `people` table used by cast/crew search |
| `ingest_search_index.py` | Rebuilds the full-text `search_vector` column (title weight A, overview weight B) |
| `append_india_catalog.py` | Adds Indian titles (from `fetch_india.csv`) to the catalog |
| `migrate_and_load.py` | Runs `alembic upgrade head`, then the seed scripts |

## Rating meter data

| Script | What it does |
|---|---|
| `load_movie_ratings_2026.py`, `load_tv_ratings.py`, `load_tv_ratings_2026.py` | Import external scores into `movie_ratings` / `tv_ratings` so the meter has data |
| `load_ratings.py` | Bulk-load user ratings (testing or backfill) |

## Operations

| Script | What it does |
|---|---|
| `create_admin.py` | Make a user an admin |
| `retag_news_snapshot.py` | Re-tag the live news snapshot with the current category rules, no API calls (`--dry-run` shows the diff) |
| `clear_category_cache.py` | Clear cached news category pages |
| `generate_dashboards.py` | Generate Grafana dashboard JSON from the metric list |
| `test_app_insights.py` | Send a test metric to App Insights |
| `check_settings.py`, `check_fks.py` | Sanity checks for config and foreign keys |
| `grafana_reader_role.sql` | Read-only database role for Grafana |

## Debug and evaluation scripts (`backend/debug/`)

| Group | Examples | Purpose |
|---|---|---|
| Probes | `scratch_test_recs.py`, `scratch_test_similar.py`, `scratch_inspect_movie.py` | Hit an endpoint or inspect a record |
| Cache | `scratch_clear_cache.py`, `scratch_redis_memory.py` | Clear keys, check Redis size |
| Performance | `scratch_perf_check.py`, `scratch_page_latency.py`, `scratch_similar_latency_probe.py` | Before/after timing; the perf check fails if recommendation order changes |
| Search quality | `scratch_search_eval.py`, `scratch_search_golden.py` | Hit@1/hit@3/MRR against labelled queries |
| DNA engine | `dna_offline.py`, `scratch_dna_eval.py`, `scratch_dna_sweep.py`, `scratch_dna_smoke.py` | Offline evaluation on a catalog snapshot |
| Ranker | `scratch_ranker_eval.py`, `scratch_ranker_labels.py` | Model vs composite, label checks |
| News | `scratch_news_snapshot.py`, `scratch_news_foryou.py`, `scratch_news_for_title.py`, `scratch_news_taxonomy.py` | Snapshot build, For You and category checks |
| Tier lists | `scratch_tier_templates.py`, `scratch_tier_characters.py` | Validate templates against TMDB, bake characters |

Model evaluation outside the app lives in `testing/` (`evaluate_model.py`, `check_db.py`).
