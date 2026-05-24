# Storage Estimation — Movientum

## Overview

Movientum targets a **5–10 GB total database limit**. This constraint shapes what we store, what we cache, and what we discard. Every design decision balances data richness vs storage cost.

This document estimates storage for each table, shows cumulative totals at different growth stages, and provides clear rules for staying within limits.

---

## Assumptions

| Variable | Value | Basis |
|---------|-------|-------|
| Total movies in catalog | 100,000 | TMDB popular + search-seeded |
| Registered users | 10,000 | Year 1 projection |
| Avg watches per user | 50 | Moderate active user |
| Avg ratings per user | 20 | ~40% of watched movies get rated |
| Avg watchlist size | 15 | Per user |
| News articles (rolling 7-day window) | 5,000 | 50 articles/fetch × 2hr × 7 days × dedup |
| FedPCL embed_dim | 64 | Paper default |
| Float32 per dimension | 4 bytes | |

---

## Phase 1: Before Recommendation System

### Table-by-Table Estimates

#### `movies` table

| Field | Avg Size | Notes |
|-------|---------|-------|
| id (integer) | 4 B | |
| title (varchar 500) | 30 B | avg movie title |
| original_title | 30 B | |
| overview (text) | 500 B | avg plot ~100 words |
| release_date | 4 B | |
| runtime | 4 B | |
| poster_path | 40 B | `/xxxxx.jpg` string |
| backdrop_path | 40 B | |
| popularity | 8 B | float |
| vote_average | 8 B | float |
| vote_count | 4 B | |
| adult | 1 B | bool |
| status | 20 B | varchar |
| budget | 8 B | bigint |
| revenue | 8 B | bigint |
| original_language | 4 B | varchar(10) |
| imdb_id | 15 B | varchar(20) |
| metadata (JSONB) | 200 B | extra fields |
| fetched_at | 8 B | timestamptz |
| **Row overhead** | 40 B | PostgreSQL MVCC |
| **Total per row** | **~976 B ≈ 1 KB** | |

**100,000 movies × 1 KB = 100 MB**

#### `genres` table
5 KB (38 genre rows × ~130 bytes) — negligible

#### `movie_genres` junction
100,000 movies × avg 3 genres × 8 B per row = **2.4 MB**

#### `directors` table
~5,000 directors × 600 B per row = **3 MB**

#### `movie_directors` junction
100,000 movies × avg 2 directors × 8 B = **1.6 MB**

---

#### `users` table

| Field | Avg Size |
|-------|---------|
| id (UUID) | 16 B |
| email | 30 B |
| username | 15 B |
| password_hash (bcrypt) | 60 B |
| avatar_url | 80 B |
| created_at + updated_at | 16 B |
| is_active | 1 B |
| role | 6 B |
| genre_preferences (TEXT[]) | 50 B |
| Row overhead | 40 B |
| **Total per row** | **~314 B ≈ 0.3 KB** | |

**10,000 users × 0.3 KB = 3 MB**

---

#### `ratings` table

| Field | Size |
|-------|------|
| id (UUID) | 16 B |
| user_id (UUID) | 16 B |
| movie_id (int) | 4 B |
| story_score (float) | 8 B |
| acting_score | 8 B |
| direction_score | 8 B |
| visuals_score | 8 B |
| overall_score | 8 B |
| review_text (text, optional) | 0 B (if null) |
| created_at + updated_at | 16 B |
| Row overhead | 40 B |
| **Total per row** | **~132 B** | |

10,000 users × 20 avg ratings = 200,000 rows
**200,000 × 132 B = 26.4 MB**

With optional review_text (avg 100 chars when present, 30% of ratings):
+ 200,000 × 0.30 × 100 B = **6 MB extra** → ~32 MB total

---

#### `watch_history` table

| Field | Size |
|-------|------|
| id (UUID) | 16 B |
| user_id (UUID) | 16 B |
| movie_id (int) | 4 B |
| watched_at | 8 B |
| watch_source | 20 B |
| rewatched | 1 B |
| Row overhead | 40 B |
| **Total per row** | **~105 B** | |

10,000 users × 50 avg watches = 500,000 rows
**500,000 × 105 B = 52.5 MB**

---

#### `watchlist` table

10,000 users × 15 entries × 90 B per row = **13.5 MB**

---

#### `user_genre_preferences` table

10,000 users × avg 4 genres × 20 B per row = **800 KB** — negligible

---

#### `news_articles` table (rolling 7-day)

| Field | Avg Size |
|-------|---------|
| id (UUID) | 16 B |
| title (text) | 100 B |
| description (text) | 300 B |
| url (text) | 120 B |
| image_url | 100 B |
| source_name | 30 B |
| published_at + fetched_at | 16 B |
| genre_tags (TEXT[]) | 30 B |
| url_hash | 32 B |
| Row overhead | 40 B |
| **Total per row** | **~784 B ≈ 800 B** | |

5,000 rolling articles × 800 B = **4 MB** (small, articles deleted after 7 days)

---

### PostgreSQL Indexes

Indexes add overhead — typically 30–50% of table data size:

| Table | Estimated Index Size |
|-------|---------------------|
| movies | 15 MB (title full-text GIN, popularity, date) |
| ratings | 5 MB (user_id, movie_id, composite) |
| watch_history | 8 MB (user_id, watched_at composite) |
| users | 2 MB (email, username unique indexes) |
| news_articles | 1 MB (url_hash, published_at) |
| **Total Indexes** | **~31 MB** |

---

### Phase 1 Storage Summary

