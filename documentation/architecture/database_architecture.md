# Database Architecture

Movientum uses **Supabase PostgreSQL**. Table definitions live in `backend/app/db/orm_models.py`.

## Two connection strings

| Setting | Driver | Used by |
|---|---|---|
| `async_database_url` | asyncpg | The running API |
| `database_url` | psycopg2 | Alembic migrations only |

Always use `settings.safe_async_db_url` / `safe_sync_db_url`. The password contains characters that break URLs, and these properties encode it.

## The one rule to remember

**Movies and TV shows share the `movies` table.** The primary key is `(id, type)` where `type` is `'movie'` or `'tv'`, because TMDB reuses the same number for a movie and a show. Every table that points at a title uses both columns. Always filter on both.

## Tables by purpose

| Group | Tables | What they hold |
|---|---|---|
| Catalog | `movies`, `genres`, `movie_genres`, `directors`, `movie_directors` | Title details for browsing. `movies.search_vector` powers full-text search |
| Rating meter seed | `movie_ratings`, `tv_ratings` | Imported scores so the rating meter is not empty on day one |
| Users | `users` | Account, bcrypt password (empty for Google-only users), `google_sub`, role, recommendation preferences |
| Library | `ratings`, `watch_history`, `watchlist` (old single list), `watchlist_collections` + `watchlist_items` (current multi-list) | What the user rated, watched and saved |
| Recommendation engine | `content_catalog`, `user_taste_profiles`, `interaction_log`, `rec_suppression` | Title features, per-user taste weights, training data, hidden items |
| AI recs | `ai_rec_memory`, `ai_rec_sessions` | Thumbs on Gemini picks, request log |
| Search | `people` | Local cast/crew search index |
| Tier lists | `tier_lists` | Saved boards as JSON, with a public `share_id` |
| TV tracking | `watching_tracker`, `temp_tracker`, `notifications` | Followed shows and alerts |
| Other | `feedback`, `requested_content`, `rating_needed`, `click_history`, `person_cache` | Bug reports, missing-title requests, analytics |

## Where the schema is defined

- **Alembic** (`backend/alembic/versions/`) owns most tables.
- **`main.py` startup** creates four tables with raw SQL on every boot: `rating_needed`, `watching_tracker`, `temp_tracker`, `notifications`. Change them there (and in the ORM), not only in a migration.

```bash
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Keeping it small

- **News is not stored here** — it lives in Redis.
- `content_catalog` stores features as integer arrays and JSONB instead of join tables.
- A startup task deletes movies with popularity under 5 that nobody rated, watched or saved and that are older than 30 days.
- `rec_suppression` rows expire after 90 days; reads skip expired rows, and startup cleanup deletes them.

## Important indexes

- `movies`: popularity, rating, release date, language, GIN on `search_vector`, trigram on `title_search`.
- `content_catalog`: unique `(tmdb_id, media_type)`.
- `interaction_log`: `(user_id, timestamp)` for the nightly training query.
- `people`: trigram on `name_search`.
