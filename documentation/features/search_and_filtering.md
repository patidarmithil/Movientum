# Search and Explore

## Search

Search is **local first**: it looks in our own database, and only asks TMDB when local results are weak. Search results are **never cached**, so they are always fresh.

### Three endpoints, one ranker

| Endpoint | Used by | Returns |
|---|---|---|
| `GET /api/v1/search/instant` | Full-screen overlay while typing | Top matches |
| `GET /api/v1/search/autocomplete` | Small dropdowns | Short suggestions |
| `GET /api/v1/search/` | Search results page | Paged results |

All three call `search_service.rank_titles` (movies and shows) or `rank_people` (cast and crew).

### How a query is matched

1. **Normalise** — lowercase, remove accents, punctuation, extra spaces, leading "the/a".
2. **Find candidates in PostgreSQL** — trigram similarity (`pg_trgm`) on a stored `title_search` column in `content_catalog` and `movies`, plus full-text search on overviews. People come from the local `people` table.
3. **Score** — `text_relevance` handles typos, prefixes and word order (using `rapidfuzz`), then a small popularity boost breaks ties.
4. **TMDB fallback** — only when the best local match is poor. People found on TMDB are saved to `people` in the background, so the next search is local.

### Frontend

`SearchOverlay.jsx` waits 250 ms after the last keystroke, keeps the last 50 answers in memory, and supports keyboard navigation. If nothing is found, the user can request the title (`POST /api/v1/requests`, guests allowed).

## Explore (filtering and browsing)

| Page | Route | What it does |
|---|---|---|
| Explore results | `/explore` | Filters in the URL (genre, year, language, country, sort…), infinite scroll |
| Facet hub | `/explore/:facet` | Browse by category, genre, country, language, family, anime, franchise |
| Franchise page | `/explore/franchise/:slug` | All titles of one franchise, numbered |

Backend:
- `GET /api/v1/movies/explore` — `explore_service.py` turns friendly filter names into TMDB discover parameters (`data/explore_taxonomy.py`). Keyword names are resolved to ids once and cached 30 days; result pages are cached 4 h.
- `GET /api/v1/explore/franchises` — ranked franchise list served from baked data in `data/explore_franchises.py` (no database or TMDB call).
- Also: `/movies/genre/{id}`, `/company/{id}`, `/country/{iso}`, `/collection/{id}`.
