# Codebase Architecture Index
_Last updated: 2026-09-27T00:00:00_

## Directory Structure
* `/backend`: FastAPI Python server.
* `/backend/app/routers`: FastAPI route handlers (26 files, all registered in `main.py`).
* `/backend/app/services`: Business logic layer.
* `/backend/app/services/dna`: Content DNA basket-recommendation engine (pure idf/profile/retrieval/scoring + async graph_rwr/service).
* `/backend/app/ml`: XGBRanker wrapper, nightly training, `ranker.json` + `ranker_meta.json` approval file.
* `/backend/app/db`: ORM models and database/cache connections; `cache.py` holds every Redis key builder and TTL.
* `/backend/app/repositories`: Raw SQL for search, watchlists, tier lists.
* `/backend/app/tasks`: Celery jobs (sync, retrain, episodes, trailers, news daily fetch, nightly chain).
* `/backend/app/schemas`: Pydantic request/response schemas.
* `/backend/app/data`: Static seed data shipped with the code (tier-list templates/covers/counts/characters, explore taxonomy, franchises).
* `/backend/app/utils`: JWT, auth dependencies, password hashing, Supabase Storage, persistence thresholds, admin-task progress.
* `/backend/debug`: Scratch probes and offline evaluation harnesses (DNA, search, ranker, news, perf).
* `/backend/scripts`: Seed, import and operational scripts.
* `/backend/alembic/versions`: Migrations.
* `/frontend/src/pages`: Full page components (`analysis/`, `settings/` sub-sections).
* `/frontend/src/components`: Shared UI components (`tierlist/` board parts).
* `/frontend/src/services`: API call wrappers, one per backend router.
* `/frontend/src/hooks`: Shared hooks (scroll restore, session state, tier drag, feedback buffer, news dismiss).
* `/frontend/src/utils`: `api.js` HTTP client, `storage.js`, tier export/images/uploads, analytics, OTT links.
* `/frontend/src/context`: React context providers.
* `/documentation`: Plain-language project docs; entry point `guidance.md`.
* `/AI_Context`: File/route/service/DB/flow reference maps for agents.
* `/promo-video`: Standalone 60 s product showcase video (not imported by the app), built in Remotion around the owner's screen recording `public/video.mp4` (muted, trimmed at 52.6 s). `src/timeline.ts` — intro/footage/outro frame layout and the caption cues (seconds into the recording). `src/Promo.tsx` — composition: intro, footage in `BrowserFrame`, captions, outro, music bed, whoosh SFX at each cue. `src/components/` — `Background` (aurora glow), `BrowserFrame`, `Caption` (word-stagger, accent word), `Brand` (`Intro`/`Outro`). Audio licenses in `CREDITS.md`; render with `npm run render`.

## Root Documents
* `/README.md`: Project overview — features, stack, recommendation engine, personalization signals, key tables, caching, news, setup, env vars, structure, verification. Rewritten 2026-09-27 to match current code.
* `/documentation/movientum.tex`: IEEEtran design report (architecture + algorithms only, no setup/run/env/codebase-map content). Rewritten 2026-09-27 to the shipped system: gated composite/XGBRanker ranking, For You buckets + MMR, feedback labels/suppression, Content DNA (IDF), LLM recs, snapshot news, tier lists, page bundles, zero-budget performance rules. `movientum.pdf` is the user's own compile, not regenerated here.
* `/documentation/guidance.md`: Reading guide for `documentation/` — which file answers which question, reading order, question → doc lookup.
* `/documentation/architecture/*.md`: system, backend, frontend, database, configuration, deployment/servers, scalability, storage estimation.
* `/documentation/features/*.md`: authentication, ratings, search + explore, watchlists, news, tier lists (new), trailers/notifications/contact/admin/analysis (new, `trailers_notifications_admin.md`).
* `/documentation/ml_and_recommendations/*.md`: engine overview, feedback loop (new, `feedback_loop.md`), Content DNA, nightly retraining (`mlflow_tracking.md` — name historical, no MLflow).
* `/documentation/infrastructure_and_ops/*.md`: Redis caching, Docker + Celery schedule, monitoring (App Insights/Grafana).
* `/documentation/workflows_and_integration/*.md`: user workflows, system integration, developer guide (`final_development_workflow.md`), data/debug scripts.
* `/documentation/misc_and_ui/*.md`: website/route overview, API endpoint list.
* `/update.md`: Execution-ready upgrade plan (loader poster slideshow, Google Sign-In, news system v2). Task-by-task spec intended to be handed to an implementing model one task at a time.
* `/plans/recommendations_update.md`: Parked (implemented, measured, then reverted 2026-09-23) rec-quality change set — exclude all watched/rated titles from feed and similar, rating-aware feed seeds (skip/timepass never seed, perfection/go_for_it boosted), guest geo rail ordered by Bayesian quality instead of shuffled. Holds exact code, cache-key bumps, the eval probe design and measured results, so it can be re-applied.
* `/plans/rec.md`: Reference explainer for the recommendation system as shipped — the "For You" feed (`GET /api/v1/recommendations`, used by both the Home row and `/recommendations`) and "More Like This" (`GET /api/v1/recommendations/similar/{id}`, used by `/movies/:id` and `/tv/:id`). Covers the NetworkX graph, RWR/personalized PageRank, the 16-feature matrix and XGBRanker ranking, the diversified-seed and 70/30 team-draft blends, language-diversity injection, taste-profile updates and time decay, cache TTLs, and the nightly retrain.
* `/audit/`: One markdown file per context compaction (`compact_<YYYY-MM-DD_HHmm>.md`), each a self-contained record of that session segment — requests, files touched, decisions and reasoning, defects found, state at compaction. Required by the working agreement in `CLAUDE.md`.

## File Definitions

### `/backend/app/celery_app.py`
* **Purpose**: Movientum — Celery Application. Task duration/status metrics are read through the `app.telemetry` module at call time (importing the names bound the `None` they hold before `init_telemetry()`, so task metrics were never recorded).
* **Exports**: `task_prerun_handler()`, `task_postrun_handler()`, `task_failure_handler()`

### `/backend/app/config.py`
* **Purpose**: Movientum — Configuration System
* **Exports**: `Settings`, `get_settings()`

### `/backend/app/main.py`
* **Purpose**: Movientum — FastAPI Application Entry Point. `lifespan` runs only the DB/Redis connection checks before `yield` (uvicorn does not open the port until then, which is what an Azure cold start waits on); `_startup_warm()` — the raw-DDL table checks (`_ensure_dynamic_tables()`) then the graph + DNA warm-up from a single `content_catalog` read (`_warm_recommendation_indexes()`) — runs as a background task after the port opens, alongside the old-movie cleanup and TMDB connection warm-up. `_spawn()` keeps strong refs to those tasks.
* **Exports**: `check_config()`, `test_telemetry()`

### `/backend/app/telemetry.py`
* **Purpose**: Azure Monitor OpenTelemetry setup + metric instruments. `init_telemetry()` is idempotent per process (`_TELEMETRY_STATE`): `main.py` and `celery_app.py` both call it and the web process imports both, which configured Azure Monitor twice (duplicate exporters and startup cost).
* **Exports**: `set_graph_node_count()`, `set_graph_edge_count()`, `set_retrain_rows()`, `set_retrain_best_iter()`, `set_model_version()`, `**Utilities**`

### `/backend/app/db/cache.py`
* **Purpose**: Movientum — Redis Cache (Upstash)
* **Exports**: `key_movie_detail()`, `key_tv_detail()`, `key_movie_trending()`, `key_movie_list()`, `key_genre_list()`, `invalidate_moctale_caches()` (+ `MOCTALE_CACHE_PATTERNS`), `set_cached_keep_ttl()` (SET KEEPTTL), `**Utilities**`

### `/backend/app/db/database.py`
* **Purpose**: Movientum — Async Database Connection (SQLAlchemy + Supabase)
* **Exports**: `engine`, `AsyncSessionLocal`, `get_db()`, `check_db_connection()`, `prewarm_pool()`

### `/backend/app/db/orm_models.py`
* **Purpose**: Movientum — SQLAlchemy ORM Models
* **Exports**: `utcnow()`, `Base`, `Genre`, `Movie`, `MovieGenre`, `**Utilities**`

### `/backend/app/ml/ranker.py`
* **Purpose**: Movientum — XGBRanker Wrapper (Phase 3). The cold-start path (no `ranker.json`, or a failing `predict()`) no longer ranks by the raw PPR proxy alone — `_cold_start_scores()` combines graph rank (0.45), rating × vote-confidence (0.30) and the normalised taste columns (0.25), so an untrained install still surfaces good, on-taste titles first. A saved model is used only when `ranker_meta.json` has `approved: true` (written by `training.py`); the ranker.json shipped until Sept 2026 had no approval (2 users of data, `best_iteration=0`, one flat score for guests, which `argsort()[::-1]` turned into the least-similar end of the walk) and is ignored. An approved model is rank-blended 50/50 with the composite (`blend_scores`, `MODEL_BLEND_WEIGHT`) because training snapshots carry placeholder PPR values; `order_by_score` keeps walk order on ties.
* **Exports**: `load_ranker()`, `reload_ranker()`, `is_model_trained()`, `rank_candidates()`, `blend_scores()`, `order_by_score()`, `MODEL_PATH`, `META_PATH`

### `/backend/app/ml/training.py`
* **Purpose**: Movientum — Nightly XGBRanker Retraining Pipeline (Phase 7). Skips the fit below `_MIN_USERS_FOR_APPROVAL` (5) users. After fitting, `evaluate_against_composite()` compares held-out NDCG@10 of the live blended order vs the composite; the model and `ranker_meta.json` are written only if it has ≥ 5 users, ≥ 200 rows, ≥ 2 validation users with varied labels, and beats the composite by `_APPROVAL_MARGIN` (0.01). Otherwise the live ranking is left as it was.
* **Exports**: `build_training_data()`, `run_nightly_retrain()`, `evaluate_against_composite()`, `FEATURE_COLUMNS`

### `/backend/app/repositories/search_repo.py`
* **Purpose**: Candidate retrieval for search, one round trip each. Titles: pg_trgm (`%`, `<%`, prefix `LIKE`) on the stored `title_search` column over `content_catalog` (22K titles) UNION `movies` (plus overview FTS). People: same operators over the `people` table. Queries under 3 chars use prefix-only statements. `upsert_people` never blanks stored photo/department/known-for.
* **Exports**: `search_titles()`, `search_people()`, `person_row_from_tmdb()`, `upsert_people()`, `MIN_TRIGRAM_QUERY_LEN`

### `/backend/app/data/tier_templates.py`
* **Purpose**: Tier-list template catalogue — 515 declarative pointers at slices of TMDB across 16 categories (franchises, superheroes, sci-fi, animation, directors, actors, studios, television, characters, rank the seasons, anime, genres, decades, Indian cinema, world cinema, your library).
* **Exports**: `CATEGORIES`, `TEMPLATES`
* **Notes**: Ten source kinds — `collection`, `discover`, `person_credits`, `tv_cast`, `movie_cast`, `tv_season` (one season's episodes), `tv_seasons` (a show's seasons as the tiles), `ids`, `builtin`, `library`. Every `discover` source carries a `vote_count.gte` floor, which is what keeps shorts and studio test reels off the boards. Verify any edit with `debug/scratch_tier_templates.py`.

### `/backend/app/data/tier_covers.py`
* **Purpose**: GENERATED — cover posters per template slug, so the browse page costs no TMDB call.
* **Exports**: `COVERS`
* **Notes**: Regenerate with `python debug/scratch_tier_templates.py --write-covers`.

### `/backend/app/data/tier_counts.py`
* **Purpose**: GENERATED — how many items each template actually resolves to, so a browse card shows a real number instead of the seed's `limit` cap.
* **Exports**: `COUNTS`
* **Notes**: Regenerate with `python debug/scratch_tier_templates.py --write-covers`, which writes covers and counts in the same pass.

