# Documentation Guide

Start here. This page tells you which document answers which question, and in what order to read them.

## If you have 10 minutes

1. `architecture/system_architecture.md` — what Movientum is made of and how a request flows.
2. `ml_and_recommendations/recommendation_engine_overview.md` — how recommendations work.
3. `workflows_and_integration/general_workflows.md` — what happens when a user does each thing.

## If you are going to write code

1. `workflows_and_integration/final_development_workflow.md` — setup, rules, how to verify.
2. `architecture/backend_architecture.md` and `architecture/frontend_architecture.md` — folder layout.
3. `infrastructure_and_ops/redis_caching.md` — the caching pattern every endpoint follows.
4. The feature doc for whatever you are touching.

## Every document

### `architecture/` — how the system is built

| File | Read it to learn |
|---|---|
| `system_architecture.md` | The big picture: parts, hosts, outside services, design choices, background jobs |
| `backend_architecture.md` | Router → service → repository layers, folder guide, code rules, startup |
| `frontend_architecture.md` | React folders, the HTTP client (refresh, failover), token storage, speed tricks |
| `database_architecture.md` | Tables by purpose, the `(id, type)` rule, where the schema is defined |
| `configuration_design.md` | How settings are loaded and the list of env variables |
| `multi_server_architecture.md` | Which host runs what, backend failover, deploy commands |
| `scalability_planning.md` | Performance techniques used and the limits that cannot be fixed |
| `storage_estimation.md` | What grows in PostgreSQL, Redis, memory and disk |

### `features/` — one feature per file

| File | Read it to learn |
|---|---|
| `authentication_system.md` | Email, Google and device login; tokens; logout blacklist; admin check |
| `ratings_and_reviews.md` | The four-word rating system and the rating meter |
| `search_and_filtering.md` | How search ranks results; Explore filters and franchise pages |
| `watchlist_feature.md` | Collections vs. the old single watchlist; how saving affects recommendations |
| `news_integration.md` | How news is fetched, enriched, stored in Redis, and personalised |
| `tier_lists.md` | Templates, character sources, saving and sharing boards |
| `trailers_notifications_admin.md` | Trailer row, notifications, contact form, bug reports, admin panel, analysis page |

### `ml_and_recommendations/` — the AI core

| File | Read it to learn |
|---|---|
| `recommendation_engine_overview.md` | Similar items and For You step by step, graph weights, ranker, AI picks |
| `feedback_loop.md` | How thumbs, clicks, watching and saving change a user's taste; suppression |
| `content_based_recommendations.md` | Content DNA basket engine and its offline evaluation |
| `mlflow_tracking.md` | Nightly ranker retraining and the approval gate (no MLflow despite the name) |

### `infrastructure_and_ops/` — running it

| File | Read it to learn |
|---|---|
| `redis_caching.md` | Cache pattern, key rules, page bundles, every TTL, news keys |
| `docker_setup.md` | Dockerfile, local compose stack, deploy, Celery schedule |
| `grafana_dashboards.md` | App Insights metrics, Grafana, health check |

### `workflows_and_integration/` — putting it together

| File | Read it to learn |
|---|---|
| `general_workflows.md` | Step-by-step user journeys (login, open a title, rate, search, feedback, tier list, admin job) |
| `system_integration_guide.md` | How every component connects: frontend, PostgreSQL, Redis, TMDB, LLMs, news, Celery |
| `final_development_workflow.md` | Developer guide: run locally, code rules, performance rules, verification, deploy |
| `data_fetching_scripts.md` | Seed, import, operations and debug scripts |

### `misc_and_ui/` — reference

| File | Read it to learn |
|---|---|
| `website_overview.md` | Every page/route, which need login, shared UI pieces |
| `api_endpoints_list.md` | Every backend router and its endpoints, with auth |
| `movientum_presentation.pdf` | Slide deck about the project |

`movientum.pdf` in this folder is the project report.

## Find by question

| Question | Go to |
|---|---|
| Why are recommendations what they are? | `recommendation_engine_overview.md`, then `feedback_loop.md` |
| Why is this page slow? | `scalability_planning.md` (cold start, Upstash eviction first), then `redis_caching.md` |
| Where is endpoint X? | `api_endpoints_list.md` |
| Which table stores Y? | `database_architecture.md` |
| How do I add a scheduled/admin job? | `trailers_notifications_admin.md` (admin section), `docker_setup.md` (schedule) |
| Why is news not in the database? | `news_integration.md` |
| How do I test my change? | `final_development_workflow.md` §5 |

## Deeper references outside this folder

- `AI_Context/` — file-by-file and function-by-function maps (`FILE_MAP.md`, `ROUTES.md`, `SERVICES.md`, `DATABASE.md`, `API_MAP.md`, `FLOWS.md`).
- `map.md` — generated index of every file and its exports.
- `plans/` — design documents. Many describe intent rather than shipped code; check the source.
- `fedpcl/` — separate research project, not part of the app.
