# Database System — Movientum

## Overview

Movientum uses **PostgreSQL** as primary database. Chosen for:
- ACID compliance (ratings, auth data must be consistent)
- Complex query support (joins for recommendation queries)
- JSONB support (flexible metadata fields)
- Mature ecosystem, great tooling

**Redis** as secondary data store for caching. Not a primary DB.

---

## Core Tables

### `users`
Stores all registered user accounts.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | Auto-generated |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Login identifier |
| username | VARCHAR(100) | UNIQUE, NOT NULL | Display name |
| password_hash | TEXT | NOT NULL | bcrypt hash, never plaintext |
| avatar_url | TEXT | NULLABLE | Profile picture |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Registration time |
| updated_at | TIMESTAMPTZ | NOT NULL | Auto-update on change |
| is_active | BOOLEAN | DEFAULT TRUE | Soft disable accounts |
| role | VARCHAR(20) | DEFAULT 'user' | user / admin |

### `movies`
Master movie catalog. Sourced from TMDB and stored locally.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | INTEGER | PRIMARY KEY | TMDB movie ID (use theirs) |
| title | VARCHAR(500) | NOT NULL | |
| original_title | VARCHAR(500) | NULLABLE | For non-English films |
| overview | TEXT | NULLABLE | Plot summary |
| release_date | DATE | NULLABLE | |
| runtime | INTEGER | NULLABLE | Minutes |
| poster_path | TEXT | NULLABLE | TMDB relative path |
| backdrop_path | TEXT | NULLABLE | Banner image path |
| popularity | FLOAT | DEFAULT 0 | TMDB popularity score |
| vote_average | FLOAT | DEFAULT 0 | TMDB community rating |
| vote_count | INTEGER | DEFAULT 0 | TMDB vote count |
| adult | BOOLEAN | DEFAULT FALSE | Explicit content flag |
| status | VARCHAR(50) | NULLABLE | Released, Post Production, etc. |
| budget | BIGINT | DEFAULT 0 | Production budget |
| revenue | BIGINT | DEFAULT 0 | Box office |
| original_language | VARCHAR(10) | NULLABLE | ISO code (en, fr, etc.) |
| imdb_id | VARCHAR(20) | NULLABLE | Cross-reference |
| metadata | JSONB | DEFAULT '{}' | Flexible extra data |
| fetched_at | TIMESTAMPTZ | NOT NULL | When we last synced from TMDB |

### `genres`
Genre lookup table.

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY (TMDB genre ID) |
| name | VARCHAR(100) | NOT NULL, UNIQUE |

### `movie_genres` (junction table)
Many-to-many: one movie → many genres, one genre → many movies.

| Column | Type | Constraints |
|--------|------|-------------|
| movie_id | INTEGER | FK → movies.id |
| genre_id | INTEGER | FK → genres.id |
| PRIMARY KEY | (movie_id, genre_id) | Composite |

### `directors`
Director profiles.

| Column | Type | Constraints |
|--------|------|-------------|
| id | INTEGER | PRIMARY KEY (TMDB person ID) |
| name | VARCHAR(255) | NOT NULL |
| biography | TEXT | NULLABLE |
| profile_path | TEXT | NULLABLE |
| birthday | DATE | NULLABLE |
| place_of_birth | VARCHAR(255) | NULLABLE |
| tmdb_id | INTEGER | UNIQUE |

### `movie_directors` (junction table)
Many-to-many: movie → directors.

| Column | Type | Constraints |
|--------|------|-------------|
| movie_id | INTEGER | FK → movies.id |
| director_id | INTEGER | FK → directors.id |
| PRIMARY KEY | (movie_id, director_id) | Composite |

### `ratings`
User ratings for movies — with custom category breakdown.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | |
| user_id | UUID | FK → users.id, NOT NULL | |
| movie_id | INTEGER | FK → movies.id, NOT NULL | |
| story_score | FLOAT | CHECK 0-10, NULLABLE | Story/writing rating |
| acting_score | FLOAT | CHECK 0-10, NULLABLE | Performance rating |
| direction_score | FLOAT | CHECK 0-10, NULLABLE | Directing rating |
| visuals_score | FLOAT | CHECK 0-10, NULLABLE | Cinematography/VFX rating |
| overall_score | FLOAT | CHECK 0-10, NOT NULL | Required field |
| review_text | TEXT | NULLABLE | Optional written review |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | |
| updated_at | TIMESTAMPTZ | | Last edit time |
| UNIQUE | (user_id, movie_id) | | One rating per user per movie |

### `watch_history`
Records every movie a user marks as watched.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | UUID | PRIMARY KEY | |
| user_id | UUID | FK → users.id, NOT NULL | |
| movie_id | INTEGER | FK → movies.id, NOT NULL | |
| watched_at | TIMESTAMPTZ | DEFAULT NOW() | When marked watched |
| watch_source | VARCHAR(50) | NULLABLE | platform, theater, etc. |
| rewatched | BOOLEAN | DEFAULT FALSE | Is this a rewatch? |
| UNIQUE | (user_id, movie_id) | | One record per user-movie pair (update, not insert on rewatch) |