### `/backend/app/data/tier_characters.py`
* **Purpose**: GENERATED — character art for animated `tv_cast` templates (anime via AniList, The Simpsons / Rick and Morty via Fandom), because TMDB only has voice-actor headshots. `tier_template_service.get_template_items` serves a listed slug straight from here, before Redis and TMDB. Items use `media: "character"` and absolute image URLs.
* **Exports**: `CHARACTERS`
* **Notes**: Regenerate with `python debug/scratch_tier_characters.py --write` (also refreshes those slugs' covers and counts).

### `/backend/app/data/explore_taxonomy.py`
* **Purpose**: Explore facet slug -> TMDB discover filters: GENRES (split movie/TV ids), CATEGORIES (genres and/or keyword *names*), LANGUAGES, FAMILY (US cert ceilings), AWARD_KEYWORDS, DURATIONS. Keyword names are resolved to ids at request time by `explore_service`. Audit with `python debug/scratch_explore_taxonomy.py`.

### `/backend/app/data/explore_franchises.py`
* **Purpose**: `FRANCHISE_ORDER` — hand-ranked tier-template slugs for the franchise hub (83 `franchises` + universe/box-set templates from superheroes, sci-fi, animation), plus `DISPLAY_TITLES`.

### `/backend/app/data/tier_backdrops.py`
* **Purpose**: GENERATED — 16:9 backdrop per franchise-hub slug. Regenerate with `python debug/scratch_tier_templates.py --write-backdrops`.

### `/backend/app/services/explore_service.py`
* **Purpose**: `build_discover_plan` turns explore filters into per-media TMDB discover params (a None side is skipped); `resolve_keyword` maps keyword names to ids (process memo -> Redis `explore:kw:v1:*` 30 d -> `/search/keyword`); `is_anime_row` for the hide-anime cut.

### `/backend/app/routers/explore.py`
* **Purpose**: `GET /api/v1/explore/franchises` — ranked franchise hub from memory (no I/O).

### `/backend/debug/scratch_search_eval.py`
* **Purpose**: Search quality + latency, old vs new. Labelled content (exact/prefix/typo/accent/punctuation/word-order/TV) and cast/crew query sets; reports hit@1, hit@3, MRR@5, p50/p95 latency and TMDB usage per group, then EXPLAINs the new SQL to confirm the trigram indexes are used. `--verbose`, `--skip-old`, `--runs N`.

### `/backend/debug/scratch_search_profile.py`
* **Purpose**: Per-query stage timing for search: DB round-trip floor, SQL, Python rank, whether TMDB fallback fired and its cost, end-to-end. `--queries "a,b"`, `--runs N`, `--person`.

### `/backend/alembic/versions/20260927_1800_e1b7c3d95a24_search_norm_columns.py`
* **Purpose**: Stored generated columns `content_catalog.title_search`, `movies.title_search`, `people.name_search` (= `f_search_norm(...)`) with GIN trigram indexes, replacing the expression indexes — removes ~50 ms of per-row unaccent work on short queries. Columns are not in the ORM on purpose (Postgres fills them).

### `/backend/alembic/versions/20261004_1200_f2c6a8d41b37_user_rec_settings.py`
* **Purpose**: Adds `users.language_shares` (JSONB, explicit per-language feed shares; NULL = auto), `users.rewatch_share` (share of each 20 picks allowed to be watched titles), `users.last_import_at` / `last_import_count` (bulk-import settle window).

### `/backend/debug/scratch_rec_tuning.py`
* **Purpose**: Probe for the Oct 2026 rec tuning: user rec settings, page-1 language split vs saved shares, watched-per-20 vs rewatch cap, page-1 overlap across a forced window change (impression memory), `--similar ID[:mt]` watched-in-top-20 check, `--cold USER` cold-start check.

### `/backend/scripts/seed_people.py`
* **Purpose**: One-off seed of the `people` table: `/person/popular` pages (default 500 ≈ 10K people), optional `--from-export` (TMDB daily person_ids export filtered to catalog-credited people or `--min-popularity`), optional `--max-details N` photo/department backfill. Calls TMDB with httpx directly (no Redis writes). Idempotent.

### `/backend/alembic/versions/20260927_1200_d8f2a4c61e90_add_search_indexes_and_people.py`
* **Purpose**: `unaccent` + IMMUTABLE `public.f_search_norm(text)`; GIN trigram indexes on `f_search_norm(title)` for `movies` and `content_catalog`; `people` table + name trigram index.

### `/backend/debug/scratch_explore_taxonomy.py`
* **Purpose**: Probe — prints keyword-name resolution (`--keywords`) and per-facet discover result counts; flags empty facets.

### `/backend/app/services/tier_template_service.py`
* **Purpose**: Resolves a tier-list template to a flat list of rankable items; cache-aside on `tier:tpl:v1:{slug}` with a 7-day TTL and an inflight lock.
* **Exports**: `list_catalogue()`, `get_template()`, `get_template_items()`
* **Notes**: `list_catalogue()` does no I/O at all. Library templates are per-user and bypass the shared cache.

### `/backend/app/repositories/tier_list_repo.py`
* **Purpose**: Async queries for saved tier-list boards; raises the HTTP errors itself, as `watchlist_repo` does.
* **Exports**: `list_for_user()`, `get_or_404()`, `get_public()`, `create()`, `update()`, `delete()`

### `/backend/app/routers/tierlist.py`
* **Purpose**: GET `/templates`, `/templates/{slug}`, `/mine`, `/share/{share_id}`, `/characters/{media}/{tmdb_id}`; POST `/`; GET/PUT/DELETE `/{list_id}`. Registered at `/api/v1/tierlist`.
* **Notes**: Static paths are declared before `/{list_id}`, which would otherwise swallow them. `/characters/...` is public and backs the picker's "Characters" tab; a live fetch is **not** cached — `_warm_characters` writes `tier:chars:v1:{media}:{tmdb_id}` for 7 days in a `BackgroundTasks` job after a board carrying that title is saved, re-fetching server-side rather than trusting the client's items.

### `/backend/app/schemas/tierlist.py`
* **Purpose**: Tier-list request/response shapes, with the payload caps (12 rows, 300 items, hex-only colours) that guard the JSONB columns. `TierListSave.character_sources` (max 5, `"tv:95557"`) carries the titles a board's characters came from.
* **Exports**: `TierListSave`, `TierListOut`, `TierListSummary`, `TierListsResponse`, `TierTemplateOut`, `TierCatalogueResponse`, `ShowCharactersOut`

### `/backend/app/services/character_service.py`
* **Purpose**: Picks the character source for a catalogue title and returns `{source, media, tmdb_id, title, items}` — AniList for Japanese animation, Fandom for other animation, TMDB cast otherwise (genre 16 + `original_language` decide). A source that comes back empty falls through to the TMDB cast.
* **Exports**: `get_characters()`

### `/backend/app/services/fandom_service.py`
* **Purpose**: Characters from a show's Fandom wiki. `resolve_wiki()` probes candidate subdomains against `meta=siteinfo` and requires the site name to share a word with the title (`WIKI_OVERRIDES` pins the rest); `get_characters()` reads the main-cast category first, then `Category:Characters`, then its sub-categories when the parent holds only sub-categories (Family Guy). Ids are `crc32("wiki:name")`, matching the bake script.
* **Notes**: Images are `static.wikia.nocookie.net` URLs, which send `access-control-allow-origin: *`, so the PNG export can draw them.
* **Exports**: `resolve_wiki()`, `get_characters()`, `aclose()`, `FandomError`

### `/backend/app/services/anilist_service.py`
* **Purpose**: Live AniList GraphQL client for the tier list character picker — `search_anime()` (popularity-ordered, TV/TV_SHORT/ONA/MOVIE) and `get_characters()` (root media only, 2 pages, MAIN before SUPPORTING, `/default.jpg` placeholders dropped). Items match the baked shape in `app/data/tier_characters.py`.
* **Notes**: No sequel walk and no throttling sleep — both belong to the offline bake script, not a request. 429/timeout raise `AniListError`, which the router turns into a 503; an unknown id comes back as `None` and becomes a 404. Writes nothing to Redis itself.
* **Exports**: `search_anime()`, `get_characters()`, `aclose()`, `AniListError`

### `/backend/debug/scratch_dashboard_history.py`
* **Purpose**: Read-only probe for an empty dashboard Watched tab. Prints the item counts in the user's `user:history` key and in the cached dashboard bundle, then runs the history loader against the DB directly and prints any exception. Usage: `python debug/scratch_dashboard_history.py <email>`.

### `/backend/debug/scratch_ranker_eval.py`
* **Purpose**: Read-only probe comparing the saved XGBRanker (old live order) against the current `rank_candidates()` — NDCG/pairwise on logged `interaction_log` snapshots, and top-20 distinct scores / graph proximity / rating / votes on live candidate sets for 10 popular seeds.

### `/backend/debug/scratch_seen_cap_eval.py`
* **Purpose**: Probe for the For You already-seen cap (`FEED_MAX_SEEN_PER_PAGE` in `routers/recommendations.py`). Always runs a synthetic check of `_cap_seen_per_page`; with `<user_id>` it counts rated/watched titles per 20-item page in the user's cached block-0 feed pool and prints PASS/FAIL.

### `/backend/debug/scratch_repair_capped_weights.py`
* **Purpose**: One-off repair for taste profiles flattened by the removed ±100 weight cap. Dry run lists profiles with weights pinned at exactly ±100; `--apply` (optionally `--user <uuid>`) rebuilds each from watch history + watchlist, then replays `interaction_log` thumbs_up/thumbs_down/click through the now-uncapped `apply_feedback`. Overwrites manual /analysis slider edits.

### `/backend/debug/scratch_show_characters.py`
* **Purpose**: Dry run of the live character path — prints which source answered, the matched title and the first items, so a wrong AniList match or wiki slug is visible before it reaches a board. `python debug/scratch_show_characters.py [media tmdb_id]` from `backend/`; with no arguments it probes one title per source.

### `/backend/debug/scratch_perf_check.py`
* **Purpose**: Before/after latency harness for the page-load endpoints (`/pages/home`, `/pages/movie`, `/pages/tv`, `/pages/person`, `/pages/dashboard`, `/search`, `/recommendations`, `/recommendations/similar`). Records cold and warm timings and, for the two recommendation endpoints, the ordered id list. `--save before.json` then `--save after.json --compare before.json` prints the timing delta and fails (exit 1) if the recommendation ordering changed — the regression gate for any latency work that touches those paths.
* **Notes**: Needs a running server (`uvicorn app.main:app --port 8000`). User-scoped endpoints are skipped unless `--token` (or `PERF_ACCESS_TOKEN`) is supplied.

### `/backend/debug/scratch_news_probe.py`
* **Purpose**: One request per news provider (3 calls) to confirm free-plan page-size limits and response shapes. Never wired into the app.

### `/backend/debug/scratch_news_snapshot.py`
* **Purpose**: Phase 3 acceptance check for the news snapshot store. Default run builds synthetic snapshots in an isolated `news:v3test:*` namespace (no API calls) and verifies stored count, `NewsFeedOut` validation, one-generation-left cleanup, no empty reads during a swap, the build lock, and memory. `--live` fetches (~36 requests) and builds the real `news:v3:*` snapshot; `--purge-v2` then deletes legacy `news:v2:*` article data.

### `/backend/debug/scratch_news_foryou.py`
* **Purpose**: Phase 4 acceptance check for For-You ranking. Default run: pure scorer checks (different profiles differ, all-zero profile, seen penalty, lazy-heap diversity == brute force, 500-candidate timing) plus a synthetic snapshot in `news:v3test:*` with a stubbed taste loader (guest fallback, page continuity). `--live` copies the live snapshot (no fetch, zero API calls), resolves facets from `content_catalog`, and ranks it for the two users with the most interactions.

### `/backend/debug/scratch_news_taxonomy.py`
* **Purpose**: Pure acceptance check for `news_taxonomy.classify_article` over hand-labelled real headlines (including linked-title language evidence); prints tags and evidence scores, exits non-zero on failure.

### `/backend/debug/scratch_news_nlp.py`
* **Purpose**: Read-only inspection of the `news_nlp` refiner on the live snapshot: per-category seed counts, rule vs refined totals, top learned TF-IDF terms, and still-untagged headlines for phrase mining. `--untagged N` sets the sample size.

### `/backend/scripts/retag_news_snapshot.py`
* **Purpose**: Rebuilds the live news snapshot from its own stored articles (zero news-API calls) so category tags, entity links and taste facets use the current taxonomy. `--dry-run` prints old / rules / rules+NLP tag counts, untagged counts and a sample of articles the NLP refiner changed.

### `/backend/debug/scratch_news_fetch.py`
* **Purpose**: Phase 2 check for `news_fetch_service`. `--offline` runs normalize/dedup/dead-key/partial-outage checks with mocked HTTP (zero API calls); without the flag it also runs `run_daily_fetch()` live (~36 requests) and prints counts, timing and samples.

### `/backend/debug/scratch_tier_templates.py`
* **Purpose**: Resolves every template against live TMDB and reports empty or thin results; `--write-covers` regenerates `app/data/tier_covers.py` and `app/data/tier_counts.py`. The gate on any seed edit.

### `/backend/debug/scratch_tier_characters.py`
* **Purpose**: Bakes character art into `app/data/tier_characters.py`. AniList title search (pin wrong matches in `ANILIST_OVERRIDES`) plus sequel-chain walk for anime; Fandom `pageimages` for the slugs in `FANDOM`. Dry run by default; `--write` writes data, covers and counts.

### `/backend/debug/scratch_bust_tier_cache.py`
* **Purpose**: Drops cached template item sets so a seed change takes effect before the 7-day TTL expires.

### `/backend/debug/scratch_pagerank_equivalence.py`
* **Purpose**: Proves `advanced_recs._pagerank_cached` returns bit-identical scores and top-100 rankings to `nx.pagerank` on the real catalog graph, including after a graph splice; prints per-seed timings and matrix memory.

### `/backend/debug/scratch_similar_latency_probe.py`
* **Purpose**: Times the similar-items pipeline. `local` mode: graph build, PPR matrix build, seed row, ML pool, baseline pool, sequential vs `asyncio.gather`. `http` mode: deployed `/pages/{mt}/{id}` and `/recommendations/similar/{id}` cold/warm, and both fired concurrently.

### `/backend/debug/scratch_redis_memory.py`
* **Purpose**: Read-only Upstash audit: memory / eviction counters from INFO, then per key-prefix counts, sampled payload size, estimated total and median remaining TTL — shows whether 7-day caches actually live their week and which prefixes eat the free-tier memory.

### `/backend/app/repositories/watchlist_repo.py`
* **Purpose**: Movientum — Watchlist Repository
* **Exports**: none

### `/backend/app/routers/auth.py`
* **Purpose**: Movientum — Auth Router (Phase 3.1)
* **Exports**: none

### `/backend/app/routers/clicks.py`
* **Purpose**: Main functionality for clicks.py.
* **Exports**: `ClickRequest`

### `/backend/app/routers/feedback.py`
* **Purpose**: Main functionality for feedback.py.
* **Exports**: none

### `/backend/app/routers/internal.py`
* **Purpose**: `require_admin`-gated endpoints. `POST/GET /trigger/{task_key}` is the live admin manual-trigger path (runs coroutines in-process via FastAPI `BackgroundTasks`, no Celery) — used by `AdminDashboard.jsx`'s Manual Triggers list. Task keys: `TASK_COROS` (`sync_movies`, `check_episodes`, `retrain_ranker`, `refresh_trailers`, `build_title_index`, `expire_trailers`) + `news_daily_fetch` (409 guard) + `nightly_job`, which runs `NIGHTLY_STEPS` in order (expire trailers → sync → retrain → title index → episodes → refresh trailers; News Daily Fetch excluded), continuing past a failed step and returning `{steps, failed}`. `admin.py`'s Celery `ADMIN_TASKS`/`AdminPage.jsx` is a separate, unrouted/dead duplicate — don't wire new tasks there.
* **Exports**: `NIGHTLY_STEPS`, `TASK_COROS`, `run_task_safely()`, `trigger_task()`

### `/backend/app/routers/movies.py`
* **Purpose**: Movientum — Movies Router (Phase 2B)
* **Exports**: `utcnow()`

### `/backend/app/routers/news.py`
* **Purpose**: Movientum — News Router. Unified `GET /feed?tab=&category=`, `/categories`, `/search`, `/saved`, `/status`, `/for-title/{media_type}/{tmdb_id}`, `/article/{id}` (+ view/save). Zero SQL — delegates to `news_service`. Reads the current `news:v3` snapshot through `news_service`; `tab=for-you` (optional auth + DB session) calls `news_service.get_for_you_feed`, which ranks against `user_taste_profiles` or falls back to latest with `personalized: false`. `/status` returns `last_fetched` (= snapshot `built_at`) plus additive `built_at`/`generation`/`per_source`/`raw`/`deduped`.
* **Exports**: none

### `/backend/app/routers/notifications.py`
* **Purpose**: Main functionality for notifications.py.
* **Exports**: `NotificationResponse`

### `/backend/app/routers/pages.py`
* **Purpose**: Movientum — Page Bundle Router. One endpoint per rendered page (`/home`, `/movie/{id}`, `/tv/{id}`, `/person/{id}`, `/dashboard`), each served from a single Redis key. A bundle is a composition cache over the per-section caches: hit = 1 GET, miss = 1 MGET + only the missing sections recomputed + 1 SET. The home bundle re-reads `moctale_rating` for its rails from the DB every 5 min (`_refresh_moctale`, stamped `_moctale_at`, written back with KEEPTTL) because the community meter is also written outside the app.
* **Exports**: none

### `/backend/app/routers/person.py`
* **Purpose**: Movientum — Person Router (Person Page Credits System Redesign). `GET /{id}` also writes the fetched person into `people` (fire-and-forget) for cast/crew search.
* **Exports**: none

### `/backend/app/routers/ratings.py`
* **Purpose**: Movientum — Ratings Router (Phase 3.3)
* **Exports**: none

### `/backend/app/routers/recommendations.py`
* **Purpose**: Movientum — Recommendations Router (Phase 5: Ensemble Blending). Both endpoints now order results with a composite score from `services/ranking_utils.py` instead of leaving them in shuffled interleave order. Feed (`GET /`): rebuilt once per 15-minute rotation window (`RECS_WINDOW_SECONDS`, stored inside the cached value rather than in the key so `keys_recs_pool_all` still enumerates), ML pools pass a relaxing quality floor, then the blended 100 are sorted by 0.28 pool-rank + 0.26 quality + 0.36 taste + 0.10 novelty, multiplied by a recent-decade era boost, and finally passed through `ranking_utils.mmr_diversify` so the top of the feed is not one genre repeated; the fresh-discovery pool is bounded above at 20 000 votes as well as below at 150, so it returns well-regarded titles the user has not already seen everywhere. Similar (`GET /similar/{id}`): sorted by 0.40 similarity + 0.30 quality + 0.20 taste + 0.10 recency, baseline-sourced items discounted 0.85 so the 70/30 intent survives; for an anime seed the weighting switches to 0.26 similarity + 0.18 quality + 0.14 taste + 0.36 `anime_affinity` + 0.06 recency, with non-anime candidates multiplied by 0.55. Cache key comes from `cache.key_recs_similar` (v7), the same builder `routers/pages.py` reads with.
* **Exports**: none

### `/backend/app/routers/recommendation_signals.py`
* **Purpose**: Movientum — Recommendation Feedback Router (`/api/v1/rec-feedback`). The single write endpoint for every thumbs-up / thumbs-down / click / undo signal, from every surface that shows platform-generated recommendations. `POST /` takes one signal, `POST /batch` up to 20 (the client's flushed click queue). Both hand off to `feedback_signal_worker.process_signals_in_background` via FastAPI `BackgroundTasks` and return immediately — the catalogue lookup (which may mean a live TMDB ingest), the taste-profile read-modify-write under a row lock, suppression and the Redis fan-out all happen after the response.
* **Exports**: none

### `/backend/app/routers/requests.py`
* **Purpose**: Main functionality for requests.py.
* **Exports**: `RequestContentPayload`

### `/backend/app/routers/search.py`
* **Purpose**: Movientum — Search Router. `/instant`, `/autocomplete` and `GET /search` all rank through `search_service.rank_titles` / `rank_people`; the results page fetches TMDB concurrently (6 s timeout), person page ≥2 comes from TMDB paging. Genre-only browse unchanged. Still exports `_movie_to_search_result` / `_tmdb_to_search_result` (used by recommendation code).
* **Exports**: none

### `/backend/app/routers/temp_tracker.py`
* **Purpose**: Main functionality for temp_tracker.py.
* **Exports**: `TempTrackRequest`

### `/backend/app/routers/trailers.py`
* **Purpose**: Feature 4 — GET `/home` reads the precomputed Redis trailer index (ZREVRANGE + HMGET), merges followed-show personalization, interleaves movie/tv. Zero TMDB calls on a warm index; cold index returns `{data:[], warming:true}` and queues a background refresh.
* **Exports**: none

### `/backend/app/routers/tv.py`
* **Purpose**: Movientum — TV Shows Router (Improvement 1.7)
* **Exports**: `utcnow()`

### `/backend/app/routers/users.py`
* **Purpose**: User profile and Analysis-page endpoints. `GET /me/analysis` (behavioural aggregates, cached `key_user_analysis` 10 min), `GET /me/analysis/engine` (live engine snapshot, `key_user_engine` 10 min), `GET /me/analysis/feedback?days=30|90` (signal timeline, `key_user_feedback` 2 min) — all via `_cached_analysis` (cache-aside + `inflight_lock`). Taste-profile PATCH (weights clamped to ±100), date-range POST and rec-preferences PATCH call `bust_user_feedback_caches(drop_pools=True)` so edits reach the feed. The old `/me/analysis/rec-explanation` endpoint was removed.
* **Exports**: none

### `/backend/app/routers/watch.py`
* **Purpose**: Movientum — Watch Router (Phase 3.3)
* **Exports**: none

### `/backend/app/routers/watching_tracker.py`
* **Purpose**: Main functionality for watching_tracker.py.
* **Exports**: `TrackRequest`, `UntrackRequest`

### `/backend/app/routers/watchlist.py`
* **Purpose**: Movientum — Watchlist Collections Router
* **Exports**: none

### `/backend/app/schemas/feedback.py`
* **Purpose**: Main functionality for feedback.py.
* **Exports**: `FeedbackBase`, `FeedbackCreate`, `FeedbackResponse`

### `/backend/app/schemas/movie.py`
* **Purpose**: Movientum — Movie Schemas (Pydantic)
* **Exports**: `MovieListItem`, `DirectorDetail`, `MovieDetail`, `MovieListResponse`, `TrendingResponse`

### `/backend/app/schemas/news.py`
* **Purpose**: Movientum — News Schemas (Pydantic v2). Frozen article/feed contract; `NewsStatusOut` gained optional snapshot fields in Phase 3.
* **Exports**: `LinkedItemOut`, `NewsArticleOut`, `NewsFeedOut`, `NewsCategoryOut`, `NewsStatusOut`, `NewsSaveActionOut`

### `/backend/app/schemas/rating.py`
* **Purpose**: Movientum — Rating Schemas (Phase 3.3)
* **Exports**: `RatingCategory`, `RatingCreateRequest`, `RatingUpdateRequest`, `RatingResponse`, `DistributionResponse`, `**Utilities**`

### `/backend/app/schemas/recommendations.py`
* **Purpose**: Main functionality for recommendations.py. `DnaFilters` (Phase 3 §3.1) carries media_type/genres/languages/countries/studios/year_from/year_to/min_rating/sort; `ContentBasketRequest` adds `filters`, `negative_items` (§3.3), `ignore_taste` (§3.2).
* **Exports**: `ContentBasketItem`, `DnaFilters`, `ContentBasketRequest`

### `/backend/app/schemas/recommendation_feedback.py`
* **Purpose**: Movientum — Recommendation Feedback Schemas (Phase 6)
* **Exports**: `RecFeedbackRequest`, `RecFeedbackResponse`

### `/backend/app/schemas/search.py`
* **Purpose**: Movientum — Search Schemas (Phase 3.2)
* **Exports**: `SearchResult`, `SearchResponse`, `AutocompleteItem`, `AutocompleteResponse`, `WrappedSearchResponse`, `**Utilities**`

### `/backend/app/schemas/trailer.py`
* **Purpose**: Main functionality for trailer.py.
* **Exports**: `TrailerItem`, `TrailerListResponse`

### `/backend/app/schemas/user.py`
* **Purpose**: Movientum — User Schemas (Phase 3.1)
* **Exports**: `UserRegisterRequest`, `UserLoginRequest`, `UserResetPasswordRequest`, `UserPasswordUpdateRequest`, `UserDeleteRequest`, `**Utilities**`

### `/backend/app/schemas/watch.py`
* **Purpose**: Movientum — Watch Schemas (Phase 3.3)
* **Exports**: `WatchMarkRequest`, `WatchHistoryItem`, `WatchHistoryResponse`, `WatchlistAddRequest`, `WatchlistItem`, `**Utilities**`

### `/backend/app/schemas/watchlist.py`
* **Purpose**: Movientum — Watchlist Collection Schemas
* **Exports**: `CollectionCreate`, `CollectionUpdate`, `AddItemRequest`, `CollectionMovieOut`, `CollectionItemOut`, `**Utilities**`

### `/backend/app/services/advanced_recs.py`
* **Purpose**: Movientum — Similar Items Service (Upgraded 11-step pipeline). `_compute_score()` now uses `ranking_utils.bayesian_rating` and a saturated popularity term, so the stated 0.50/0.25/0.15/0.10 weights actually apply (the unbounded `log1p(popularity)` term previously made this close to a popularity sort). `_catalog_to_dict()` also carries `keyword_ids`/`cast_ids`/`crew_ids`/`studio_ids`/`origin_countries` for taste and anime scoring — stripped again before caching. `build_feature_matrix()` derives `recency` from the current year instead of a hardcoded 2026. A title ingested on demand is now spliced into the live graph (`graph_cache.add_row_to_graph`) before the walk, so More Like This works on a title nobody has opened before instead of returning an empty ML pool; if the walk still finds fewer than `MIN_RWR_CANDIDATES` (12) neighbours, `get_facet_fallback_candidates()` answers from `content_catalog` directly (one GIN-indexed query on `genre_ids`/`cast_ids`, ranked in memory by `_FACET_WEIGHTS` overlap). Anime seeds take a wider walk (`ANIME_WALK_WIDTH` 220), are gated to anime-only candidates (topped up from the catalog below `ANIME_MIN_POOL` 30) and are re-ranked 0.35 ranker + 0.45 `anime_utils.anime_affinity` + 0.20 anime-scale Bayesian quality. `catalog_row_to_cache_dict()` is shared with `tmdb_service.ingest_item_to_catalog`, which overwrites the negative catalog-cache marker a preceding miss wrote.
* **Exports**: `passes_intensity_filter()`, `get_rwr_candidates()`, `build_feature_matrix()`, `get_facet_fallback_candidates()`, `catalog_row_to_cache_dict()`

### `/backend/app/services/analysis_service.py`
* **Purpose**: Behavioural aggregates for /analysis: genre distribution, rating profile, UTC weekday×hour heatmap (`time_pattern`), `monthly_activity` (12 months), taste evolution, click-vs-watch gap, rewatch/early favourites/hidden gems (with `media_type`), binge pattern, taste drift, feedback loop. `get_rec_explanation` was deleted (it described a 60/40 blend that no longer exists) — see `analysis_engine_service.py`.
* **Exports**: `get_user_analysis()`

### `/backend/app/services/analysis_engine_service.py`
* **Purpose**: Read-only views over the live recommendation engine for /analysis. `get_engine_snapshot()` reports the real feed constants (`ranking_utils.FEED_POOL_WEIGHTS`, `FEED_W_*`, `QUALITY_TIERS`), `ranker.get_model_status()`, the language-diversity check (`get_user_language_affinity`), current-window seeds (`get_diversified_seeds`), exclusion counts, and the taste profile with names resolved (genres table; person_cache → directors → TMDB; keywords via TMDB cached 30 d). `get_feedback_snapshot()` builds a daily per-signal timeline from `interaction_log`, recent explicit signals with an `undoable` flag, active `rec_suppression` rows with a `restorable` flag (latest explicit signal is the thumbs-down), and thumbs-up→watched conversion.
* **Exports**: `get_engine_snapshot()`, `get_feedback_snapshot()`

### `/backend/app/services/auth_service.py`
* **Purpose**: Movientum — Auth Service (Phase 3.1)
* **Exports**: none

### `/backend/app/services/click_service.py`
* **Purpose**: Main functionality for click_service.py.
* **Exports**: `recency_weight()`, `compute_watch_vs_click_gap()`

### `/backend/app/services/google_auth_service.py`
* **Purpose**: Verifies Google ID tokens (GIS) against Google's JWKS and resolves the account (login/link/create) for Sign in with Google.
* **Exports**: `verify_google_token()`, `generate_unique_username()`, `get_user_by_google_sub()`, `resolve_google_user()`

### `/backend/app/services/content_recs_service.py`
* **Purpose**: DEPRECATED thin shim — `get_content_basket_recommendations()` now delegates straight to `dna.service.get_dna_recommendations()`, passing through `filters`/`negative_items`/`ignore_taste` (Phase 3). Only `team_draft_interleave()` (used by the unrelated `/recommendations` and `/recommendations/similar` A/B paths) still lives here. Delete once the DNA rebuild has been live for a release; see `plans/dna.md`.
* **Exports**: `get_content_basket_recommendations()`, `team_draft_interleave()`

### `/backend/app/services/dna/` — Content DNA engine (rebuild, see `plans/dna.md`)
* **`__init__.py`** — public surface: `get_dna_recommendations()`, `invalidate_idf()`.
* **`idf.py`** — pure. DF/IDF table over namespaced `FeatureKey`s (`("kw", id)`, `("g", id)`, `("cast", id)`, `("crew", id)`, `("studio", id)`) built from `content_catalog`; fixes the old plain-int genre/keyword id collision. Exports `build_idf_table()`, `feature_keys()`, `IdfTable`, `to_jsonable()`/`from_jsonable()`.
* **`profile.py`** — pure. `build_profile()` implements the R2 mechanism: `w(f) = idf_norm(f) * support(f)**GAMMA` (GAMMA=1.5) — superlinear support so a basket sharpens rather than broadens as items are added. Exports `BasketProfile`, `build_profile()`, `compute_coherence()`.
* **`retrieval.py`** — pure. Inverted-index candidate recall (`build_inverted_index()`, `recall_with_backfill()`) over the local catalog, replacing the old TMDB-discover-by-genre retrieval; high-df features (df > N/8) are excluded from driving recall but still fully scored later.
* **`scoring.py`** — pure. `score_candidate()` (IDF-weighted per-facet cosine + multiplicative language/type/era/country gates + Bayesian quality shrinkage) and `mmr_select()` (MMR diversity + franchise cap, replacing the old duplicate-injecting diversity guard; both the diversity term and the cap are maintained incrementally — the naive O(pool³) form cost ~20s per request). `ScoringParams` collects every tunable constant so the offline sweep can drive the same code without forking it.
* **`graph_rwr.py`** — async (DB/Redis). `rwr_vector()` / `basket_rwr_scores()` — Personalized PageRank cached per-ITEM (`key_dna_rwr`, 24h), computed off the event loop over the prebuilt sparse matrix, with all cache-missing seeds sharing one batched power iteration. Uses an ABSOLUTE L1 convergence tolerance, not NetworkX's `err < N*tol` (which terminates after 3 iterations on a graph this size).
* **`service.py`** — async (DB/Redis) orchestration: `get_idf_and_index(db, catalog_rows=None)` (process-global, mirrors `graph_cache.get_or_build_graph()`; `_IDF_LOCK` stops a concurrent double build, feature extraction and both builds run in `asyncio.to_thread`), `get_dna_recommendations()` (rank-once/slice-many pagination via `key_dna_order`/`key_dna_profile`), `catalog_to_features()`/`features_to_payload()`. Phase 3: `_order_hash()` bakes personalization identity + negative basket into the order-cache key (ranking-affecting); `_apply_filters_and_sort()` narrows/re-sorts the cached ranked pool per-request without touching the cache (display-only); `_taste_affinity()` blends `user_taste_profiles` weights (tanh-squashed) as `score *= 1 + PERSONAL_W * affinity`, opt-out via `ignore_taste`; negative-basket profile subtracts `NEG_W * facet match` from candidate scores.

### `/backend/app/services/feedback_service.py`
* **Purpose**: Movientum — Recommendation Feedback Service. `process_signal()` is the one path every signal takes: it applies the taste-profile deltas, writes or clears the `rec_suppression` row, bridges `click_history` (which had live readers in `analysis_service` but no writer) and `ai_rec_memory`, and backfills the interaction row's feature snapshot. `apply_feedback()` updates the six JSONB weight vectors with `_saturating_add` — a step that shrinks as a weight approaches the `[-100, 100]` clamp, so no dimension can run away, while a reversal still moves at full strength — under `SELECT ... FOR UPDATE` (the read-modify-write previously lost concurrent updates). `invert=True` walks a signal back, which is how `undo` works; `last_explicit_signal()` resolves what to revert from `interaction_log` rather than trusting the client. `log_signal_fast()` is the single INSERT that runs on the request path. Suppression lasts `SUPPRESSION_DAYS` (90) and decays via `suppression_weight()`; nothing sweeps it on a schedule.
* **Exports**: `time_decay_weight()`, `apply_feedback()`, `process_signal()`, `log_signal_fast()`, `backfill_snapshot()`, `suppress_item()`, `unsuppress_item()`, `suppression_weight()`, `last_explicit_signal()`, `log_interaction()`, `generate_feature_snapshot()`, `rebuild_taste_profile_from_history()`

### `/backend/app/services/feedback_labels.py`
* **Purpose**: Signal constants, extracted so the Pydantic schemas can import the label table without pulling in the whole recommendation stack (feedback_service -> advanced_recs -> the NetworkX graph cache). Holds the label scale used for XGBRanker training: non-negative by construction (`rank:ndcg` requires graded relevance >= 0) with `thumbs_down` at 1, strictly below the neutral `unwatched`/`unwatchlist` at 2 — the previous scale put `thumbs_down` at -1 and `ml/training.py` floored it to 0, making an explicit dislike train identically to indifference. Also the per-dimension deltas, the decay lambdas, and the weight/language bounds.
* **Exports**: `SIGNAL_LABEL`, `SIGNAL_DELTAS`, `EXPLICIT_SIGNALS`, `NEGATIVE_SIGNALS`, `DECAY_LAMBDA`, `SUPPRESSION_DAYS`, `SUPPRESSION_LAMBDA`, `WEIGHT_MIN`, `WEIGHT_MAX`, `LANGUAGE_MIN`, `LANGUAGE_MAX`, `weight_bound` (per-user symmetric slider/clamp range for `/analysis`: ±100 unless stored weights — a history rebuild accumulates uncapped — already exceed it, then rounded up to a multiple of 50)

### `/backend/app/services/feedback_signal_worker.py`
* **Purpose**: The half of a thumbs press the user does not wait for. Opens its own `AsyncSessionLocal` (the request's session closes when the response is sent) and processes a whole batch in one session, because the connection pool is the scarce resource on a free tier. Each signal is isolated — a TMDB miss or a failed ingest is logged and skipped rather than dropping the rest of the batch. Not a Celery task and not scheduled: it runs in the API process right after the response, so it adds no worker and no idle cost.
* **Exports**: `process_signals_in_background()`

### `/backend/app/services/news_feedback_service.py`
* **Purpose**: Thumbs up / down on a news article, Redis only. Deliberately news-scoped: it moves per-user source / category / entity weights that `news_ranking_service` reads and **never** writes to `user_taste_profiles`, because that vector drives movie/TV recommendations and disliking an article about a film is not disliking the film. `record()` is one pipelined write (HINCRBYFLOAT the three hashes, ZADD the hidden set with an expiry score, DEL the cached for-you ordering); `load_feedback()` is one pipelined read, clipped to `[-1, 1]` by dividing by `WEIGHT_CAP` rather than max-abs normalizing — otherwise a user's first press would swing the ordering as hard as their fiftieth. Expiry needs no cleanup job: reads filter with ZRANGEBYSCORE on the score.
* **Exports**: `record()`, `load_feedback()`, `prune_fields()`, `HIDDEN_DAYS`, `WEIGHT_CAP`

### `/backend/app/services/anime_utils.py`
* **Purpose**: Anime detection and anime-only similarity/ranking primitives — pure functions, no I/O. The generic pipeline treated anime like anything else: the walk left the seed through the `g:16` and `l:ja` hubs, `studio_ids` was stored but never used anywhere, and `bayesian_rating`'s m=300 prior flattened every anime's quality term. `is_anime_features()`/`is_anime_row()`/`is_anime_item()` require genre 16 *and* (Japanese original language or a JP origin country), so western cartoons and live-action Japanese cinema are both excluded. `anime_affinity()` scores a candidate against the seed over franchise 0.34 / keyword 0.26 / studio 0.20 / crew 0.10 / cast 0.06 / sub-genre 0.04, renormalised over whichever facets the candidate actually carries. `franchise_overlap()` compares distinctive title tokens, which is how the rest of a franchise (seasons, films, spin-offs sharing almost no metadata) reaches the top of its own page.
* **Exports**: `is_anime_features()`, `is_anime_row()`, `is_anime_item()`, `anime_affinity()`, `franchise_overlap()`, `ANIMATION_GENRE`, `BAYESIAN_M_ANIME`, `ANIME_FACET_WEIGHTS`

### `/backend/app/services/graph_cache.py`
* **Purpose**: Movientum — Graph Cache (Phase 3). `add_row_to_graph(row)` splices a freshly-ingested catalog row into the live `_GRAPH` (O(features), safe on the request path; `_MATRIX` is deliberately left alone since rebuilding it costs ~1.2 s and only the DNA path reads it). Anime rows carry their own edge weighting: studio edges (`s:{id}`, weight 1.8, skipped above `STUDIO_HUB_MAX` 250 anime per studio), keyword edges at 2.4 instead of 1.5, and the `g:16` hub edge cut to 0.35 — so a walk from an anime stays inside its own neighbourhood instead of spreading across western animation. Studio edges are anime-only on purpose (for live action a studio is a distribution label, not an author credit). Also exports the canonical `node_id()`/`parse_node_id()` pair (`node_id("movie", 550) -> "m:550"`) — the single source of truth for the content-node ID format, used by `dna/graph_rwr.py` and `advanced_recs.py` instead of local re-derivation. `get_or_build_matrix()` caches the row-normalised scipy transition matrix beside `_GRAPH` (both dropped by `invalidate_graph()`), because `nx.pagerank` otherwise rebuilds that matrix on every call — 1.23s of the 1.62s each seed cost.
* `get_or_build_graph(db, rows=None)` accepts pre-read catalog rows so the startup warm-up shares one read with the DNA index.
* `get_ppr_matrix_sync(G)` returns the exact matrix `nx.pagerank` builds internally (networkx 3.x `_pagerank_scipy` arithmetic), cached as `_PPR_MATRIX` per `_GRAPH_VERSION`; the version is bumped by every graph build, `add_row_to_graph()` and `invalidate_graph()`, so the similar-items walk (`advanced_recs._pagerank_cached`) always matches the live graph bit-for-bit while skipping the per-request ~1.2 s conversion.
* **Exports**: `build_graph_from_rows()`, `add_row_to_graph()`, `node_id()`, `parse_node_id()`, `get_or_build_matrix()`, `get_ppr_matrix_sync()`, `invalidate_graph()`, `get_graph_stats()`

### `/backend/app/services/news_service.py`
* **Purpose**: Movientum — News Service (Redis only), news rebuild Phase 3 (`plans/news_system.md`). `build_snapshot()` enriches a deduped batch (category tags, entity links, quality score), writes it as generation N+1 under `news:v3:{gen}:*` (articles hash, latest / quality / per-category / per-entity zsets, meta hash), attaches per-article `taste_facets` (genre/person/keyword ids, resolved once from `content_catalog` when a DB session is passed), swaps the `news:v3:gen` pointer (optional `on_stage` progress hook; enrichment runs in `asyncio.to_thread`), waits a short grace period, and deletes every other generation. Guarded by a build lock; refuses an empty batch. Reads resolve the generation (5 s in-process memo) and cache pages under the generation namespace (30 min); trending is computed on demand (views per hour, then quality order) and cached 15 min. Views/seen/saves use generation-independent keys. `get_for_you_feed()` (Phase 4) ranks every snapshot article (memoized per generation) through `news_ranking_service`; `get_category_feed()` returns the same personal order filtered to the category for users with a taste profile (newest first otherwise). Both accept a per-visit `seed` that applies `jitter_order`.
* **Exports**: `build_snapshot()`, `get_for_you_feed()`, `SnapshotBuildInProgress`, `enrich_article()`, `quality_score()`, `get_latest_feed()`, `get_editorial_feed()`, `get_trending_feed()`, `get_category_feed()`, `get_entity_feed()`, `get_categories()`, `get_article_by_id()`, `search_articles()`, `get_news_status()`, `record_view()`, `save_article()`, `unsave_article()`, `get_saved_feed()`

### `/backend/app/services/news_fetch_service.py`
* **Purpose**: News rebuild Phase 2 (`plans/news_system.md`). Fetches one snapshot from NewsAPI (50, 1 request, pinned to entertainment domains), CurrentsAPI (600, ~30 requests: free plan caps 20/page and 100 results/query, so one-day `start_date`/`end_date` windows, keyword-slice fallback) and ApiTube (50, 5 requests at 10/page, IPTC `medtop:01000000`), concurrently. Normalizes all three to one dict (`id` = sha256 of canonical URL) and deduplicates: canonical URL → title fingerprint → title-token Jaccard ≥ 0.72 with prefix filtering; higher source tier / longer description / newer wins. No Redis. Fetchers never raise. `run_daily_fetch(on_stage=None)` reports each provider's completion and the dedup stage to an optional hook.
* **Exports**: `run_daily_fetch()`, `fetch_newsapi()`, `fetch_currents()`, `fetch_apitube()`, `normalize_article()`, `deduplicate()`, `canonicalize_url()`, `url_hash()`, `source_tier()`, `is_clickbait()`, `title_tokens()`, `title_fingerprint()`, `parse_published_at()`

### `/backend/app/services/news_ranking_service.py`
* **Purpose**: News rebuild Phase 4 (`plans/news_system.md`). For-You ranking of the news snapshot against `user_taste_profiles` (read-only; the recommendation engine is untouched). Ingest: `load_catalog_facets()` + `build_taste_facets()`. Request: `load_taste_vector()` (max-abs normalized genre/person/keyword/negative vectors + rated/watched/watchlisted titles, cached 15 min under `key_user_prefs`; `None` for cold start < 5 interactions), `score_article()` (0.30 genre, 0.20 person, 0.20 entity match, 0.10 keyword, 0.12 source tier, 0.08 recency, −0.15 strongest negative hit, −0.25 seen), `rank_candidates()` (lazy-heap MMR-lite diversity over every candidate, no cap), `jitter_order()` (seeded shuffle within windows of 8, applied per page visit at read time), `get_ranked_order()` (id order cached 10 min per user and generation under `order:v2`).
* **Exports**: `load_catalog_facets()`, `build_taste_facets()`, `normalize_weights()`, `build_vector()`, `load_taste_vector()`, `candidate_from_article()`, `score_article()`, `rank_candidates()`, `jitter_order()`, `get_ranked_order()`

### `/backend/app/services/news_taxonomy.py`
* **Purpose**: Single source of truth for news categories (id/label/color/icon, `strong`/`weak`/`exclude` phrases, outlet `domains`, primary). `classify_article()` is a scored vote: word-boundary phrase matches (strong 3, weak 1, headline ×2), outlet domain (+3), exclude phrases stripped first, linked catalogue titles' language/country/genres (+3 region, +2 genre); tags need ≥3 points, max 3, ordered by score. `tag_genres()` is the text-only wrapper, clickbait phrases, source tiers by name and domain, and the `TMDB_GENRE_TO_CATEGORY` / `CATEGORY_TO_TMDB_GENRES` bridge used by For-You ranking. Crawl-era `query`/`refresh_tier`/`REFRESH_TIERS`/`RSS_SOURCES` pruned in Phase 3.
* **Exports**: `CATEGORIES`, `PRIMARY_CATEGORY_IDS`, `CATEGORY_BY_ID`, `CATEGORY_IDS`, `CLICKBAIT_PHRASES`, `TIER_1_SOURCES`, `TIER_2_SOURCES`, `TIER_1_DOMAINS`, `TIER_2_DOMAINS`, `TMDB_GENRE_TO_CATEGORY`, `CATEGORY_TO_TMDB_GENRES`, `score_categories()`, `strong_categories()`, `domain_of()`, `classify_article()`, `tag_genres()`

### `/backend/app/services/news_nlp.py`
* **Purpose**: Self-trained category refiner run inside `build_snapshot` (via `asyncio.to_thread`). Confident rule hits (score ≥6) seed one TF-IDF (1–2 grams + domain/linked language/country/genre tokens) + balanced logistic regression per category (≥8 seeds); merge keeps rule tags, adds tags at p≥0.80 (or p≥0.60 with some rule evidence), vetoes weak-only rule tags at p<0.15, keeps one regional tag (bollywood/anime/k-drama) unless rules back several, caps at 3. sklearn imported lazily; any failure falls back to rule tags.
* **Exports**: `refine_categories()`, `fit_models()`, `build_document()`, `top_terms()`

### `/backend/app/services/news_entity_linker.py`
* **Purpose**: Links articles to real catalogue titles (word-boundary match against a nightly-built title index) for exact personalisation and the detail-page news rail. Single-word titles ("After", "David", "Power") pass only `_single_word_match_is_real()`: the word must appear capitalised in the headline and not inside a longer capitalised phrase.
* **Exports**: `build_title_index()`, `get_title_index()`, `link_entities()`, `COMMON_WORD_TITLES`

### `/backend/app/services/rating_service.py`
* **Purpose**: Movientum — Rating Service (Phase 3.3)
* **Exports**: `upsert_rating()`, `get_distribution()`, `get_user_ratings()`, `get_rating_by_id()`, `delete_rating()`, `new_moctale_row()`, `shift_moctale_votes()` (community-meter math, reused by `import_service`)

### `/backend/scripts/fill_missing_tmdb_ids.py`
* **Purpose**: One-off: fills blank `tmdb_id` cells in `testing/movientum_list_merged.csv` via TMDB search (title + year scoring), saves after every match, prints unmatched rows.

### `/backend/app/services/ranking_utils.py`
* **Purpose**: Shared ranking primitives for both recommendation surfaces. The interleavers (`team_draft_interleave`, `weighted_multi_interleave`) shuffle their draw queue to remove A/B position bias — correct for measurement, wrong for ordering a feed — so they now decide membership only and these helpers decide order.
* **Constants**: `FEED_POOL_WEIGHTS` (recent 0.125 / established 0.65 / diverse 0.175 / fresh 0.075), `FEED_W_RELEVANCE/QUALITY/TASTE/NOVELTY` (0.28/0.26/0.36/0.10), `FEED_QUALITY_TARGET` (25), `QUALITY_TIERS` — moved here from `routers/recommendations.py` (values unchanged) so the analysis page reads the live numbers.
* **Exports**: `bayesian_rating()` (confidence-weighted rating, m=300 prior 6.5), `quality_score()` (same rule, but m=90 for anime — the anime vote distribution sits an order of magnitude below the live-action one, so the global prior flattened the term), `popularity_score()` (saturated at 1000), `novelty_score()` (inverse saturated popularity — the discovery term in the feed), `recency_score()`, `pool_rank_score()`/`tag_pool_rank()` (carry a source pool's own ordering as a 0..1 feature), `taste_match()` (0..1, 0.5 neutral for guests, negative weights subtracted), `era_multiplier()` (1.00–1.30 soft boost), `mmr_diversify()` (single-pass genre/language de-clustering, reorder only — membership untouched), `item_signature()`, `apply_quality_floor()` (progressive relaxation), `strip_internal()`, `HEAVY_FIELDS`

### `/backend/app/services/recommendation_service.py`
* **Purpose**: Movientum — Recommendation Service (Simplified). Includes language-diversity injection: `get_user_diversity_threshold()` reads `User.language_diversity_threshold` (Analysis-page setting, default 0.70); when a user's dominant watch-history language exceeds that share, `get_user_language_affinity()`/`_apply_language_blend()` cap it at the threshold and guarantee `MIN_DIVERSE_ITEMS` (3) other-language picks. Applied in `get_personalized_recommendations()`, and mirrored in `routers/recommendations.py` (main feed Step 3.5, similar-items Step 4.5).
* **Exports**: `compute_language_blend_ratio()`, `get_diversified_seeds()`, `get_recent_era_profile()`, `weighted_multi_interleave()`, `get_user_diversity_threshold()`, `get_user_language_affinity()`, `MIN_DIVERSE_ITEMS`
* **Notes**: `get_diversified_seeds(db, user_id, block, window)` samples its three buckets with a `random.Random(f"{user}:{block}:{window}")` over bands (`RECENT_SEED_WINDOW` 10 / `ESTABLISHED_SEED_BAND` 8 / `DIVERSE_SEED_BAND` 5) instead of taking an argmax, so a new 15-minute rotation window runs different graph walks and the feed actually changes. `get_recent_era_profile(db, user_id, days=90)` returns the user's recent watching per release decade, feeding the soft era boost in the feed re-rank.

### `/backend/app/services/export_service.py`
* **Purpose**: User data export. `build_list_csv` = watched + rated titles as `title,type,year,rating` (re-importable via `/users/import-list`). `build_full_export` = AI-ready JSON (profile/prefs, ratings with 1-4 score, watch history, watchlists, taste profile top likes/dislikes with resolved genre/person names, recommendation signals, tier lists, tracking, stats, `_meta.how_to_use` guide). Batched title resolution (`movies` then `content_catalog`), no TMDB calls.
* **Exports**: `build_list_csv()`, `build_full_export()`, `RATING_SCALE`

### `/backend/app/services/import_service.py`
* **Purpose**: Bulk CSV list import behind `POST /users/import-list`. Parses + dedupes rows by (tmdb_id, type), resolves id-less rows (local title+year, then TMDB search), fetches titles missing from `movies` from TMDB concurrently (semaphore 8) and bulk-inserts them (core row + genres), retries a stale tmdb_id by title+year, bulk-upserts `watch_history` (existing `watched_at` kept) and `ratings`, shifts the community meter (`movie_ratings`/`tv_ratings`) in memory, one commit, then busts the same caches as a single rating write (`bust_user_library_caches` + per-title dist/detail keys). Returns `{total, imported, rated, added_to_catalog, skipped, unmatched, unmatched_rows[], settling?}`. An import of ≥ `IMPORT_SETTLE_MIN_ROWS` (200) new titles stamps `users.last_import_at` and runs `settle_import` as a BackgroundTask: throttled catalog/graph ingest (20 per burst, 1 s pause, cap 400) then one damped `feedback_service.apply_feedback_batch` (scale 0.5 × rating multiplier); a Redis settling marker stops the request-path lazy taste rebuild meanwhile.
* **Exports**: `import_list()`, `settle_import()`, `parse_csv()`, `ImportFormatError`

### `/backend/app/services/search_service.py`
* **Purpose**: Movientum — Search Service. Local-first ranked search for titles and people. `text_relevance` (0–1: exact, prefix, word-prefix, per-word rapidfuzz typo match, token-sort, space-insensitive match, DB trigram scores) x 10 + capped popularity prior; candidates below 0.45 relevance dropped. TMDB only when it can help (`_needs_tmdb`: no/weak local match, or correctly spelled complete words with no exact local title — skipped for typos and mid-word prefixes), 3.5 s timeout, lower-cased query so Redis TMDB keys are shared. TMDB people are written back into `people`.
* **Exports**: `normalize()`, `text_relevance()`, `score_title()`, `score_person()`, `rank_titles()`, `rank_people()`, `instant_search()`, `get_autocomplete_suggestions()`, `fetch_tmdb_titles()`, `fetch_tmdb_people()`, `remember_people_later()`, `tmdb_query()`, `GENRE_ID_TO_NAME`

### `/backend/app/services/tmdb_service.py`
* **Purpose**: Movientum — TMDB API Service. Runs two request profiles over one client: a patient batch profile for `async with TMDBService()` (seed scripts, Celery) and a fast live profile for the `tmdb_service` singleton behind the HTTP routes (no pacing, short timeouts, 6s total retry budget, stale-copy fallback, 404 negative caching). `TMDBService.warmup()` opens the TLS connection once during app startup.
* **Exports**: `TMDBService`, `bin_release_era()`

### `/backend/app/services/trailer_service.py`
* **Purpose**: Feature 4 — region classification (India/Anime/Hollywood/Other) + TMDB discover fan-out + video selection for the home "Trailers" row. Shared by `routers/trailers.py` (personalization lookups) and `tasks/fetch_trailers.py` (ingestion) so no TMDB-calling code is duplicated or left in the router.
* **Exports**: `is_india()`, `is_anime()`, `is_hollywood()`, `matches_region()`, `get_discover_params()`, `discover_candidates()`, `fetch_videos_bounded()`, `build_trailer_record()`, `get_user_followed_tv_ids()`

### `/backend/app/services/watch_service.py`
* **Purpose**: Movientum — Watch Service (Phase 3.3)
* **Exports**: none

### `/backend/app/tasks/check_episodes.py`
* **Purpose**: Main functionality for check_episodes.py.
* **Exports**: `check_today_episodes_task()`

### `/backend/app/tasks/fetch_news.py`
* **Purpose**: Movientum — News Celery Tasks. Only the nightly entity-linking title index build remains (beat 03:45 IST); all crawl/expiry/rollup tasks removed in news rebuild Phase 1.
* **Exports**: `build_title_index_task()`

### `/backend/app/tasks/news_daily_fetch.py`
* **Purpose**: News rebuild Phase 5. The only news write path, manual by design (no beat entry). `_async_news_daily_fetch()` runs `run_daily_fetch()` → `build_snapshot(db=session)` with `set_progress`/`should_cancel` stages (task key `news_daily_fetch`) and returns `{raw, deduped, stored, per_source, raw_per_source, linked_articles, generation, previous_generation, built_at, fetch_s, build_s}`. Used natively by `routers/internal.py`; `news_daily_fetch_task` is the Celery wrapper listed in `admin.py` `ADMIN_TASKS`.
* **Exports**: `news_daily_fetch_task()`, `_async_news_daily_fetch()`

### `/backend/app/tasks/fetch_trailers.py`
* **Purpose**: Feature 4 — precomputes the recency-ranked trailer/teaser Redis index so `GET /trailers/home` never hits TMDB on the request path (beat: every 3h, staggered per region; also triggerable on-demand via the Admin page's "Refresh Trailers" button, since Celery beat is unreliable in this environment — see `plans/update.md` §4.0a).
* **Exports**: `refresh_trailer_index_task()`, `refresh_all_trailers_task()`, `expire_trailer_index_task()`

### `/backend/app/tasks/retrain_ranker.py`
* **Purpose**: Movientum — Nightly Ranker Retrain Celery Task (Phase 7)
* **Exports**: `nightly_ranker_retrain()`

### `/backend/app/tasks/sync_movies.py`
* **Purpose**: Movientum — Daily Movie Sync Celery Task
* **Exports**: `daily_movie_sync()`

### `/backend/app/utils/deps.py`
* **Purpose**: Movientum — FastAPI Dependencies (Phase 3.1)
* **Exports**: none

### `/backend/app/utils/jwt_utils.py`
* **Purpose**: Movientum — JWT Utilities (Phase 3.1)
* **Exports**: `create_access_token()`, `create_refresh_token()`

### `/backend/app/utils/password_utils.py`
* **Purpose**: Movientum — Password Utilities (Phase 3.1)
* **Exports**: `DUMMY_HASH`, `hash_password()`, `verify_password()`, `hash_password_async()`, `verify_password_async()` (request handlers use the async ones)

### `/backend/app/utils/persistence.py`
* **Purpose**: Movientum — Persistence and TTL Utilities
* **Exports**: `get_ttl_for_popularity()`

### `/frontend/src/App.jsx`
* **Purpose**: App.jsx — Router setup (Phase 3.5A)
* **Exports**: `function`

### `/frontend/src/main.jsx`
* **Purpose**: Core UI/Logic for main.jsx.
* **Exports**: none

### `/frontend/src/components/AddContentModal.jsx`
* **Purpose**: AddContentModal.jsx — Phase 5
* **Exports**: `function`

### `/frontend/src/components/AnalyticsLoader.jsx`
* **Purpose**: Core UI/Logic for AnalyticsLoader.jsx.
* **Exports**: `function`

### `/frontend/src/components/Aurora.jsx`
* **Purpose**: Core UI/Logic for Aurora.jsx.
* **Exports**: `function`

### `/frontend/src/components/BorderGlow.jsx`
* **Purpose**: Core UI/Logic for BorderGlow.jsx.
* **Exports**: `BorderGlow`

### `/frontend/src/components/CastCrew.jsx`
* **Purpose**: CastCrew.jsx — Phase 1.3 (Improvement)
* **Exports**: `function`

### `/frontend/src/components/ColdStartLoader.jsx`
* **Purpose**: Core UI/Logic for ColdStartLoader.jsx.
* **Exports**: `function`

### `/frontend/src/components/ErrorBoundary.jsx`
* **Purpose**: Core UI/Logic for ErrorBoundary.jsx.
* **Exports**: `ErrorBoundary`

### `/frontend/src/components/FilterDropdown.jsx`
* **Purpose**: Core UI/Logic for FilterDropdown.jsx.
* **Exports**: `function`

### `/frontend/src/components/GoogleSignInButton.jsx`
* **Purpose**: Renders Google's own GIS button (Sign in / Sign up with Google) and hands the raw ID token to an `onSuccess` callback. Renders nothing if `VITE_GOOGLE_CLIENT_ID` is unset.
* **Exports**: `function` (default)

### `/frontend/src/components/HomeNewsStrip.jsx`
* **Purpose**: HomeNewsStrip — compact horizontal news strip for the Home page.
* **Exports**: `function`

### `/frontend/src/components/ColdStartNote.jsx`
* **Purpose**: Small dismissible note above For You (Home row children slot, /recommendations grid) when the feed response has `cold_start: true` — links to `/settings/import`. Dismissal per user in localStorage `mv:coldnote:{username}`. Styles in `ColdStartNote.css`.
* **Exports**: `ColdStartNote`

### `/frontend/src/components/InfoBanner.jsx`
* **Purpose**: Core UI/Logic for InfoBanner.jsx.
* **Exports**: `function`

### `/frontend/src/components/ImageLightbox.jsx`
* **Purpose**: Full-screen view of one image, portalled to the body. Shared by the tier board tiles (tap a poster) and any page that wants the person-page zoom gesture; the caller passes the largest TMDB rendition.
* **Exports**: `ImageLightbox` (default)

### `/frontend/src/components/InstallPrompt.jsx`
* **Purpose**: Core UI/Logic for InstallPrompt.jsx.
* **Exports**: `function`

### `/frontend/src/components/LazyMount.jsx`
* **Purpose**: Renders children only once they scroll near the viewport (IntersectionObserver, 400px rootMargin). Used on the movie/TV detail pages to hold back sections that fetch on mount (news, AI recommendations) so their requests stay off the initial page load.
* **Exports**: `LazyMount`

### `/frontend/src/components/MovieCard.jsx`
* **Purpose**: MovieCard — most reusable component in Phase 2. Renders `FeedbackControl` when `showFeedback` is set (the hand-rolled thumbs overlay that used to be inline here now lives in that component). `onDismiss` + `isExiting` come from `useFeedbackBuffer` and drive the hide-and-replace animation; `feedbackValue` lets a parent control the thumb state; `badge` is the slot the AI cards use for their sparkle marker.
* **Exports**: `MovieCard`

### `/frontend/src/components/FeedbackControl.jsx`
* **Purpose**: The one thumbs-up / thumbs-down control, used by MovieCard, TrailerCard, AIRecCard and NewsCard — replacing three separate implementations plus nothing at all on news. Handles the optimistic update, the second-press retraction (`undo`), and sending guests to login rather than hiding itself. Every handler stops propagation, because MovieCard wraps the card in a `<Link>` and NewsCard is itself a `role="button"` that opens the article. `kind="news"` switches it to the news endpoint. Owns `FeedbackControl.css`, which keeps the original `.movie-card__feedback-*` class names and adds the `(hover: none)` branch that pins the control to the bottom of the card and keeps it permanently visible on touch — hover-reveal left it unreachable on a phone.
* **Exports**: `FeedbackControl`

### `/frontend/src/hooks/useFeedbackBuffer.js`
* **Purpose**: Hide-and-replace for a recommendation row or grid keyed on `media_type:tmdb_id`. A dismissed card animates out (200 ms, matched to `.is-exiting` in MovieCard.css) and the next item from the tail of the already-fetched list takes its place — the rec endpoints return large pools, so nothing extra is requested in the normal case. `fetchMore` is optional and should be the surface's existing pagination call. Honours `prefers-reduced-motion`, and filters items dismissed earlier in the session through `feedbackService.filterDismissed`.
* **Exports**: `useFeedbackBuffer`

### `/frontend/src/hooks/useNewsDismiss.js`
* **Purpose**: The same hide-and-replace for news cards, separate because an article is keyed by a string id (a sha256 of its URL), not the `media_type:tmdb_id` pair. The hidden set is module-level so dismissing an article on `/news` also removes it from the Home strip and a detail page's rail without a refetch — the server hides it too, but its ranked ordering is cached for 10 minutes.
* **Exports**: `useNewsDismiss`

### `/frontend/src/components/MovieCardSkeleton.jsx`
* **Purpose**: MovieCardSkeleton — shimmer placeholder while data loads
* **Exports**: `function`

### `/frontend/src/components/MovieRow.jsx`
* **Purpose**: Core UI/Logic for MovieRow.jsx.
* **Exports**: `function`

### `/frontend/src/components/Navbar.jsx`
* **Purpose**: Navbar — Redesigned brand header.
* **Exports**: `function`

### `/frontend/src/components/NewsArticlesSection.jsx`
* **Purpose**: NewsArticlesSection — reusable horizontal news rail (arrow-driven, scroll-snap) for Movie and TV detail pages.
* **Exports**: `function`

### `/frontend/src/components/NewsCard.jsx`
* **Purpose**: NewsCard — displays a single news article; never unmounts on a failed/missing/pixel image (shows source-name fallback art tinted per outlet), images load with `no-referrer`; tag ids shown as labels; `standard`/`compact`/`rail` variants (rail: 16:9 thumb, clamped 3-line title with "…more" cue, "By {source} • {time}" meta).
* **Exports**: `function`

### `/frontend/src/components/PageTransition.jsx`
* **Purpose**: Core UI/Logic for PageTransition.jsx.
* **Exports**: `function`

### `/frontend/src/components/ProductionTags.jsx`
* **Purpose**: ProductionTags.jsx
* **Exports**: `function`

### `/frontend/src/components/ProtectedRoute.jsx`
* **Purpose**: ProtectedRoute.jsx — Phase 3.5A
* **Exports**: `function`

### `/frontend/src/components/RatingMeter.jsx`
* **Purpose**: RatingMeter.jsx — Phase 3.5C (Upgraded Premium UI)
* **Exports**: `function`

### `/frontend/src/components/RequestContentModal.jsx`
* **Purpose**: Core UI/Logic for RequestContentModal.jsx.
* **Exports**: `function`

### `/frontend/src/components/SaveToCollectionModal.jsx`
* **Purpose**: Core UI/Logic for SaveToCollectionModal.jsx.
* **Exports**: `SaveToCollectionModal`

### `/frontend/src/components/ScrollRestore.jsx`
* **Purpose**: Saves window + sub-element scroll positions per route and restores them on POP (back) navigation via a rAF loop. The loop aborts on any real user input (wheel/touchstart/keydown/mousedown), stops re-issuing `window.scrollTo` once the target is reached, and gives up chasing missing sub-elements after ~80 frames — without those guards it kept re-scrolling for 5 s and the page felt like it refused to scroll.
* **Exports**: `function`

### `/frontend/src/components/ScrollReveal.jsx`
* **Purpose**: Core UI/Logic for ScrollReveal.jsx.
* **Exports**: `function`

### `/frontend/src/components/SearchBar.jsx`
* **Purpose**: SearchBar.jsx — Debounced autocomplete search bar (Phase 3.5B)
* **Exports**: `function`

### `/frontend/src/components/SearchOverlay.jsx`
* **Purpose**: Core UI/Logic for SearchOverlay.jsx.
* **Exports**: `function`

### `/frontend/src/components/ShinyText.jsx`
* **Purpose**: Core UI/Logic for ShinyText.jsx.
* **Exports**: `ShinyText`

### `/frontend/src/components/StaggerContainer.jsx`
* **Purpose**: Core UI/Logic for StaggerContainer.jsx.
* **Exports**: `function`, `StaggerItem`

### `/frontend/src/components/TrailerCard.jsx`
* **Purpose**: Core UI/Logic for TrailerCard.jsx.
* **Exports**: `function`

### `/frontend/src/components/TrailerModal.jsx`
* **Purpose**: Core UI/Logic for TrailerModal.jsx.
* **Exports**: `function`

### `/frontend/src/components/TrailerRow.jsx`
* **Purpose**: Core UI/Logic for TrailerRow.jsx.
* **Exports**: `function`

### `/frontend/src/components/WatchlistCollectionCard.jsx`
* **Purpose**: Dashboard watchlist tile — uploaded `cover_image_url` banner when set, otherwise fanned posters; two per row on phones.
* **Exports**: `function`

### `/frontend/src/components/WatchlistSection.jsx`
* **Purpose**: Core UI/Logic for WatchlistSection.jsx.
* **Exports**: `function`

### `/frontend/src/context/AuthContext.jsx`
* **Purpose**: AuthContext.jsx — Global auth state (Phase 3.5A)
* **Exports**: `AuthProvider`, `useAuth`, `AuthContext`

### `/frontend/src/data/dummy.js`
* **Purpose**: Dummy movie data — Phase 2A only.
* **Exports**: `DUMMY_MOVIES`, `DUMMY_MOVIE_DETAIL`, `TMDB_IMAGE_BASE`

### `/frontend/src/data/funFacts.js`
* **Purpose**: Core UI/Logic for funFacts.js.
* **Exports**: `FUN_FACTS`

### `/frontend/src/data/loaderPosters.js`
* **Purpose**: Static fallback TMDB poster paths for ColdStartLoader's poster wall, used when localStorage has no cached posters (first-ever page view).
* **Exports**: `FALLBACK_POSTERS`

### `/frontend/src/hooks/useLoaderPosters.js`
* **Purpose**: Resolves the poster list for ColdStartLoader's poster wall (localStorage cache → bundled fallback), deals it into seamless-loop columns, and preloads a quorum of images before signalling ready.
* **Exports**: `useLoaderPosters`

### `/frontend/src/hooks/useScrollRestore.js`
* **Purpose**: Core UI/Logic for useScrollRestore.js.
* **Exports**: `useScrollRestore`

### `/frontend/src/hooks/useSessionState.js`
* **Purpose**: Core UI/Logic for useSessionState.js.
* **Exports**: `useSessionState`

### `/frontend/src/pages/AdminDashboard.jsx`
* **Purpose**: Live admin panel, routed at `/admin`. "Manual Triggers & Tasks" (`.admin-tasks-list`/`.admin-task-row`) `TASKS` array drives `POST /internal/trigger/{task_key}` — add new task keys here + `routers/internal.py`, not `admin.py`/`AdminPage.jsx` (unrouted).
* **Exports**: `function`

### `/frontend/src/pages/Analysis.jsx`
* **Purpose**: /analysis shell — fetches `getAnalysis` + `getEngineSnapshot`, renders the hero (headline, tags, stats, `TasteFingerprint`), the `SectionRail`, and seven sections; below-fold sections wrapped in `LazyMount`. Styles in `Analysis.css` (all classes `an-*`, built on index.css glass tokens + Outfit; phone rules at ≤768/640/380px keep content clear of the floating mobile tab bar).
* **Exports**: `function`

### `/frontend/src/pages/analysis/`
* **Purpose**: Analysis page sections. `SectionRail.jsx` (fixed rail → sticky chip bar ≤1100px; also exports `Section`, `SectionSkeleton`, `EmptyNote`), `TasteFingerprint.jsx` (radial SVG of genre weights + era ring), `EngineXray.jsx` (5-step feed pipeline from the engine snapshot), `TasteProfile.jsx` (signed genre bars, actors, directors, themes, decades, language multipliers, negatives), `FeedbackCenter.jsx` (30/90-day totals, lazy `SignalTimeline.jsx` recharts area chart, recent signals with Undo, hidden titles with Restore — both send `recFeedback.undo` with source `analysis`), `Habits.jsx` (local-time heatmap, monthly bars, streaks, rating split, browsed-vs-watched, quarterly drift), `LibraryHighlights.jsx` (rewatch / old favourites / hidden gems shelves), `TuneProfile.jsx` (language limit, Language mix Auto/Custom per-language shares, Rewatch picks 0–30%, content type, history window, genre/decade weight sliders; each labelled with what it changes; `popularity_pref`/`discovery_mode` intentionally not shown — the engine never reads them), `analysisUtils.js` (`detailPath`, `languageName`, `relativeTime`, `tasteHeadline`, `SIGNAL_META`, `POOL_META`).
* **Exports**: section components

### `/frontend/src/pages/CompanyPage.jsx`
* **Purpose**: CompanyPage.jsx
* **Exports**: `function`

### `/frontend/src/pages/CountryPage.jsx`
* **Purpose**: CountryPage.jsx
* **Exports**: `function`

### `/frontend/src/pages/Dashboard.jsx`
* **Purpose**: Dashboard.jsx — rebuilt
* **Exports**: `function`

### `/frontend/src/pages/ErrorPage.jsx`
* **Purpose**: Core UI/Logic for ErrorPage.jsx.
* **Exports**: `ErrorPage`

### `/frontend/src/pages/Explore.jsx`
* **Purpose**: `/explore` results — URL-driven filters (category, genres, language, countries, family, award, anime, type, duration, years, min rating, cinema, studios, OTT), sticky filter rail on desktop / bottom sheet on mobile, removable chip row, infinite scroll, sessionStorage cache keyed by the query. Styles in `ExploreResults.css` (`Explore.css` stays for the recommendation pages that import it).
* **Exports**: `Explore`

### `/frontend/src/pages/ExploreHub.jsx`
* **Purpose**: `/explore/:facet` hub — category/language (A–Z tiles), genre/family/anime (tone cards), country (flagcdn flags), franchise (16:9 banners from `GET /api/v1/explore/franchises`). Client-side search; tiles link to `/explore?<facet>=<slug>`.
* **Exports**: `ExploreHub`

### `/frontend/src/pages/ExploreFranchise.jsx`
* **Purpose**: `/explore/franchise/:slug` — backdrop hero + numbered poster grid from the tier template resolver (`GET /api/v1/tierlist/templates/{slug}`); rail with sort, content type, fade-watched (history fetched lazily).
* **Exports**: `ExploreFranchise`

### `/frontend/src/components/explore/ExploreMenu.jsx`
* **Purpose**: Navbar Explore facet picker — popover under the button on desktop, bottom sheet ≤900px; arrow-key grid navigation, Esc/outside click close.
* **Exports**: `ExploreMenu`

### `/frontend/src/components/explore/ExploreFilters.jsx`
* **Purpose**: Explore filter controls shared by rail and sheet — `Select` (searchable, multi), `FilterPanel`, `FilterSheet` (drag-to-close). Styles in `ExploreFilters.css`; shared tokens in `explore-tokens.css`.

### `/frontend/src/components/explore/ExploreAurora.jsx`
* **Purpose**: Top-of-page aurora for `/explore`, `/explore/:facet` and `/explore/franchise/:slug`, same shader/fade as `/recommendations` but a distinct palette per `variant` (`results`, each facet key, `saga`). Styles in `ExploreAurora.css` (also lifts page content to `z-index: 1`).
* **Exports**: `Select`, `FilterPanel`, `FilterSheet`

### `/frontend/src/utils/exploreTaxonomy.js`
* **Purpose**: Explore facet slugs + labels (FACETS, GENRES with tones, CATEGORIES, COUNTRIES, LANGUAGES, FAMILY, ANIME_GENRES, SORTS, DURATIONS, DECADES, CINEMAS, COMPANIES). Slugs mirror `backend/app/data/explore_taxonomy.py`.

### `/frontend/src/utils/exploreFilters.js`
* **Purpose**: `DEFAULT_FILTERS`, `MIN_YEAR`, `countActive` for the explore filter object.

### `/frontend/src/utils/ott.js`
* **Purpose**: OTT tile list (TMDB provider ids + name regex) shared by WatchlistDetail and the explore rail; `ottMatches`, `ottProviderIds`.

### `/frontend/src/hooks/useInstantSearch.js`
* **Purpose**: Shared instant title search (SearchOverlay behaviour): 250 ms debounce, 2-char min, abort, module-level 5-min/50-entry cache, persons filtered. Used by AddContentModal and RecommendationsContent.
* **Exports**: `useInstantSearch`

### `/frontend/src/components/SearchResultRow.jsx`
* **Purpose**: SearchOverlay-style result row (w92 poster, title, year/type/rating) with an `actions` slot; `.srr-list` grid + `.srr__btn` round action in SearchResultRow.css.
* **Exports**: `SearchResultRow`

### `/frontend/src/hooks/useMediaQuery.js`
* **Purpose**: Live `matchMedia` hook.
* **Exports**: `useMediaQuery`

### `/frontend/src/pages/Feedback.jsx`
* **Purpose**: Core UI/Logic for Feedback.jsx.
* **Exports**: `function`

### `/frontend/src/pages/Help.jsx`
* **Purpose**: Core UI/Logic for Help.jsx.
* **Exports**: `function`

### `/frontend/src/pages/Home.jsx`
* **Purpose**: Home Page. Keeps a last-visit snapshot of the home bundle (trending, top rated, upcoming, trailers; default filter/region only) in `localStorage['mv_home_snapshot_v1']` for 24 h; a new tab paints it immediately and still fetches `/pages/home` in the background, replacing it silently (a failed refresh keeps the snapshot instead of showing the error page). Rails restored from `sessionStorage` are revalidated the same way, so community ratings don't stay frozen for the tab session.
* **Exports**: `function`

### `/frontend/src/pages/Intro.jsx`
* **Purpose**: Zero-backend landing page — projector-gate parallax hero, right-side vertical section rail, alternating feature cards, rating showcase, poster marquee. Renders from `/frontend/src/data/introSections.js`; no `movieService` calls.
* **Exports**: `function`

### `/frontend/src/data/introSections.js`
* **Purpose**: Content + placeholder-gradient visuals for Intro.jsx (hero layers, rail labels, feature cards, rating pills, poster wall). Edit here to change Intro copy/sections, not the JSX.
* **Exports**: `HERO_LAYERS`, `RAIL_SECTIONS`, `FEATURE_CARDS`, `RATING_PILLS`, `POSTER_WALL`

### `/frontend/src/hooks/useRatioObserver.js`
* **Purpose**: `prefersReducedMotion()` helper + `useRatioObserver` hook wrapping a 101-step-threshold `IntersectionObserver`, used by the Intro page's scroll-driven animation.
* **Exports**: `prefersReducedMotion`, `useRatioObserver`

### `/frontend/scripts/convert-assets.mjs`
* **Purpose**: One-off Node script (`npm run assets:webp`, never at build/runtime) that writes a resized `.webp` sibling next to every image in `frontend/src/assets/intro/`, `frontend/src/assets/intro/posters/`, `frontend/public/help_images/` and `frontend/src/assets/profile.jpeg`. Originals are kept. The Intro page and the Help page import only the `.webp` copies, so **this must be run before `npm run build` on a fresh checkout** or those imports will not resolve. Requires the `sharp` devDependency.
* **Exports**: none (script)

### `/frontend/scripts/download-intro-assets.mjs`
* **Purpose**: One-off Node script (run manually, never at build/runtime) that fetches textless hero/card/poster stills from TMDB into `frontend/src/assets/intro/` for the Intro page. Reads `TMDB_API_KEY` from `backend/.env`.
* **Exports**: none (script)

### `/frontend/src/pages/Login.jsx`
* **Purpose**: Login.jsx — Phase 3.5A
* **Exports**: `function`

### `/frontend/src/pages/MostInterested.jsx`
* **Purpose**: Core UI/Logic for MostInterested.jsx.
* **Exports**: `function`

### `/frontend/src/pages/MovieDetail.jsx`
* **Purpose**: MovieDetail Page — Phase 3.5C. Hero (poster + `movie-detail__head` + rating sidebar; mobile puts head beside poster via `display: contents`), local `CollectionTimeline` (franchise in release order, below Cast & Crew).
* **Exports**: `function`

### `/frontend/src/pages/MovieList.jsx`
* **Purpose**: MovieList Page — Phase 3.5C
* **Exports**: `function`

### `/frontend/src/pages/News.jsx`
* **Purpose**: News Page — /news. 4-column grid at home-strip card height (3/2/1 at 1200/900/560 px, mirrored by `useGridColumns`); per-visit `seed` reshuffles For You and category feeds; leftover cards are held back while pages remain, and the final row is topped up from Trending (or trimmed when nothing unshown remains)
* **Exports**: `function`

### `/frontend/src/pages/PersonPage.jsx`
* **Purpose**: PersonPage.jsx — Improvement 1.4
* **Exports**: `function`

### `/frontend/src/pages/Privacy.jsx`
* **Purpose**: Core UI/Logic for Privacy.jsx.
* **Exports**: `function`

### `/frontend/src/pages/Recommendations.jsx`
* **Purpose**: Core UI/Logic for Recommendations.jsx.
* **Exports**: `function`

### `/frontend/src/pages/RecommendationsContent.jsx`
* **Purpose**: Content DNA basket page (Phase 3, `plans/dna.md`). WIP banner + fake mock-node animation removed; real server-side filters/sort (media type, genres, countries, studios, year, rating) sent to the API and narrowed over the full ranked pool, not the 20 on-screen items. Negative "less like this" chip row (`negBasket`) and an "Ignore my taste" personalization toggle (`ignoreTaste`) feed into `movieService.getContentBasketRecommendations()`. Renders the `dna` fingerprint payload (keywords/genres/language/media-type purity) as a precision meter, and top-2 `why` chips under each result card.
* **Exports**: `function`

### `/frontend/src/pages/Register.jsx`
* **Purpose**: Register.jsx — Phase 3.5A
* **Exports**: `function`

### `/frontend/src/pages/Search.jsx`
* **Purpose**: Search.jsx — Search results page with Infinite Scroll
* **Exports**: `function`

### `/frontend/src/pages/TermsOfService.jsx`
* **Purpose**: Core UI/Logic for TermsOfService.jsx.
* **Exports**: `function`

### `/frontend/src/pages/TVDetail.jsx`
* **Purpose**: TVDetail.jsx — Improvement 1.7
* **Exports**: `function`

### `/frontend/src/pages/WatchlistDetail.jsx`
* **Purpose**: Collection page — filter rail / mobile bottom sheet (sort, quick picks, type, rating, OTT), uploadable cover banner, shared MovieCard grid (same cards and breakpoints as /explore), OTT filter matched on TMDB provider ids, sessionStorage SWR cache.
* **Exports**: `function`

### `/frontend/src/pages/settings/Settings.jsx`
* **Purpose**: Settings shell. `NAV_GROUPS` drives the desktop sticky sidebar and, on phones (≤768px), an index list at `/settings` plus a sticky "← Settings" sub-header on subpages. Settings.css also holds the shared form/table/dropzone primitives the subpages use.
* **Exports**: `Settings`

### `/frontend/src/pages/settings/SettingsDeleteAccount.jsx`
* **Purpose**: Core UI/Logic for SettingsDeleteAccount.jsx.
* **Exports**: `SettingsDeleteAccount`

### `/frontend/src/pages/settings/SettingsFeedback.jsx`
* **Purpose**: Core UI/Logic for SettingsFeedback.jsx.
* **Exports**: `function`

### `/frontend/src/pages/settings/SettingsHelp.jsx`
* **Purpose**: Core UI/Logic for SettingsHelp.jsx.
* **Exports**: `SettingsHelp`

### `/frontend/src/pages/settings/SettingsImport.jsx`
* **Purpose**: CSV import (`title,type,year,rating`; rating optional) with template download and preview.
* **Exports**: `SettingsImport`

### `/frontend/src/pages/settings/SettingsExport.jsx`
* **Purpose**: `/settings/export` — download CSV list (`settingsService.exportList`) or AI-ready JSON (`settingsService.exportFull`).
* **Exports**: `SettingsExport`

### `/frontend/src/pages/settings/SettingsMyIssues.jsx`
* **Purpose**: Core UI/Logic for SettingsMyIssues.jsx.
* **Exports**: `function`

### `/frontend/src/pages/settings/SettingsPassword.jsx`
* **Purpose**: Core UI/Logic for SettingsPassword.jsx.
* **Exports**: `SettingsPassword`

### `/frontend/src/pages/settings/SettingsPrivacy.jsx`
* **Purpose**: Core UI/Logic for SettingsPrivacy.jsx.
* **Exports**: `SettingsPrivacy`

### `/frontend/src/pages/settings/SettingsProfile.jsx`
* **Purpose**: Core UI/Logic for SettingsProfile.jsx.
* **Exports**: `SettingsProfile`

### `/frontend/src/pages/settings/SettingsTerms.jsx`
* **Purpose**: Core UI/Logic for SettingsTerms.jsx.
* **Exports**: `SettingsTerms`

### `/frontend/src/services/authService.js`
* **Purpose**: authService.js — Auth API service (Phase 3.5A)
* **Exports**: `authService`

### `/frontend/src/services/feedbackService.js`
* **Purpose**: The single client for every thumbs / click signal and for news feedback. Goes through the shared axios instance — it used to hand-roll `fetch` against `VITE_API_URL` with a manually attached token, missing the 401 -> refresh -> retry queue, the 120 s timeout Azure cold starts need, the secondary-URL failover and the crawler block. Clicks are queued and flushed to `POST /rec-feedback/batch` every 2 s (and on `pagehide` / `visibilitychange`), deduped by signal + item so a double-tap is one row; explicit thumbs post immediately. Dismissed ids are kept in a session-backed `Set`, so a removed card does not reappear on back-navigation before the server pool refreshes. Every call resolves — a lost signal must never surface as an error.
* **Exports**: `sendRecSignal()`, `recFeedback`, `sendNewsSignal()`, `newsFeedback`, `isDismissed()`, `filterDismissed()`

### `/frontend/src/services/movieService.js`
* **Purpose**: movieService.js — API service layer (Phase 2C)
* **Exports**: `movieService`

### `/frontend/src/services/newsService.js`
* **Purpose**: newsService.js — News API service layer
* **Exports**: `newsService`

### `/frontend/src/services/notificationService.js`
* **Purpose**: Get recent notifications.
* **Exports**: `notificationService`

### `/frontend/src/services/pageService.js`
* **Purpose**: Page-bundle API wrappers — `getHome`, `getMovie`, `getTV`, `getPerson`, `getDashboard`. Each returns everything a page renders on mount in one request (backed by one Redis key). `getMovie`/`getTV` first consume `window.__mvEarlyPage`, the bundle request an inline script in `frontend/index.html` starts before the JS loads on a direct load of `/movies/:id` or `/tv/:id` (and which also preloads the backdrop); any early failure retries through `api.js`. Used by `Home.jsx`, `MovieDetail.jsx`, `TVDetail.jsx`, `PersonPage.jsx`, `Dashboard.jsx`.
* **Exports**: `pageService`, default

### `/frontend/src/services/planToWatchService.js`
* **Purpose**: Core UI/Logic for planToWatchService.js.
* **Exports**: `planToWatchService`

### `/frontend/src/services/ratingService.js`
* **Purpose**: ratingService.js — Phase 3.5C
* **Exports**: `ratingService`

### `/frontend/src/services/searchService.js`
* **Purpose**: searchService.js — Search API service (Phase 3.5B)
* **Exports**: `searchService`

### `/frontend/src/services/settingsService.js`
* **Purpose**: Core UI/Logic for settingsService.js.
* **Exports**: `settingsService`

### `/frontend/src/services/tempTrackerService.js`
* **Purpose**: Core UI/Logic for tempTrackerService.js.
* **Exports**: `tempTrackerService`

### `/frontend/src/services/trailerService.js`
* **Purpose**: Core UI/Logic for trailerService.js.
* **Exports**: `getHomeTrailers`

### `/frontend/src/services/userService.js`
* **Purpose**: Core UI/Logic for userService.js.
* **Exports**: `userService`

### `/frontend/src/services/watchingTrackerService.js`
* **Purpose**: Track a TV show.
* **Exports**: `watchingTrackerService`

### `/frontend/src/pages/TierList.jsx`
* **Purpose**: `/tierlist` — template catalogue on the frosted-glass surface the about page uses. Hero is a live, draggable 3-row mini board seeded from the catalogue's own cover posters; sticky category rail; template cards built from a fan of three real posters that opens on hover.
* **Notes**: Caches the catalogue response and the chosen category in `sessionStorage` (`tierlist_catalogue_v1`, `tierlist_filters_v1`) so the page comes back full-height and identically filtered, which is what lets the global `ScrollRestore` put the scroll position back.
* **Exports**: `TierList` (default)

### `/frontend/src/pages/TierBoard.jsx`
* **Purpose**: The maker — board on the left, bin on the right in `.tierboard-layout`, each scrolling on its own. One component in four modes — `blank`, `template`, `saved`, `share` — behind `/tierlist/new`, `/tierlist/t/:slug`, `/tierlist/my/:id`, `/tierlist/s/:shareId`.
* **Exports**: `TierBoard` (default)
* **Notes**: Autosaves a guest draft to `mv_tier_draft_<mode>_<id>`; a draft is only restored once something has actually been ranked, and it is merged against the current template rather than replacing it.

### `/frontend/src/components/tierlist/`
* **Purpose**: `TierRow.jsx` (label block, drop zone, controls), `TierTile.jsx` (one draggable item), `TierBin.jsx` (the unranked tray), `RowSettings.jsx` (portalled rename/recolour popover), `AddTitlesModal.jsx` (two tabs over one catalogue search: titles into the bin, or a title's characters with Top 20 / Select all).

### `/frontend/src/hooks/useTierDrag.js`
* **Purpose**: Pointer-event drag engine — one code path for mouse, touch and pen, no dependency. HTML5 drag-and-drop does not fire on touch at all.
* **Exports**: `useTierDrag` (named + default)

### `/frontend/src/utils/tierExport.js`
* **Purpose**: Renders a board to a PNG on a canvas, no screenshot library.
* **Exports**: `renderBoardToBlob()`, `downloadBoard()`
* **Notes**: Stamps the Movientum logo (`/logo.png`) and a CC BY 4.0 line into the bottom-right of the export. Fetches posters at `?cors=1` first — the plain URLs are already in the cache without CORS headers from the rest of the app, and reusing those taints the canvas.

### `/frontend/src/utils/tierPresets.js`
* **Purpose**: Row presets (Classic S–F, Movientum's own rating vocabulary, three buckets, top five), swatches, and the `<media>:<id>` item key helpers.
* **Exports**: `PRESETS`, `ROW_COLORS`, `makeRowId()`, `rowsFromPreset()`, `itemKey()`, `parseItemKey()`

### `/frontend/src/utils/tierUploads.js`
* **Purpose**: Device-local tile pictures. Downscales an uploaded image, stores it in IndexedDB, and resolves the short `upload:<key>` reference a board carries in place of a TMDB path (the save schema caps `image` at 300 chars, so the picture cannot travel with the board).
* **Exports**: `UPLOAD_PREFIX`, `isUploadRef`, `uploadUrl`, `putUpload`, `hydrateUploads`, `fileToTileImage`, `newUploadRef`

### `/frontend/src/utils/tierImages.js`
* **Purpose**: Poster URL builder for tier tiles, kept out of the component file so fast refresh works. Absolute URLs (baked character art) pass through untouched.
* **Exports**: `tileImageUrl()`, `fullImageUrl()`, `isAbsoluteUrl()`

### `/frontend/src/services/tierListService.js`
* **Purpose**: Tier-list API wrappers, including `getShowCharacters(media, tmdbId)` for the picker's Characters tab.
* **Exports**: `tierListService`

### `/frontend/src/services/watchlistService.js`
* **Purpose**: GET /api/v1/watchlists — list user collections
* **Exports**: `watchlistService`

### `/frontend/src/services/watchService.js`
* **Purpose**: watchService.js — Phase 3.5C
* **Exports**: `watchService`

### `/frontend/src/utils/analytics.js`
* **Purpose**: Core UI/Logic for analytics.js.
* **Exports**: `getQueue`, `setQueue`, `trackPageView`, `trackEvent`, `track`

### `/frontend/src/utils/api.js`
* **Purpose**: api.js — Axios instance (Phase 3.5A)
* **Exports**: `api` (default), `BASE_URL` (primary API base, also used to resolve API-relative upload paths)

### `/frontend/src/utils/deviceId.js`
* **Purpose**: Core UI/Logic for deviceId.js.
* **Exports**: `getOrCreateDeviceId`, `getDeviceId`, `clearDeviceId`

### `/frontend/src/utils/googleIdentity.js`
* **Purpose**: Loads and initialises Google Identity Services (injects the GIS script once, memoised). Deliberately dependency-free — no `@react-oauth/google`.
* **Exports**: `loadGoogleIdentity`

### `/frontend/src/utils/ottLinks.js`
* **Purpose**: Maps a TMDB watch provider (by provider_id, then by normalised name, then by reseller suffix such as "… Amazon Channel") to that platform's own search URL with the title pre-filled, so each row in the "Watch Online" block goes to the provider instead of TMDB's shared redirect page. Providers with no verified search path fall back to the TMDB link.
* **Exports**: `resolveOttLink`

### `/frontend/src/utils/avatar.js`
* **Purpose**: Single source for user avatar URLs. Uploaded/Google photo when present; otherwise one of 20 gender-neutral emoji SVGs in `frontend/public/avatars/` (DiceBear Fun Emoji, CC BY 4.0, see `CREDITS.md`), chosen by FNV-1a hash of user id so it stays stable across pages/devices. `avatarFallback` swaps a broken photo to the default. Used by Navbar, Dashboard, Settings, SettingsProfile, WatchlistDetail.
* **Exports**: `getDefaultAvatar`, `getAvatarUrl`, `avatarFallback`

### `/frontend/src/utils/pageCache.js`
* **Purpose**: Core UI/Logic for pageCache.js.
* **Exports**: `pageCache`

### `/frontend/src/utils/storage.js`
* **Purpose**: storage.js — Unified Storage Utility (Remember Me support)
* **Exports**: `storage`, `storage`

### `/backend/app/utils/storage.py`
* **Purpose**: Supabase Storage helpers — off-loop WebP re-encode, public upload, best-effort delete (watchlist covers).
* **Exports**: `encode_webp`, `upload_public`, `remove_public_url`, `is_configured`

<!-- updated 2026-09-27: entries below added for files that existed on disk but were missing from the map -->

### `/backend/app/routers/admin.py`
* **Purpose**: `/api/v1/admin` — admin-only stats and analytics, plus user management for `AdminDashboard.jsx`'s Users tab (list/delete/change role/message; an admin cannot target their own account). The `/tasks/*` Celery trigger flow is legacy and unused by the live UI.
* **Exports**: `get_admin_stats()`, `get_admin_analytics()`, `trigger_admin_task()`, `stop_admin_task()`, `get_task_status()`, `UserRoleUpdateRequest`, `UserMessageRequest`

### `/backend/app/routers/ai_recs.py`
* **Purpose**: `/api/v1/ai-recs` — Gemini/Groq AI recommendations (`POST /similar`) and per-user AI-pick thumbs memory (`GET`/`POST /memory`; a write also feeds the shared feedback worker with `source="ai_recommendations"`).
* **Exports**: `get_ai_similar()`, `get_memory()`, `record_memory()`

### `/backend/app/routers/contact.py`
* **Purpose**: `/api/v1/contact` — public Contact form submit (notifies all admins); admin-only list for the admin Messages tab.
* **Exports**: `submit_contact_message()`, `list_contact_messages()`

### `/backend/app/schemas/ai_recs.py`
* **Purpose**: AI recommendation request/response and memory shapes.
* **Exports**: `AIRecSimilarRequest`, `AIRecSimilarItem`, `AIRecSimilarResponse`, `AIRecMoreLikeItem`, `AIRecMemoryRequest`, `AIRecMemoryItem`, `AIRecMemoryResponse`

### `/backend/app/schemas/contact.py`
* **Purpose**: Contact form shapes.
* **Exports**: `ContactCreate`, `ContactResponse`

### `/backend/app/services/ai_rec_service.py`
* **Purpose**: LLM recommendations — builds guest/personalized prompts from the seed title (+ taste profile and AI memory), calls Gemini (`gemini-flash-latest`) off-loop, falls back through `GROQ_FALLBACK_MODELS`, repairs JSON, resolves each suggestion to a TMDB title.
* **Exports**: `AIRecService`

### `/backend/app/services/notification_service.py`
* **Purpose**: Writes `notifications` rows — to one user or to every admin (`type` = `episode` | `admin_contact` | `admin_feedback` | `admin_message`).
* **Exports**: `notify_user()`, `notify_admins()`

### `/backend/app/services/dna/idf.py`
* **Purpose**: DNA engine — document-frequency / IDF table over catalog features.
* **Exports**: `feature_keys()`, `IdfTable`, `build_idf_table()`, `to_jsonable()`, `from_jsonable()`

### `/backend/app/services/dna/profile.py`
* **Purpose**: DNA engine — merges basket titles into one weighted `BasketProfile` (dominant language/type, coherence).
* **Exports**: `BasketProfile`, `build_profile()`, `compute_coherence()`

### `/backend/app/services/dna/retrieval.py`
* **Purpose**: DNA engine Stage A — inverted-index candidate recall (min 200 candidates, vote_count ≥ 20, per-facet feature caps).
* **Exports**: `InvertedIndex`, `build_inverted_index()`, `recall_candidates()`, `recall_with_backfill()`

### `/backend/app/services/dna/scoring.py`
* **Purpose**: DNA engine Stage B — facet cosine (keyword 0.30, genre 0.22, crew 0.12, cast 0.10, studio 0.06) + graph 0.12 + quality/pop, language/type/era gates, MMR diversity. Pure functions.
* **Exports**: `ScoringParams`, `facet_cosine()`, `gate()`, `gate_any()`, `era_gate()`, `bayesian_quality()`, `popularity_score()`, `score_candidate()`, `sim_content()`, `mmr_select()`

### `/backend/app/services/dna/graph_rwr.py`
* **Purpose**: DNA engine — bounded per-seed Personalized PageRank, cached per title (24 h).
* **Exports**: `rwr_vector()`, `basket_rwr_scores()`

### `/backend/app/services/dna/service.py`
* **Purpose**: DNA engine orchestration — IDF/index warm-up, rank-once/slice-many pagination (300-item order cached 30 min), server-side filters and sort, taste blend (`ignore_taste` opt-out), negative basket, fingerprint + why chips. Powers `POST /recommendations/content`.
* **Exports**: `get_dna_recommendations()`, `get_idf_and_index()`, `invalidate_idf()`, `catalog_to_features()`, `features_to_payload()`

### `/backend/app/tasks/nightly_job.py`
* **Purpose**: Celery task chaining the nightly steps in the same order as `routers/internal.py` `NIGHTLY_STEPS`: expire trailers → TMDB sync → ranker retrain → news title index → episode check → refresh trailers. News Daily Fetch is excluded.
* **Exports**: `run_all_nightly_jobs()`

### `/backend/app/utils/progress.py`
* **Purpose**: In-process, thread-safe progress/cancel state for admin-triggered background tasks (read by `/internal/progress/{task}`). Not watch progress.
* **Exports**: `set_progress()`, `get_progress()`, `cancel_task()`, `should_cancel()`, `clear_cancel_flag()`

### `/frontend/src/components/AIRecommendations.jsx`
* **Purpose**: AI picks panel on detail pages — rerun, focus genre, "more like these", thumbs (one request to `/ai-recs/memory`).
* **Exports**: `AIRecommendations`

### `/frontend/src/components/AdminAnalytics.jsx`
* **Purpose**: Analytics widgets for the admin dashboard.
* **Exports**: `AdminAnalytics`

### `/frontend/src/components/tierlist/*.jsx`
* **Purpose**: Tier board parts — `TierRow` (label, drop zone, gear/reorder), `TierTile` (draggable button), `TierBin` (unranked tray), `RowSettings` (portalled rename/recolour/insert/delete popover), `AddTitlesModal` (titles or a title's characters).
* **Exports**: `TierRow`, `TierTile`, `TierBin`, `RowSettings`, `AddTitlesModal`

### `/frontend/src/pages/AdminPage.jsx`
* **Purpose**: Dead code — not routed; superseded by `AdminDashboard.jsx`.
* **Exports**: `AdminPage`

### `/frontend/src/pages/analysis/*`
* **Purpose**: `/analysis` sections — `TasteFingerprint`, `TasteProfile`, `TuneProfile` (edit weights), `EngineXray` (seeds, pools, ranker status), `FeedbackCenter` + `SignalTimeline`, `Habits`, `LibraryHighlights`; `SectionRail` layout helpers; `analysisUtils.js` formatting + `SIGNAL_META`/`POOL_META`.
* **Exports**: `TasteFingerprint`, `TasteProfile`, `TuneProfile`, `EngineXray`, `FeedbackCenter`, `SignalTimeline`, `Habits`, `LibraryHighlights`, `SectionRail`, `Section`, `SectionSkeleton`, `EmptyNote`

### `/frontend/src/services/adminService.js`
* **Purpose**: Admin API calls — stats, analytics, contact messages, users (list/delete/role/message).
* **Exports**: `adminService`

### `/frontend/src/services/aiRecsService.js`
* **Purpose**: AI recommendations API layer (`/ai-recs/similar`, `/memory`).
* **Exports**: `aiRecsService`

### `/frontend/src/services/contactService.js`
* **Purpose**: Public Contact form submit (`POST /api/v1/contact`).
* **Exports**: `contactService`

### `/frontend/src/utils/burstEffect.js`
* **Purpose**: Small particle-burst animation for confirmed actions (watched, plan to watch, add to watchlist). Visual only.
* **Exports**: `fireBurst`

### `/frontend/src/utils/sharedObserver.js`
* **Purpose**: One pooled IntersectionObserver per options signature instead of one per card.
* **Exports**: `observeOnce`

### `/frontend/src/__harness/main.jsx`
* **Purpose**: TEMP visual harness for `/analysis` with mock data, loaded by `frontend/an-harness.html`. Marked for deletion after use.
* **Exports**: —

### `/backend/scripts/*.py` (not individually listed above)
* **Purpose**: `seed_catalog.py` (TMDB → `content_catalog`), `seed_movies.py`, `append_india_catalog.py`, `ingest_search_index.py` (rebuild `search_vector`), `load_ratings.py`, `load_movie_ratings_2026.py` / `load_tv_ratings*.py` (rating-meter seeds), `bust_moctale_cache.py` (clear Redis payloads embedding the Moctale meter after a bulk ratings write), `ingest_missing_rated.py` (TMDB-ingest titles from a ratings CSV into `movies` so the `movie_ratings`/`tv_ratings` FK accepts them), `migrate_and_load.py`, `create_admin.py`, `clear_category_cache.py`, `generate_dashboards.py` (Grafana JSON), `test_app_insights.py`, `check_settings.py`, `check_fks.py`, `test_guest_recs.py`, `test_indian_content.py`, `update_recs.py`, `update_router.py`.

### `/backend/debug/*.py` (not individually listed above)
* **Purpose**: DNA harness (`dna_offline.py`, `dna_build_baskets.py`, `scratch_dna_eval.py`, `scratch_dna_sweep.py`, `scratch_dna_ab.py`, `scratch_dna_smoke.py`, `scratch_dna_aot_vinland.py`); ranker/feedback checks (`scratch_ranker_labels.py`, `scratch_feedback_concurrency.py`, `scratch_feedback_universal.py`, `scratch_rebuild_all_profiles.py`, `scratch_feed_rotation.py`, `scratch_rec_tuning.py`, `scratch_similar_rank.py`, `scratch_analysis_engine.py`); search (`scratch_search_golden.py`, `scratch_bench_search.py`, `scratch_test_search*.py`); latency (`scratch_page_latency.py`, `scratch_bench_tmdb.py`, `test_watch_*latency.py`, `test_httpx_conn.py`); news (`scratch_news_feedback.py`, `scratch_news_for_title.py`, `cleanup_redis_news.py`); trailers (`scratch_trailer_ingest.py`, `scratch_trailer_refresh_all.py`); cache clearing (`scratch_clear_*.py`); tier seed (`scratch_tier_seed.py`); one-off endpoint/record probes (`scratch_test_*.py`, `scratch_inspect_*.py`, `scratch_find_*.py`, `scratch_check_*.py`).
