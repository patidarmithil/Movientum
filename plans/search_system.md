# Search System — Movientum

## Overview

Movientum search must feel instant. User types → results appear. Two-layer strategy: local DB first (fast), TMDB API fallback (comprehensive). Autocomplete shows suggestions as user types. Results ranked by relevance.

---

## Search Architecture: Two-Layer

### Layer 1: Local DB Search (Primary)
- Source: PostgreSQL `movies` table
- Speed: ~5–20ms
- Coverage: movies already in our DB (populated from TMDB seeds + prior searches)
- Always tried first

### Layer 2: TMDB API Fallback (Secondary)
- Source: TMDB `/search/movie` endpoint
- Speed: ~200–500ms (network call)
- Coverage: entire TMDB catalog (500,000+ movies)
- Used only when local DB returns few/no results
- Results stored in DB for future searches

---

## Search Flow

### Full Search (User presses Enter or clicks Search)

```
User submits query "inception"
  │
  ├── 1. Check Redis cache for query hash
  │     ├── HIT → return cached results immediately
  │     └── MISS → proceed
  │
  ├── 2. Search local PostgreSQL
  │     → Full-text search on title + overview
  │     → Returns list of matching movies
  │
  ├── 3. Evaluate results:
  │     ├── Results ≥ threshold (e.g., 5 movies) → return DB results
  │     │     → Cache in Redis (TTL: 10 min)
  │     │
  │     └── Results < threshold → augment with TMDB
  │           → Call TMDB /search/movie?query=inception
  │           → Merge TMDB results with local results
  │           → Store new TMDB movies into local DB
  │           → Cache merged results in Redis
  │           → Return merged results
  │
  └── Response: ranked list of MovieCard data
```

### Autocomplete Search (User typing in search bar)

```
User types "inc" (then "ince", "incep"...)
  │
  ├── Debounce: wait 300ms after last keystroke
  ├── If query length < 2 → no request
  │
  ├── Check Redis for autocomplete:{query_prefix}
  │     ├── HIT → show cached suggestions
  │     └── MISS → query DB
  │
  ├── Simple DB query: WHERE LOWER(title) LIKE 'inc%'
  │     → Returns top 8 matching movie titles
  │     → Cache in Redis (TTL: 5 min)
  │
  └── Display dropdown with title + year + poster thumbnail
```

---

## PostgreSQL Full-Text Search Implementation

Standard `LIKE '%query%'` is slow on large tables. Use PostgreSQL's native full-text search.

### How it works:
1. Add computed column `search_vector` (type: `tsvector`) to movies table
2. `tsvector` is pre-computed index of words in title + overview
3. Update `search_vector` automatically via DB trigger on insert/update
4. Query using `@@` operator: `WHERE search_vector @@ to_tsquery('english', 'inception')`
5. Use `GIN` index on `search_vector` column for fast lookups

### Ranking
PostgreSQL's `ts_rank()` function assigns relevance score:
- Title match scores higher than overview match
- Exact phrase match scores higher than keyword match
- More matches = higher rank

Final sort: `ORDER BY ts_rank(search_vector, query) DESC`

---

## Autocomplete Optimization

Autocomplete needs to be very fast (<50ms feel instant).

### Strategies:
1. **Prefix index**: B-tree index on `LOWER(title)` — fast prefix queries
2. **Redis caching**: Cache autocomplete results per 2-character prefix (e.g., all movies starting with "in")
3. **Precompute popular prefix results**: During off-peak, precompute top suggestions for common prefixes
4. **Limit result set**: Return max 8 suggestions — no need for more in dropdown
5. **Debounce on frontend**: Don't call API for every keystroke — wait 300ms

### Autocomplete Response Shape
```
[
  { id: 123, title: "Inception", year: 2010, poster_thumbnail: "..." },
  { id: 456, title: "In the Mood for Love", year: 2000, poster_thumbnail: "..." },
  ...up to 8 results
]
```

---

## Ranking and Relevance Logic

Search results ordered by composite score:

```
final_score = (relevance_score × 0.5) + (popularity_score × 0.3) + (rating_score × 0.2)
```

Where:
- `relevance_score` = PostgreSQL ts_rank (0–1)
- `popularity_score` = normalized TMDB popularity (0–1)
- `rating_score` = normalized vote_average (0–1)

**Why this weighting:**
- Relevance first (query match is primary)
- Popularity second (well-known movies preferred over obscure ones)
- Rating last (don't bury low-rated but highly relevant results)

### Special Cases
- Exact title match → always ranked #1 regardless of other scores
- Very recent movies (< 6 months old) → 10% popularity boost
- Movies with > 1000 votes → 5% credibility boost (more reliable rating)

---

## Filtering and Refinement

Search results can be filtered on Search Results page:

| Filter | Implementation |
|--------|---------------|
| Genre | WHERE genre_id IN (selected_ids) via join |
| Year range | WHERE release_date BETWEEN start AND end |
| Min rating | WHERE vote_average >= threshold |
| Language | WHERE original_language = 'en' |

Filters apply on top of search results. Implemented as query parameters on search endpoint.

---

## Search Analytics (Future)

Track what users search:
- Log every query (anonymized)
- Identify common queries with low results → prioritize fetching those from TMDB
- Identify popular search terms → pre-cache results for them
- "No results" queries → flag for content team to add manually

---

## Edge Cases

| Edge Case | Handling |
|-----------|---------|
| Empty query | Return empty array, no DB/API call |
| Query < 2 chars | No autocomplete call |
| Special characters | Sanitize input, strip SQL-dangerous chars |
| TMDB API down | Return local results only (even if sparse), no error shown |
| Very common word ("the") | Filter stop words from query, search meaningful terms |
| Query with typos ("incpetion") | Future: fuzzy matching via trigram index (pg_trgm extension) |
| Query in non-English | Pass directly to TMDB which handles multilingual search |

---

## Future: Fuzzy / Semantic Search

Current: exact keyword matching + full-text.

Planned upgrades:
1. **Trigram fuzzy matching** (pg_trgm PostgreSQL extension): Handles typos like "incpetion" → "Inception"
2. **Semantic search**: Embed movie plots as vectors, search by meaning (e.g., "heist in space" finds Ocean's Eleven-type movies)
3. **Personalized search ranking**: For logged-in users, boost genres they prefer in results
