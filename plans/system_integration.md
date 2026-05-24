# System Integration — Movientum

## Overview

This document explains how every Movientum component connects to every other component. Not what each component does (see individual docs) — but HOW they talk, through what interface, with what data format, and in what sequence.

---

## Full Component Map

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         MOVIENTUM PLATFORM                                │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │                    NGINX / API GATEWAY                               │ │
│  │   SSL │ CORS │ Rate Limit │ Routing │ Load Balance                   │ │
│  └────────────────────────────┬────────────────────────────────────────┘ │
│                               │                                           │
│  ┌────────────┐   HTTP JSON   │   HTTP JSON    ┌──────────────────────┐  │
│  │  REACT     │◄─────────────┼────────────────│   FASTAPI BACKEND    │  │
│  │  FRONTEND  │──────────────┼────────────────►│                     │  │
│  │            │  with JWT     │                │  ┌─────────────┐    │  │
│  └────────────┘               │                │  │   ROUTERS   │    │  │
│                               │                │  └──────┬──────┘    │  │
│                               │                │         │           │  │
│                               │                │  ┌──────▼──────┐    │  │
│                               │                │  │   SERVICES  │    │  │
│                               │                │  └──────┬──────┘    │  │
│                               │                │         │           │  │
│                               │                │  ┌──────▼──────┐    │  │
│                               │                │  │    REPOS    │    │  │
│                               │                │  └──────┬──────┘    │  │
│                               │                └─────────┼────────────┘  │
│                               │                          │               │
│                    ┌──────────┼──────────────────────────┼──────┐       │
│                    │          │          DATA LAYER       │      │       │
│                    │          │                           │      │       │
│             ┌──────▼──────┐  │                    ┌──────▼──────┐      │
│             │  POSTGRESQL │  │                    │    REDIS    │      │
│             │  (Primary   │  │                    │  (Cache)    │      │
│             │   Data)     │  │                    └─────────────┘      │
│             └─────────────┘  │                                          │
│                               │                                          │
│  ┌────────────────────────────┼──────────────────────────────────────┐  │
│  │                    EXTERNAL SERVICES                               │  │
│  │  ┌─────────┐  ┌──────────┐│  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │  TMDB   │  │ NewsAPI  ││  │  MLflow  │  │  Celery + Redis  │  │  │
│  │  │  API    │  │          ││  │ Tracking │  │  (Task Queue)    │  │  │
│  │  └─────────┘  └──────────┘│  └──────────┘  └──────────────────┘  │  │
│  └────────────────────────────┘                                          │
│                                                                           │
│  ┌───────────────────────────────────────────────────────────────────┐   │
│  │                    FEDPCL MODULE                                   │   │
│  │  Server: Aggregation + Clustering + Model Store                    │   │
│  │  Client: Local Training (Browser) ◄────► Server API               │   │
│  └───────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## Integration 1: Frontend → API Gateway → Backend

### Communication Protocol
- **Protocol**: HTTPS (TLS 1.3)
- **Format**: JSON (request body + response body)
- **Auth**: Bearer JWT token in `Authorization` header
- **Versioning**: `/api/v1/` prefix on all endpoints

### Request Pattern

```
Frontend service layer calls:
  movieService.getMovieById(123)
    → builds request: GET /api/v1/movies/123
    → attaches header: Authorization: Bearer {token}
    → sends via fetch/axios
  
API Gateway (Nginx):
  → validates origin (CORS)
  → checks rate limit (not exceeded)
  → routes to backend:8000
  → strips/adds headers
  
FastAPI Backend:
  → Auth Middleware validates JWT
  → Router matches path
  → Service executes
  → Returns JSON
  
Frontend:
  → Receives JSON
  → Updates React state
  → Re-renders components
```

### Data Format Standard

All API responses follow:
```json
{
  "data": { ... },          // success payload
  "meta": {                 // pagination, totals
    "page": 1,
    "total": 532,
    "per_page": 20
  }
}
```

