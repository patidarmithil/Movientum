# Improvement: Moctale-Style Predictive In-Place Search

## Context

Current search redirects to `/search` page on submit. Target: Moctale UX — full-screen overlay panel, real-time results while typing, no page navigation, typo-tolerant.

**Reference:** Moctale images provided. Behavior: input stays in navbar, panel opens below it covering page, results update per keystroke, fuzzy match works ("off compus" → "Off Campus").

---

## 1. What Changes (Overview)

| Layer | Change | Scope |
|-------|--------|-------|
| Frontend: `SearchBar.jsx` | Full rewrite → `SearchOverlay.jsx` (new component) | Large |
| Frontend: `SearchBar.css` | Replace with `SearchOverlay.css` | Large |
| Frontend: `Navbar.jsx` | Wire search icon → overlay trigger | Small |
| Frontend: `searchService.js` | Add `liveSearch()` call + frontend query cache | Small |
| Backend: `search.py` | New `/api/v1/search/instant` endpoint (fast, limit=20) | Medium |
| Backend: `search_service.py` | Add fuzzy scoring via `pg_trgm` OR `rapidfuzz` | Medium |
| Backend: `cache.py` | New key `search:instant:{hash}` TTL 120s | Tiny |
| Backend: DB migration | Enable `pg_trgm` extension if not already active | One-time |

---

# Phase 1 — Frontend UI

## 2. Frontend Architecture

### 2.1 Component: `SearchOverlay.jsx` (replaces SearchBar)

**States:**
```
idle           → input unfocused, no panel
open-empty     → input focused, query empty → show trending
open-typing    → query >= 2 chars → show live results
open-loading   → debounce fired, request in-flight → skeleton
open-results   → results received
open-empty-res → results received but empty → no-results state
```

**Key refs/state:**
```js
[query, setQuery]             // controlled input value
[results, setResults]         // current result list
[trending, setTrending]       // preloaded trending (on mount)
[isOpen, setIsOpen]           // overlay visible
[isLoading, setIsLoading]     // spinner
[activeIdx, setActiveIdx]     // keyboard nav
[queryCache, setQueryCache]   // { [q]: results } — frontend memory cache
debounceTimer                 // useRef
overlaRef                     // outside-click detection
inputRef                      // focus control
```

### 2.2 Input Handling Flow

```
User types
  ↓
setQuery(val)
  ↓
clearTimeout(debounceTimer)
  ↓
if val.length < 2:
  show trending (already loaded)
else:
  setTimeout(250ms) → fetchResults(val)
```

**Frontend query cache logic:**
```js
// Before firing API:
if (queryCache[query]) {
  setResults(queryCache[query])  // instant — no API call
  return
}
// After API returns:
setQueryCache(prev => ({ ...prev, [query]: data }))
// Limit cache size to 50 entries (LRU eviction)
```

This gives sub-200ms feel for repeated queries during same session.

### 2.3 Overlay Layout (Moctale-matching)

```
[Navbar]
  └── [Search Input (full-width on focus)]
        ↓
[Overlay Panel — position: fixed, below navbar]
  ├── Tabs: Content | Cast & Crew (future)
  ├── Section: SEARCH RESULTS
  │     └── ResultCard × N (horizontal card style like Moctale)
  ├── Empty state: "Could not find..." + "Request Content" link
  └── Trending fallback (when input empty)
```

**Panel position:** `position: fixed`, `top: navbar_height`, `left: 0`, `right: 0`, `z-index: 1000`. Covers page content. Backdrop blur on background.

### 2.4 Result Card Structure

Each card (matches Moctale layout):
```
[Poster 80×110px] [Title + Year + Type badge]
                  [Genre (1 line) optional]
```

Cards laid horizontally in a grid row (like Moctale). Scrollable if > 5 results.

### 2.6 Close Behavior

- Click outside overlay → close
- Escape key → close
- Clear input (× button) → reset to trending view
- Route change → close (add `useEffect` on `location`)

### 2.7 Preload Trending (Empty State)

On overlay mount (first open), fire `movieService.getTrending()` if not already cached locally. Store in component state. Shown when query is empty.

---

## 8. Visual Design Spec

### 8.1 Overlay Panel

