# Content-Based Recommendations Implementation (Phase 2)

## Overview & Architecture

### Goal
The `/rec-content` feature allows a user to build a basket of movies/TV shows and request "Find Similar" items. The backend extracts common traits, combines a Random Walk with Restart (RWR) graph query with TMDB Discovery, interleaves the results using Team-Draft Interleaving (TDI), and scores them for relevance.

---

## Code Structure & Detailed Logic

### 1. Deterministic Seeding & Caching
To maintain stable pagination across infinite scrolls without serving duplicate items, the incoming basket is hashed and cached.
```python
# Deterministic Seeding
sorted_items_json = json.dumps(sorted(items, key=lambda x: (x["tmdb_id"], x["media_type"])))
items_hash = hashlib.sha256(sorted_items_json.encode()).hexdigest()
random.seed(items_hash)

# Page Cache Check
page_cache_key = f"rec:content:{items_hash}:page:{page}"
cached_page = await get_cached(page_cache_key)
if cached_page:
    return cached_page
```

### 2. Trait Extraction
The backend fetches the `ContentCatalog` rows for the basket items and extracts their traits:
- `basket_genres`: All unique genres across the basket.
- `basket_keywords`: All unique keywords.
- `common_genres`: The strict intersection of genres across all items in the basket.
- `top_seeds`: The top 2 most popular items in the basket, used as seeds for graph traversal.

### 3. Strategy A: Graph RWR (Random Walk with Restart)
For the `top_seeds`, the system traverses the bipartite content graph (loaded via `get_or_build_graph()`).
```python
G = await get_or_build_graph(db)
merged_rwr_score = {}
if G:
    for seed_row in top_seeds:
        seed_node = f"{seed_row.media_type}_{seed_row.tmdb_id}"
        if G.has_node(seed_node):
            candidates = get_rwr_candidates(G, seed_node, top_k=80)
            for k, v in candidates.items():
                merged_rwr_score[k] = max(merged_rwr_score.get(k, 0), v)
```
The resulting RWR candidates are retrieved from the database using an `OR` condition query.

### 4. Strategy B: TMDB Discovery
If `common_genres` exist (or falling back to up to 3 `basket_genres`), the system fetches pages directly from TMDB's discover API to augment the graph candidates with fresh data.
```python
discover_genres = list(common_genres) if common_genres else list(basket_genres)[:3]
if discover_genres:
    genre_str = ",".join(map(str, discover_genres))
    tmdb_page = math.ceil(page / 2.0) if page > 0 else 1
    movies = await tmdb_service_instance.discover_movies(genre_str, page=tmdb_page)
```

### 5. Blending & Hard Filtering
The candidates from Strategy A and Strategy B are interleaved using **Team-Draft Interleaving (TDI)** with a 70% preference for RWR candidates (`ratio_a=0.7`).
```python
blended = team_draft_interleave(
    rwr_candidates, 
    tmdb_candidates, 
    k=len(rwr_candidates) + len(tmdb_candidates), 
    ratio_a=0.7
)
```
**Filters Applied:**
1. Items already in the user's basket.
2. Items with `vote_count < 50`.
3. Items with no `poster_path`.
4. Items previously seen on earlier paginated pages (tracked via `rec:content:{items_hash}:seen` cache).

### 6. Final Scoring
Each filtered item is given a final score based on a weighted sum of its traits relative to the basket's traits.
```python
genre_score = len(c_genre_ids.intersection(basket_genres))
keyword_score = len(c_keyword_ids.intersection(basket_keywords))

rating_score = (c.get("vote_average", 0) / 10.0)
pop_score = math.log1p(c.get("popularity", 0))

raw_rwr = merged_rwr_score.get(node_key, 0.0)
normalized_rwr_score = raw_rwr / max_rwr

final_score = (
    0.5 * genre_score
    + 0.2 * keyword_score
    + 0.15 * rating_score
    + 0.1 * pop_score
    + 0.2 * normalized_rwr_score
)
```
The top 20 candidates per page are then returned and the seen cache is updated.

---

## Logics & Business Rules

### Edge Cases & Guards
- **Empty Results**: Returns `[]` if both RWR and TMDB Discovery yield nothing.
- **Deduplication**: `team_draft_interleave` uses `tmdb_id` and `media_type` to guarantee no duplicate items are yielded in the interleaved pool.

---

## Tables & Summaries

### Cache Keys Used
| Cache Key | TTL | Description |
|---|---|---|
| `rec:content:{hash}:page:{page}` | 900s (15m) | Fully formatted JSON response for the specific page. |
| `rec:content:rwr:{hash}` | 1800s (30m) | Cached `basket_genres`, `basket_keywords`, `common_genres`, and `merged_rwr_score`. |
| `rec:content:{hash}:seen` | 1800s (30m) | Set of `(tmdb_id, media_type)` already served on previous pages. |
