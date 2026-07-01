# Database Architecture (Supabase PostgreSQL)

## Overview & Architecture

Movientum uses **Supabase PostgreSQL** as its primary operational data store. The database is interfaced via `SQLAlchemy 2.0` in fully asynchronous mode (`asyncpg`) for the runtime, and synchronous mode (`psycopg2`) for Alembic migrations.

---

## Code Structure & Detailed Logic

### The Schema Hierarchy
Defined strictly in `backend/app/db/orm_models.py`.

1. **Phase 1: Master Catalog**
   - `movies`, `genres`, `directors`.
   - `ContentCatalog`: Fast inference structure containing `ARRAY(Integer)` and `JSONB` columns for TMDB categorical and talent features.

2. **Phase 3: Auth & Identity**
   - `users`: Uses UUID primary keys to prevent enumeration attacks.
   - `UserTasteProfile`: Contains 6 multi-dimensional `JSONB` weight vectors (genres, cast, crew, keyword, language, era).

3. **Phase 6: Logging & Feedback**
   - `ratings`: Four fixed categories (`skip`, `timepass`, `go_for_it`, `perfection`).
   - `InteractionLog`: Stores `feature_snapshot` (JSONB) of the exact ML feature vectors present when a user clicked/thumbed an item, creating training data.

### Database Session Management
FastAPI dependencies yield a single asynchronous session per request, automatically handling commit/rollback boundaries.

```python
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
```

### Asyncpg Password Handling
`asyncpg` crashes if it encounters unescaped special characters (`#`, `@`) in the connection URL. This is mitigated using the `safe_async_db_url` property from `app.config.Settings`.

---

## Tables & Summaries

### Key Indexing Strategies
To ensure fast read performance during graph queries and feed generation:
| Table | Index | Purpose |
|---|---|---|
| `movies` | `idx_movies_popularity (DESC)` | Fast retrieval of trending items. |
| `movies` | `idx_movies_fts (GIN)` | PostgreSQL Full-Text Search on TSVECTOR. |
| `interaction_log` | `idx_interaction_log_user_ts` | Fast retrieval for the 30-day nightly ML retrain query. |
| `content_catalog` | `uq_catalog_tmdb_media` | Prevents ingestion duplicates for movies/tv. |

---

## Workflows & Lifecycles

### Alembic Migration Flow
```mermaid
flowchart LR
    A[Update orm_models.py] --> B[alembic revision --autogenerate]
    B --> C[Review Migration Script]
    C --> D[alembic upgrade head (psycopg2)]
```