### `watchlist`
Movies user wants to watch later.

| Column | Type | Constraints |
|--------|------|-------------|
| id | UUID | PRIMARY KEY |
| user_id | UUID | FK → users.id |
| movie_id | INTEGER | FK → movies.id |
| added_at | TIMESTAMPTZ | DEFAULT NOW() |
| UNIQUE | (user_id, movie_id) | One entry per user-movie |

### `user_genre_preferences`
Explicit genre preferences set by user in profile.

| Column | Type | Constraints |
|--------|------|-------------|
| user_id | UUID | FK → users.id |
| genre_id | INTEGER | FK → genres.id |
| weight | FLOAT | DEFAULT 1.0 (higher = more preferred) |
| PRIMARY KEY | (user_id, genre_id) | |

---

## Relationships Map

```
users ──────────────────────────────────────────────────────┐
  │                                                          │
  ├── ratings (one user → many ratings)                      │
  │     └── ratings.movie_id → movies                        │
  │                                                          │
  ├── watch_history (one user → many watch records)          │
  │     └── watch_history.movie_id → movies                  │
  │                                                          │
  ├── watchlist (one user → many watchlist entries)          │
  │     └── watchlist.movie_id → movies                      │
  │                                                          │
  └── user_genre_preferences → genres                        │
                                                             │
movies ──────────────────────────────────────────────────────┘
  │
  ├── movie_genres → genres (many-to-many)
  └── movie_directors → directors (many-to-many)
```

---

## Indexing Strategy

Indexes speed up reads at cost of slightly slower writes. Index columns used in WHERE, ORDER BY, JOIN conditions.

### Users Table
```
UNIQUE INDEX on users(email)        → login lookup
UNIQUE INDEX on users(username)     → username check
INDEX on users(created_at)          → admin queries by date
```

### Movies Table
```
INDEX on movies(popularity DESC)    → trending query
INDEX on movies(release_date)       → date range filter
INDEX on movies(vote_average)       → rating range filter
INDEX on movies(original_language)  → language filter
FULL TEXT INDEX on movies(search_vector) → title + overview search (gin index)
```

### Ratings Table
```
INDEX on ratings(user_id)           → "my ratings" query
INDEX on ratings(movie_id)          → "ratings for movie" query
INDEX on ratings(overall_score)     → top-rated sort
COMPOSITE INDEX on (user_id, movie_id) → check if rated (unique constraint covers this)
```

### Watch History
```
INDEX on watch_history(user_id)     → "my history" query
INDEX on watch_history(watched_at DESC) → recent watches
COMPOSITE INDEX on (user_id, watched_at DESC) → user's recent history
```

### Full Text Search (PostgreSQL native)
- Add `tsvector` column `search_vector` to `movies` table: combines `title` + `overview`
- Update via trigger or seed script whenever title/overview changes
- Index with `GIN` index type (best for full-text)
- Enables fast `WHERE search_vector @@ to_tsquery('action')` queries

---

## Query Optimization Strategies

### Avoid N+1 Queries
Bad pattern: fetch 20 movies, then loop to fetch genres for each = 21 queries.
Good pattern: single JOIN query — fetch movies WITH genres in one round trip.

### Pagination
All list endpoints use cursor-based or offset pagination:
- Offset: `LIMIT 20 OFFSET 40` — simple but slow on large offsets
- Cursor: `WHERE id > last_seen_id LIMIT 20` — fast at any depth

Use cursor pagination for watch history and large lists.

### Aggregation Caching
Movie average rating = expensive aggregation query.
Strategy:
- Store `avg_rating` and `rating_count` directly on movies table
- Update these columns via trigger when rating inserted/updated
- No need to aggregate on every request

### Read Replicas (Future)
At scale: primary DB handles writes, read replicas handle all SELECT queries.
Application routes writes to primary, reads to replica.

---

## Data Integrity Rules

- Foreign keys enforced at DB level (not just application)
- `NOT NULL` on all critical fields
- `CHECK` constraints on score ranges (0 ≤ score ≤ 10)
- `UNIQUE` constraints on user+movie combinations in ratings and watch_history
- Timestamps always use `TIMESTAMPTZ` (timezone-aware) not `TIMESTAMP`
- UUIDs for user-facing IDs (not sequential integers — prevents enumeration attacks)
- TMDB IDs used as-is for movies/genres/directors (avoids ID mismatch)

---

## Migration Strategy

Use **Alembic** (SQLAlchemy migration tool) for schema changes:
- Every schema change = new migration file
- Migrations are version-controlled with git
- `alembic upgrade head` applies all pending migrations
- `alembic downgrade -1` rolls back one migration

Never manually alter DB schema in production. Always via migrations.

---

## Backup Strategy

- Automated daily backups via PostgreSQL `pg_dump`
- Backups stored in separate cloud storage (e.g., S3)
- Retention: 7 daily, 4 weekly, 3 monthly backups
- Point-in-time recovery enabled via WAL archiving
- Test restores quarterly