```css
/* Search overlay panel */
.search-overlay {
  position: fixed;
  top: var(--navbar-height);    /* flush below navbar */
  left: 0;
  right: 0;
  background: rgba(10, 10, 15, 0.96);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  z-index: 999;
  animation: overlayReveal 0.18s cubic-bezier(0.16,1,0.3,1) forwards;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px 32px;
}

@keyframes overlayReveal {
  from { opacity: 0; transform: translateY(-10px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

### 8.2 Input Bar (expanded state)

On focus: input expands to full navbar width (or fixed 640px centered like Moctale). Transition with `transition: width 0.2s ease`.

### 8.3 Result Card

```css
/* Horizontal card — like Moctale grid */
.search-result-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}

.search-result-card:hover,
.search-result-card--active {
  background: rgba(255,255,255,0.06);
}

.search-result-poster {
  width: 54px;
  height: 80px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  background: var(--surface-card);
}

.search-result-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.search-result-meta {
  font-size: 12px;
  color: var(--text-muted);
  /* e.g. "2026 • TV Show" */
}
```

### 8.4 Animation Sequence

| Event | Animation |
|-------|----------|
| Panel open | fadeIn + translateY(-10px → 0), 180ms ease-out |
| Results update | opacity 0.6 → 1 on results swap, 100ms |
| Card hover | background fade, 150ms |
| Panel close | fadeOut + translateY(0 → -6px), 120ms |

---

# Phase 2 — Backend API

## 3. Backend: New Instant Search Endpoint

### 3.1 Endpoint Spec

```
GET /api/v1/search/instant?q={query}&limit=20
```

- No pagination (single page, max 20 results)
- No auth required
- Cache TTL: 120s (2 min) — short because live typing
- Target latency: < 100ms backend (P95)

**Why separate from existing `/search`?**
Existing endpoint supports pagination, genre filter, is heavier. Instant endpoint is stripped-down, returns only fields needed for overlay card, can be tuned independently.

### 3.2 Response Shape

```json
{
  "data": {
    "results": [
      {
        "id": 123,
        "title": "Off Campus",
        "release_year": 2026,
        "media_type": "tv",
        "poster_path": "/abc.jpg",
        "vote_average": 7.4,
        "genres": ["Comedy", "Drama"]
      }
    ],
    "query": "off compus",
    "total": 3
  }
}
```

Minimal fields — no overview, no backdrop. Keeps payload small.

---

# Phase 3 — Fuzzy Matching

## 4. Fuzzy Matching Algorithm (Critical)

### 4.1 Strategy: Two-Tier Matching

Run two passes in parallel, merge results:

**Tier 1 — Exact / Prefix / FTS (fast, DB-side):**
```sql
-- Existing FTS (websearch_to_tsquery)
SELECT * FROM movies
WHERE search_vector @@ websearch_to_tsquery('english', $query)
ORDER BY ts_rank(...) DESC
LIMIT 20;
```

**Tier 2 — Trigram Similarity (fuzzy, DB-side):**
```sql
-- Requires: CREATE EXTENSION IF NOT EXISTS pg_trgm;
SELECT *, similarity(lower(title), lower($query)) AS sim
FROM movies
WHERE similarity(lower(title), lower($query)) > 0.15
  AND poster_path IS NOT NULL
ORDER BY sim DESC, popularity DESC
LIMIT 20;
```

Merge both result sets (deduplicate by `id_mediatype`), apply `_instant_score()` ranking.

### 4.2 Why `pg_trgm`?

- Already in PostgreSQL (Supabase supports it)
- No new Python dependency
- Computed DB-side → no Python loop
- GIN index on `lower(title)` → sub-10ms for typical queries
- Handles: "off compus" → "Off Campus" (similarity ≈ 0.6)

### 4.3 Alternative (if pg_trgm not available): `rapidfuzz`

```python
from rapidfuzz import fuzz, process

# Run after FTS returns < 5 results
titles_in_db = [...]   # top 200 popular titles from cache/DB
matches = process.extract(
    query,
    titles_in_db,
    scorer=fuzz.partial_ratio,
    limit=10,
    score_cutoff=60
)
```

Less preferred — requires loading title list into Python memory. Use `pg_trgm` first.

### 4.4 Similarity Threshold Tuning

| pg_trgm similarity | Example match | Include? |
|--------------------|---------------|----------|
| > 0.6 | "off compus" → "Off Campus" | ✅ Yes |
| 0.4–0.6 | "off campus" → "OK Computer" | ⚠️ Maybe (popularity tie-break) |
| < 0.15 | Unrelated | ❌ No |

Threshold `0.15` in SQL WHERE clause (wide net). Final ranking via score kills irrelevant results.

---

## 11. DB Migration (One-Time)

```sql
-- Run via Alembic or direct Supabase SQL editor
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index for fast trigram search on title
CREATE INDEX IF NOT EXISTS idx_movies_title_trgm
    ON movies USING GIN (lower(title) gin_trgm_ops);