| Component | Size |
|-----------|------|
| movies table | 100 MB |
| movie_genres + movie_directors | 5 MB |
| directors table | 3 MB |
| users table | 3 MB |
| ratings table | 32 MB |
| watch_history table | 53 MB |
| watchlist table | 14 MB |
| news_articles (rolling) | 4 MB |
| All indexes | 31 MB |
| PostgreSQL system overhead | 50 MB |
| **Phase 1 Total** | **~295 MB** |

✅ **295 MB — well within 10 GB limit. Plenty of headroom.**

---

## Phase 2: After Recommendation System (FedPCL)

Additional storage needed for FedPCL:

### `fedpcl_models` table — E_global

100,000 movies × 64 dimensions × 4 bytes (float32) = **25.6 MB per model version**

Keep 3 versions: **76.8 MB**

### `fedpcl_clusters` table — E_cluster

5 clusters × 100,000 movies × 64 × 4 bytes = **128 MB per version**

Keep 3 versions: **384 MB**

### `user_cluster_assignments` table

10,000 users × ~25 B per row = **250 KB** — negligible

### `user_embeddings` (server-side, for serving)

10,000 users × 64 × 4 bytes = **2.56 MB** — negligible

### Training Logs (MLflow artifacts)

- Per training run: embedding snapshots at checkpoints + eval JSON
- 10 checkpoint .npy files × 25.6 MB = 256 MB per run
- Keep last 5 runs: **1.28 GB** → store in separate artifact volume, not main DB

MLflow artifacts stored in filesystem/S3, NOT in PostgreSQL. Excluded from DB budget.

### User Events Log (for drift monitoring)

Optional analytics events table:
10,000 users × 100 events/user × 60 B per event = **60 MB**

---

### Phase 2 Storage Summary

| Component | Size |
|-----------|------|
| Phase 1 total | 295 MB |
| FedPCL E_global (3 versions) | 77 MB |
| FedPCL E_clusters (3 versions) | 384 MB |
| User embeddings (serving) | 3 MB |
| Cluster assignments | 1 MB |
| User events log | 60 MB |
| **Phase 2 Total (DB)** | **~820 MB** |

✅ **820 MB — still well within 5 GB limit.**

MLflow training artifacts (1.28 GB) → separate volume/S3, not in DB budget.

---

## Growth Projections

| Users | Movies | Total DB Storage |
|-------|--------|-----------------|
| 10,000 | 100,000 | ~820 MB |
| 50,000 | 100,000 | ~2.5 GB |
| 100,000 | 200,000 | ~5.2 GB |
| 200,000 | 200,000 | ~8.5 GB |
| 500,000 | 500,000 | ~20 GB → need storage plan |

**At 100,000 users → approaching 5–10 GB limit. Plan storage strategy by then.**

---

## Strategies to Stay Within Limit

### What NOT to Store

| Data | Alternative |
|------|------------|
| Full movie poster/backdrop images | Link to TMDB CDN directly (zero storage) |
| News article full body text | Store only title + description + URL (fetch full on click) |
| All TMDB movies (500k+) | Only store movies that appear in searches or are popular |
| Old user events (> 90 days) | Archive to CSV in cold storage, delete from DB |
| Intermediate ML training checkpoints | Store only final model + 2 checkpoints, delete rest |
| MLflow artifacts | Store in separate S3 bucket, not PostgreSQL |
| Duplicate news articles | Dedup by url_hash before insert |

### What to Cache vs Persist

| Data | Cache (Redis) | Persist (DB) |
|------|--------------|-------------|
| Movie details | Yes (1hr TTL) | Yes (permanent) |
| Trending movies list | Yes (30min TTL) | No |
| Search results | Yes (10min TTL) | No |
| User recommendations | Yes (15min TTL) | No |
| User watch history | No | Yes (permanent) |
| User ratings | No | Yes (permanent) |
| News articles | Yes (2hr TTL) | Yes (7 days only, then delete) |
| FedPCL models | Yes (load to RAM) | Yes (keep 3 versions) |
| Genre list | Yes (24hr TTL) | Yes (permanent) |

### Archival Strategy (When Approaching Limit)

When DB > 8 GB:
1. **Archive watch history**: Move events older than 1 year to compressed CSV in object storage (S3). Keep DB record as `{user_id, movie_id, archived: true}` — 10 B per row vs 105 B.
2. **Archive old ratings**: Keep latest rating per user-movie pair; archive superseded ratings.
3. **Prune news**: Reduce rolling window from 7 days to 3 days.
4. **Compress embeddings**: Store FedPCL models in float16 instead of float32 → half the size (12.8 MB per E_global).
5. **Expand DB plan**: At 100k users, revenue should justify $50–100/mo managed DB tier with 50 GB.

### Row Count Summary

| Table | Rows (Phase 1) | Rows (Phase 2 / 50k users) |
|-------|---------------|---------------------------|
| movies | 100,000 | 200,000 |
| genres | 38 | 38 |
| movie_genres | 300,000 | 600,000 |
| directors | 5,000 | 10,000 |
| movie_directors | 200,000 | 400,000 |
| users | 10,000 | 50,000 |
| ratings | 200,000 | 1,000,000 |
| watch_history | 500,000 | 2,500,000 |
| watchlist | 150,000 | 750,000 |
| news_articles | 5,000 (rolling) | 5,000 (rolling) |
| user_cluster_assignments | 10,000 | 50,000 |
| user_events | 1,000,000 | 5,000,000 |

---

## Storage Monitoring

Track in Grafana dashboard:
```
DB size total:         SELECT pg_database_size('movientum');
Per-table sizes:       SELECT relname, pg_total_relation_size(oid) FROM pg_class;
Largest tables:        Sort above by size DESC
Growth rate:           Compare weekly snapshots

Alert: DB > 7 GB → review archival strategy
Alert: DB > 9 GB → urgent: archive or expand before hitting limit
```
