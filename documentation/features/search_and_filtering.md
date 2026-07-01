# Search & Filtering

## Overview & Architecture

Movientum's search infrastructure relies purely on PostgreSQL's built-in Full-Text Search (`TSVECTOR`) and Trigram (`pg_trgm`) extensions. This avoids the operational complexity of maintaining an external Elasticsearch or Meilisearch cluster while still providing rapid, typo-tolerant search across tens of thousands of records.

---

## Logics & Business Rules

### Two-Tier Search System
1. **Instant Search (Autocomplete)**: Triggered on every keystroke (debounced on the frontend). It searches only the `title` field using `pg_trgm` (`%` operator) to find fast prefix and fuzzy matches. Results are cached in Redis (`TTL = 300s`) under the `search:auto:{prefix}` key.
2. **Paginated Deep Search**: Triggered when the user hits "Enter" or visits the `/explore` page. It utilizes the `search_vector` (`TSVECTOR`) column to search across titles, overviews, and actor names simultaneously. It supports pagination and genre filtering. Results are cached in Redis (`TTL = 600s`) under the `search:paged:{hash}` key.

---

## Code Structure & Detailed Logic

### Database Implementation
A specialized script (`ingest_search_index.py`) runs periodically to update the `search_vector` column. It concatenates the movie title (Weight A) and the movie overview (Weight B).

```sql
-- Executed by ingest_search_index.py
UPDATE movies 
SET search_vector = 
    setweight(to_tsvector('english', coalesce(title, '')), 'A') || 
    setweight(to_tsvector('english', coalesce(overview, '')), 'B');

CREATE INDEX idx_movies_fts ON movies USING GIN(search_vector);
CREATE INDEX idx_movies_title_trgm ON movies USING GIST(title gist_trgm_ops);
```

### The Search Router (`search.py`)
- `GET /api/v1/search/autocomplete`: The fast path endpoint. Checks Redis, then queries Postgres using `ILIKE` and trigram similarity.
- `GET /api/v1/search/paged`: The deep path endpoint. Accepts `query`, `page`, `type` (movie/tv/person), and `genre`.

---

## Tables & Summaries

### Filter Capabilities (Explore Page)

| Filter Type | Backend Implementation | Performance |
|---|---|---|
| **Text Query** | `search_vector @@ to_tsquery` | High (GIN Index) |
| **Genre** | `INNER JOIN movie_genres` | High (B-Tree Index) |
| **Media Type**| Union Queries (Movies + TV) | Moderate |
| **Sort By** | `ORDER BY popularity DESC` | High (B-Tree Index) |

---

## Workflows & Lifecycles

### Full-Text Search Flow
```mermaid
flowchart TD
    A[User types 'Incept'] --> B[React Debounce (300ms)]
    B --> C[GET /autocomplete?q=incept]
    C --> D{Redis 'search:auto:incept'}
    D -- Hit --> E[Return Fast JSON]
    D -- Miss --> F[Postgres Trigram GIST Scan]
    F --> G[Set Cache & Return JSON]
    
    A --> H[User presses Enter]
    H --> I[GET /paged?q=Inception]
    I --> J{Redis 'search:paged:hash'}
    J -- Hit --> K[Return JSON]
    J -- Miss --> L[Postgres TSVECTOR GIN Scan]
    L --> M[Set Cache & Return JSON]
```