-- Optional: also on lower(title || ' ' || COALESCE(original_title, ''))
```

Supabase supports `pg_trgm` — enable from dashboard or via migration. Index build time: fast for 100k rows (~seconds).

**Alembic migration file:** Create `alembic/versions/YYYYMMDD_instant_search_trgm.py`

---

# Phase 4 — Ranking & Merge

## 5. Backend Ranking Algorithm: `_instant_score()`

New scoring function replacing current `_relevance_score()` for the instant endpoint:

```python
def _instant_score(item: dict, query: str) -> float:
    title = (item.get("title") or "").lower()
    q = query.lower().strip()

    # --- Exact match signals ---
    exact     = 5.0 if title == q else 0.0
    starts    = 3.0 if title.startswith(q) else 0.0
    contains  = 2.0 if q in title else 0.0

    # --- Word overlap ---
    q_words  = set(q.split())
    t_words  = set(title.split())
    overlap  = len(q_words & t_words) / max(len(q_words), 1)
    word_hit = overlap * 2.5

    # --- Trigram similarity (from DB column 'sim' if available) ---
    trgm_sim = float(item.get("trgm_sim") or 0.0) * 3.0

    # --- Python fallback fuzzy (difflib) ---
    seq_sim  = difflib.SequenceMatcher(None, q, title).ratio() * 1.5

    # --- Popularity signal (log-scaled, capped) ---
    pop      = min(math.log(max(item.get("popularity") or 1.0, 1.0)), 8.0) * 0.3

    # --- Recency bonus ---
    year     = item.get("release_year") or 0
    recency  = 0.5 if year >= 2020 else (0.2 if year >= 2015 else 0.0)

    # --- Length penalty ---
    len_diff = abs(len(title) - len(q))
    penalty  = min(len_diff * 0.05, 1.0)

    return (
        exact + starts + contains + word_hit + trgm_sim + seq_sim + pop + recency
    ) - penalty
```

**Priority order effectively becomes:**
1. Exact title match
2. Title starts with query
3. Query contained in title
4. Word overlap
5. Trigram similarity (catches typos)
6. Python sequence similarity (fallback)
7. Popularity
8. Recency

---

## 6. Backend: DB Query Strategy

### 6.1 Full Query Plan

```python
async def instant_search(db: AsyncSession, query: str, limit: int = 20) -> list[dict]:
    """
    1. Run FTS + trigram concurrently
    2. Merge, score, sort
    3. Return top `limit` items
    """
    fts_task    = asyncio.create_task(_fts_query(db, query, limit))
    trgm_task   = asyncio.create_task(_trgm_query(db, query, limit))
    tmdb_task   = asyncio.create_task(_safe_tmdb_instant(query))

    fts_results, trgm_results, tmdb_results = await asyncio.gather(
        fts_task, trgm_task, tmdb_task
    )

    # Merge by dedup key = f"{id}_{media_type}"
    merged = {}
    for item in fts_results:
        k = f"{item['id']}_{item.get('media_type','movie')}"
        merged[k] = item
    for item in trgm_results:
        k = f"{item['id']}_{item.get('media_type','movie')}"
        if k not in merged:
            merged[k] = item
    for item in tmdb_results:
        k = f"{item['id']}_{item.get('media_type','movie')}"
        if k not in merged:
            merged[k] = item

    # Score + sort
    scored = sorted(
        merged.values(),
        key=lambda x: _instant_score(x, query),
        reverse=True
    )
    return scored[:limit]
```

### 6.2 TMDB Instant Call

```python
async def _safe_tmdb_instant(query: str) -> list[dict]:
    """TMDB multi_search with hard 3s timeout. Returns [] on timeout."""
    try:
        resp = await asyncio.wait_for(tmdb_service.multi_search(query), timeout=3.0)
        items = []
        for item in (resp.get("results") or []):
            if item.get("media_type") not in ("movie", "tv"):  continue
            if not item.get("poster_path"):                     continue
            if item.get("adult"):                               continue
            items.append(_tmdb_to_search_result(item))
        return items[:10]
    except:
        return []