Or error:
```json
{
  "error": "MOVIE_NOT_FOUND",
  "message": "No movie with id 999",
  "status_code": 404
}
```

Frontend always checks for `error` key before accessing `data`.

---

## Integration 2: Backend → PostgreSQL

### Connection
- Via SQLAlchemy ORM (async mode: `asyncpg` driver)
- Connection pool managed by SQLAlchemy (pool_size=10, max_overflow=20)
- In Docker: host=`postgres`, port=`5432`, db=`movientum`

### Query Patterns

**Sync flow (blocking the request):**
```
router.get_movie(id=123)
  → service.get_movie_by_id(123)
  → repo.find_by_id(123)
  → await db.execute(SELECT * FROM movies WHERE id=123)
  → returns Movie object
```

**Async flow (background, doesn't block response):**
```
router.post_rating(...)
  → 1. service.create_rating(...)  ← awaited (blocks until DB write complete)
  → return 201 to user
  → 2. background_tasks.add_task(invalidate_recommendation_cache, user_id)
  → 3. background_tasks.add_task(update_fedpcl_interaction_log, user_id, movie_id)
  (2 and 3 run after response is sent)
```

### ORM ↔ DB Mapping

```
Movie ORM model → movies table
Rating ORM model → ratings table
User ORM model → users table
WatchHistory ORM model → watch_history table
```

ORM handles: parameterized queries, SQL injection prevention, type casting, relationship loading (via JOIN or lazy loading).

Alembic manages schema migrations. No manual `ALTER TABLE` in production.

---

## Integration 3: Backend → Redis Cache

### Connection
- Via `redis.asyncio` Python client
- In Docker: host=`redis`, port=`6379`
- DB 0: application cache
- DB 1: Celery task broker

### Cache Interaction Pattern

```
service.get_movie_by_id(123):
  
  1. cache_key = "movie:detail:123"
  2. cached = await redis.get(cache_key)
  3. IF cached:
       return json.loads(cached)    ← fast path, no DB
  4. ELSE:
       movie = await repo.find_by_id(123)    ← DB query
       await redis.setex(cache_key, 3600, json.dumps(movie))  ← cache 1hr
       return movie
```

### Cache Invalidation Events

| Event | Keys Invalidated |
|-------|----------------|
| Movie DB record updated | `movie:detail:{id}` |
| User rates/watches a movie | `user:recommendations:{user_id}` |
| New FedPCL model deployed | `user:recommendations:*` (all users) |
| Trending list rebuilt | `movie:trending:*` |
| New news batch fetched | `news:feed:*` |

---

## Integration 4: Backend → External APIs (TMDB, NewsAPI)

### TMDB Integration

```
Trigger: Movie detail requested, not in DB OR data is stale
  │
  ├── Backend service: movie_service.fetch_from_tmdb(movie_id)
  │
  ├── HTTP GET https://api.themoviedb.org/3/movie/{id}
  │     headers: Authorization: Bearer {TMDB_API_KEY}
  │     timeout: 10 seconds
  │
  ├── Response parsed → validated → domain object created
  │
  ├── Stored to PostgreSQL (movies table)
  │
  └── Cached in Redis (1hr TTL)
```

**Error handling:**
- TMDB 429 (rate limited) → exponential backoff (2s, 4s, 8s) then retry
- TMDB 503 (down) → return stale DB data, log error, alert monitoring
- TMDB 404 (movie not found) → return null, log, don't store

### NewsAPI Integration

```
Trigger: Celery cron every 2 hours
  │
  ├── celery_worker.fetch_global_news()
  │
  ├── HTTP GET https://newsapi.org/v2/everything
  │     params: q="movies OR cinema OR film", pageSize=50, language=en
  │     headers: X-Api-Key: {NEWS_API_KEY}
  │
  ├── Filter articles (has image, not duplicate, not too old)
  │
  ├── Insert new articles to news_articles table
  │
  └── Invalidate news cache keys in Redis
```

---

## Integration 5: Backend → Celery (Background Tasks)

### Connection
- Celery uses Redis DB 1 as message broker
- Celery workers run as separate Docker container (same backend image, different command)

### Task Flow

```
Backend (producer):
  from app.celery import celery_app
  celery_app.send_task("tasks.fetch_news")

Redis Broker (message bus):
  Stores task message in queue

Celery Worker (consumer):
  Picks up task from queue
  Executes: fetch_news()
  Result stored in Redis (or discarded)
```

### Registered Tasks

| Task Name | Trigger | What it Does |
|-----------|---------|-------------|
| `tasks.fetch_news` | Cron 2hr | Fetch global news from NewsAPI |
| `tasks.invalidate_rec_cache` | After user rates/watches | Redis delete `user:recommendations:{id}` |
| `tasks.sync_trending` | Cron 30min | Rebuild trending movie cache |
| `tasks.fedpcl_start_round` | Cron bi-weekly | Initiate new FedPCL training round |
| `tasks.rebuild_item2users` | After new user joins | Update FedPCL inverted index |

---

## Integration 6: Backend → FedPCL Module

The FedPCL module is a sub-system within the FastAPI backend (not a separate service at MVP).

### Server-Side FedPCL Integrations

**FedPCL reads from DB:**
```
fedpcl_server.start_round():
  → SELECT user_id, movie_ids FROM watch_history GROUP BY user_id
  → SELECT user_id, movie_id FROM ratings WHERE overall_score >= 6.0
  → Builds train_dict: {user_id: [movie_ids]}
  → Builds item2users: {movie_id: [user_ids]}
```

**FedPCL writes to DB:**
```
After round aggregation:
  → INSERT INTO fedpcl_models (version, E_global_bytes, hr10, ndcg10, created_at)
  → INSERT INTO fedpcl_clusters (version, cluster_id, E_cluster_bytes) × K
  → UPDATE user_cluster_assignments SET cluster_id = ... WHERE user_id = ...
```

**FedPCL reads from DB for serving:**
```
recommendation_service.get_recommendations(user_id):
  → SELECT cluster_id FROM user_cluster_assignments WHERE user_id = ...
  → Load E_global from memory (pre-loaded at startup)
  → Load E_cluster[k] from memory
  → E_personal = 0.5 × E_cluster[k] + 0.5 × E_global
  → Load user_emb[user_id] from user_embeddings table
  → scores = e_u @ E_personal.T
  → filter + sort → return top 20
```

### Client-Side FedPCL API (Browser ↔ Backend)

```
Client browser calls:
  GET /api/v1/fedpcl/round/status
    → Returns: {round_id, is_active, config}
  
  GET /api/v1/fedpcl/model/latest
    → Returns: {version, E_personal_compressed, neigh_embs}
    → E_personal packaged as Base64-encoded Float32Array
  
  POST /api/v1/fedpcl/update
    Body: {
      round_id: "round_042",
      item_deltas: {movie_id: [64 floats], ...},  ← LDP-noised
      user_emb: [64 floats],                       ← LDP-noised
      m_u: 47                                      ← dataset size
    }
    → Returns: {status: "received", next_round_in_days: 14}
```

---

## Integration 7: ML → Recommendation API

### Offline Model → Serving

```
FedPCL training completes (or offline CF model trained):
  │
  ├── Model artifacts saved to MLflow + PostgreSQL
  │
  ├── Deployment triggered:
  │     deploy_new_model(version="v1.8")
  │       → Load E_global from DB (BYTEA → numpy array)
  │       → Load E_clusters from DB
  │       → Store in module-level memory variable (process-wide)
  │       → Atomic swap: recommendation_engine.model = new_model
  │       → Flush Redis: delete all user:recommendations:* keys
  │
  └── Serving immediately uses new model:
        Next /api/recommendations request → scores computed from new E_global
```

### Recommendation Service Integration Points

```
recommendation_service.get_personalized(user_id):
  │
  ├── user_data = watch_repo.get_history(user_id)
  │     + rating_repo.get_ratings(user_id)
  │
  ├── cluster = cluster_repo.get_assignment(user_id)
  │
  ├── E_personal = 0.5 × models.E_clusters[cluster] + 0.5 × models.E_global
  │
  ├── user_emb = user_emb_repo.get(user_id)  OR  compute from local history
  │
  ├── scores = np.dot(user_emb, E_personal.T)
  │
  ├── exclude already-watched
  │
  ├── apply diversity rules (from definitions.yaml)
  │
  ├── cache result (Redis 15min)
  │
  └── return top 20 movie IDs
        → movie_service.get_movies_by_ids(top_20_ids)  → full movie objects
```

---

## Integration 8: News + Recommendation Integration

Shared preference signal — both systems read from same user preference profile.

```
User behavior (DB: watch_history, ratings)
  │
  ├── Recommendation Service:
  │     reads interactions → computes genre_affinity_scores
  │     → movie recommendations
  │
  └── News Service:
        reads genre_affinity_scores FROM recommendation_service
          (calls recommendation_service.get_user_genre_affinities(user_id))
        → applies to news article scoring:
            news_score(article) += article.genre_tags × genre_affinity_scores

When FedPCL updates user embedding:
  → recommendation_service picks up new cluster assignment
  → news_service calls get_user_genre_affinities → different result
  → both systems automatically improve
```

This shared signal means FedPCL improvement benefits BOTH recommendation AND news personalization.

---

## Integration 9: MLflow → Monitoring → Alerting

```
FedPCL Training (server-side):
  → mlflow.log_metric("hr10", 0.62, step=round_num)
  → mlflow.log_metric("ndcg10", 0.44, step=round_num)
  → mlflow.log_metric("n_clients", 128, step=round_num)

MLflow stores metrics in PostgreSQL (mlflow schema)

Grafana queries MLflow PostgreSQL:
  → Plot HR@10 over training rounds
  → Alert if HR@10 < 0.55 for 2+ consecutive rounds

FastAPI emits Prometheus metrics:
  → /metrics endpoint (Prometheus scrapes every 30s)
  → recommendation_latency_seconds histogram
  → cache_hit_total counter
  → fedpcl_round_participants gauge

Prometheus → Grafana → Alertmanager:
  → Slack alert: "HR@10 dropped to 0.51 — investigate training"
  → Email alert: "CTR dropped 12% after model v1.9 deployment — rollback?"
```

---

## Data Flow Summary Table

| From | To | Interface | Data Type | When |
|------|----|-----------|-----------|------|
| Frontend | API Gateway | HTTPS | JSON | Every user action |
| API Gateway | FastAPI | HTTP | JSON + headers | Every request |
| FastAPI | PostgreSQL | TCP (asyncpg) | SQL → Python objects | Every DB read/write |
| FastAPI | Redis | TCP | JSON strings | Every cache check |
| FastAPI | TMDB API | HTTPS | JSON | Cache miss / cron sync |
| FastAPI | NewsAPI | HTTPS | JSON | Cron every 2hr |
| FastAPI | Celery | Redis queue | Task message | Background triggers |
| Celery | FastAPI DB | Same DB conn | SQL | Task execution |
| FedPCL Server | PostgreSQL | SQL | Numpy arrays as BYTEA | After each round |
| FedPCL Client | FedPCL Server | HTTPS | Base64 float arrays | Per round |
| ML Model | Rec Service | In-memory | Numpy arrays | Per recommendation |
| Rec Service | News Service | In-process | Python function call | Per news request |
| FastAPI | MLflow | HTTP | JSON + files | Each training run |
| MLflow | Grafana | PostgreSQL query | Metrics | Dashboard refresh |
| Grafana | Alertmanager | HTTP | Alert payload | Threshold breach |
| Alertmanager | Slack/Email | HTTP | Notification | Alert fired |
