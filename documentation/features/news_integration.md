# News Integration

## Overview & Architecture

Movientum features an aggregated entertainment news feed that keeps users engaged. It operates in two modes:
1. **Global Feed** (`/feed/latest`): Chronological entertainment news for anonymous users.
2. **For-You Feed** (`/feed/for-you`): A highly personalized feed for authenticated users, where articles are algorithmically scored based on the user's specific genre preferences, watched movies, and favorite directors.

---

## Logics & Business Rules

### External API Ingestion
News is ingested via the external `NewsAPI` service. Because the free tier is strictly rate-limited (100 requests/day), the FastAPI server NEVER queries NewsAPI on-demand. Instead, a background Celery task (`trigger_global_fetch`) routinely pulls the latest entertainment articles and stores them in the local PostgreSQL database (`news_articles` table).

### The "For-You" Scoring Algorithm
When an authenticated user requests their personalized feed, the system:
1. Fetches their top 10 preferred genres from `UserGenrePreference`.
2. Fetches their last 200 watched movies from `WatchHistory`.
3. Fetches up to 50 directors associated with those watched movies.
4. Performs a full-text search similarity score against the `news_articles` title and content using the extracted keywords (genres, titles, directors).
5. Sorts the articles by this calculated relevance score rather than pure chronology.

---

## Code Structure & Detailed Logic

### Backend Implementation
- **`app/services/news_service.py`**: Handles the NewsAPI ingestion mapping and the SQL weighting logic for the personalized feed.
- **`app/routers/news.py`**: Exposes the REST endpoints and manages the Redis caching layers.

### Aggressive Caching
Because the For-You feed requires 4 heavy database queries (Genres + WatchHistory + Movies + Directors) just to build the search query, the resulting keyword profile is cached in Upstash Redis (`key_user_prefs`) for 15 minutes. The final scored feed page is also cached (`key_news_feed_user`) for 5 minutes.

---

## Tables & Summaries

### News Cache TTLs

| Cache Key Pattern | TTL | Purpose |
|---|---|---|
| `news:feed:latest:p{page}` | 120s (2m) | Unpersonalized latest news cache |
| `user:prefs:{user_id}` | 900s (15m)| Caches user's genre/director keywords |
| `news:feed:{user_id}:p{page}` | 300s (5m) | Caches the final scored personalization |

---

## Workflows & Lifecycles

### Personalized Feed Workflow
```mermaid
flowchart TD
    A[Client requests /feed/for-you] --> B{Feed in Redis?}
    B -- Yes --> C[Return cached feed]
    B -- No --> D{Prefs in Redis?}
    D -- No --> E[Query DB: Top Genres & Watch History]
    E --> F[Cache Prefs (15m)]
    D -- Yes --> G[Extract Keywords]
    F --> G
    G --> H[Query news_articles with TSVECTOR weights]
    H --> I[Cache Scored Feed (5m)]
    I --> J[Return JSON to Client]
```
