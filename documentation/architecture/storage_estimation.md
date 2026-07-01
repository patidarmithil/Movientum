# Storage Estimation & Capacity Planning

## Overview & Architecture

Movientum's storage footprint is divided between persistent relational data (Supabase PostgreSQL) and ephemeral/in-memory data (Upstash Redis + API Server RAM). The system is designed to minimize storage costs by heavily relying on `ARRAY` and `JSONB` data types rather than deeply nested relational tables for ML features.

---

## Logics & Business Rules

### PostgreSQL Storage (Supabase)
Instead of traditional junction tables for every keyword or cast member (which causes index bloat), the `content_catalog` table stores features as `ARRAY(Integer)`.
- **`ContentCatalog`**: ~20,000 seed items. With JSONB/ARRAY columns, each row is approx. 2KB. Total catalog footprint is `< 50MB`.
- **`UserTasteProfile`**: Stores 6 JSONB dictionaries per user. Clamped to top-20 keys for cast/crew/keywords to prevent unbounded growth. ~1KB per user.
- **`InteractionLog`**: The heaviest table. Each row stores a 16-dimensional `feature_snapshot` (~300 bytes). For 1000 DAU doing 20 interactions/day = 20,000 rows/day = ~6MB/day.

### Redis Storage (Upstash)
Upstash charges by request volume and total storage.
- **Cache eviction** is strictly enforced via TTLs (ranging from 2 minutes for taste profiles to 24 hours for catalog features).
- **Average Payload**: The `movie:list:{hash}` JSON payloads are usually under 15KB.

### In-Memory RAM (FastAPI Graph)
The `nx.Graph` singleton loaded on application startup consumes process RAM.
- **Nodes**: ~20,000 (movies) + ~15,000 (actors) + ~5,000 (keywords) = ~40,000 nodes.
- **Edges**: ~300,000 edges.
- **RAM footprint**: Approximately `100MB - 150MB` per FastAPI worker. Easily fits within standard 512MB memory limits of modern container hosting.

---

## Tables & Summaries

### Estimated Database Growth (per 10,000 Users)

| Table | Est. Row Size | Est. Row Count (1Yr) | Est. Total Size | Mitigation Strategy |
|---|---|---|---|---|
| `users` | 500 B | 10,000 | 5 MB | None needed |
| `content_catalog` | 2 KB | 35,000 | 70 MB | TMDB ID deduplication |
| `user_taste_profiles`| 1 KB | 10,000 | 10 MB | Cap Top-K dictionary sizes |
| `interaction_log` | 300 B | ~7,300,000 | 2.2 GB | Nightly cron deletes logs older than 30 days (required for XGBRanker only) |

---

## Workflows & Lifecycles

### Storage Optimization Lifecycle
```mermaid
flowchart TD
    A[Nightly Celery Job] --> B[XGBRanker Retraining]
    B --> C[Analyze interaction_log (last 30 days)]
    C --> D[Delete interaction_log rows older than 45 days]
    D --> E[Reclaim PostgreSQL Storage]
```