```

---

# Phase 5 — UX & Performance

### 2.5 Keyboard Navigation

| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate result cards |
| `Enter` on card | `navigate(/movies/{id})` or `/tv/{id}` |
| `Enter` on input (no selection) | Open detail of top result |
| `Escape` | Close overlay, blur input |
| `Tab` | Close overlay |

---

## 7. Caching Plan

### 7.1 Backend Redis Cache

```python
# New key builder in cache.py
def key_instant_search(query: str) -> str:
    hash_ = hashlib.md5(query.lower().strip().encode()).hexdigest()[:8]
    return f"search:instant:{hash_}"

TTL_INSTANT_SEARCH = 120  # 2 min — live typing cache
```

Cache populated per query. Short TTL so new content appears quickly.

### 7.2 Frontend Memory Cache

```js
// In SearchOverlay.jsx — useRef persists across renders
const queryCacheRef = useRef({})
const CACHE_MAX = 50

function getCache(q) {
  return queryCacheRef.current[q.toLowerCase()] ?? null
}

function setCache(q, results) {
  const cache = queryCacheRef.current
  const keys = Object.keys(cache)
  if (keys.length >= CACHE_MAX) {
    delete cache[keys[0]]  // evict oldest
  }
  cache[q.toLowerCase()] = results
}
```

This makes previously-typed queries **instant** (0ms API call).

---

## 9. Empty / Error States

### 9.1 No Results

```jsx
<div className="search-empty">
  <p>Could not find what you&apos;re looking for</p>
  <button onClick={handleRequestContent}>Request Content</button>
</div>
```

`Request Content` → calls existing `POST /api/v1/ratings/needed` with `{title: query}`. Already implemented in backend.

### 9.2 Loading (debounce in-flight)

Skeleton cards: 3 placeholder cards with shimmer animation. Shown immediately after debounce fires (before API returns).

### 9.3 Input Empty

Show trending section:
```jsx
<div className="search-trending">
  <h4>TRENDING</h4>
  <div className="search-trending-grid">
    {trending.map(item => <TrendingChip key={item.id} item={item} />)}
  </div>
</div>
```

---

## 12. Performance Targets

| Metric | Target | How |
|--------|--------|---------|
| Debounce wait | 250ms | Frontend timer |
| Backend P95 latency | < 120ms | Parallel FTS+trgm+TMDB, Redis cache |
| Frontend cache hit | 0ms | In-memory queryCache |
| Redis cache hit | < 10ms | 2-min TTL |
| Panel open animation | 180ms | CSS animation |
| Perceived response | < 200ms | Debounce + skeleton |
| Max results returned | 20 | Hard limit |
| TMDB timeout | 3s | asyncio.wait_for |

---

## 10. Files to Create/Modify

### Backend (new/modified)

| File | Change |
|------|--------|
| `app/routers/search.py` | Add `GET /api/v1/search/instant` route (BEFORE existing routes) |
| `app/services/search_service.py` | Add `instant_search()`, `_trgm_query()`, `_instant_score()` |
| `app/db/cache.py` | Add `key_instant_search()`, `TTL_INSTANT_SEARCH = 120` |
| DB migration (one-time) | `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + GIN index on `lower(title)` |

### Frontend (new/modified)

| File | Change |
|------|--------|
| `src/components/SearchOverlay.jsx` | NEW — full replacement for SearchBar logic |
| `src/components/SearchOverlay.css` | NEW — overlay panel styles |
| `src/components/Navbar.jsx` | Replace `<SearchBar />` with `<SearchOverlay />` |
| `src/services/searchService.js` | Add `instantSearch(query)` function |
| `src/components/SearchBar.jsx` | Keep for reference but no longer used in Navbar |

---

## 13. Implementation Order

1. **DB migration** — enable pg_trgm, create GIN index
2. **Backend** — `instant_search()` service function + `_instant_score()`
3. **Backend** — `/api/v1/search/instant` router endpoint
4. **Backend** — cache key + TTL
5. **Frontend** — `searchService.js` add `instantSearch()`
6. **Frontend** — `SearchOverlay.jsx` (new component, all states)
7. **Frontend** — `SearchOverlay.css` (overlay styles)
8. **Frontend** — `Navbar.jsx` swap `<SearchBar>` → `<SearchOverlay>`
9. **Test** typo cases: "off compus", "intrstellar", "spiderman"
10. **Polish** animations, empty state, request content button
