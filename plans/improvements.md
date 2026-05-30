# Movientum — Recommendation Improvements Plan
## Part 2: Individual Movie/TV Page Recommendations

> **Scope:** This document covers the fully redesigned recommendation engine for individual movie/TV detail pages.  
> **Goal:** Return 40 high-quality, personalized, diverse recommendations using multi-factor scoring, user signals, and TMDB data.

---

## 2.1 Output Requirement

The endpoint must always return exactly **40 items**, split by media type:

| Metric | Value | Count |
|--------|-------|-------|
| Total results | 100% | 40 |
| Same media type | 60% | 24 |
| Cross media type | 40% | 16 |

**Why 40?**
Enough to fill multiple scroll rows on the UI. Provides sufficient exploration without overwhelming the user.

**Why 60/40 split?**
Users viewing a movie primarily want movie suggestions, but cross-media keeps the feed fresh and encourages TV discovery (and vice versa).

---

## 2.2 Media Balance Logic

The media type of the **current item being viewed** determines the split:

| Current Item | Same-Type (24 items) | Cross-Type (16 items) |
|-------------|----------------------|-----------------------|
| Movie | 24 movies | 16 TV shows |
| TV Show | 24 TV shows | 16 movies |

### Data Sources

| Type | TMDB Endpoint | Notes |
|------|--------------|-------|
| Same-type | `GET /movie/{id}/similar` or `/movie/{id}/recommendations` | Prefer `/recommendations` (smarter algo); fall back to `/similar` |
| Same-type (TV) | `GET /tv/{id}/similar` or `/tv/{id}/recommendations` | Same logic |
| Cross-type | `GET /discover/movie` or `/discover/tv` | Filter by `with_genres` using genres from current item |

### Implementation Detail
```python
async def fetch_candidates(item_id, media_type, genres):
    same_type_endpoint = f"/{media_type}/{item_id}/recommendations"
    cross_type = "tv" if media_type == "movie" else "movie"
    genre_ids = ",".join(str(g["id"]) for g in genres)

    same_task = tmdb_get(same_type_endpoint)
    cross_task = tmdb_get(f"/discover/{cross_type}", params={
        "with_genres": genre_ids,
        "sort_by": "vote_average.desc",
        "vote_count.gte": 100
    })
    trending_task = tmdb_get("/trending/all/week")

    same_results, cross_results, trending_results = await asyncio.gather(
        same_task, cross_task, trending_task, return_exceptions=True
    )
    return same_results, cross_results, trending_results
```

**Fallback:** If `/recommendations` returns < 10 items, also call `/similar` and merge both.

---

## 2.3 Recommendation Buckets

After scoring, the final 40 results are split into 3 quality tiers:

| Bucket | Positions | Count | Purpose |
|--------|-----------|-------|---------|
| Bucket 1 | 1–15 | 15 | High confidence — best matches |
| Bucket 2 | 16–30 | 15 | Medium relevance — solid picks |
| Bucket 3 | 31–40 | 10 | Exploration — serendipitous finds |

**Bucket assignment is purely score-based** — top 15 scored items go to Bucket 1, next 15 to Bucket 2, remainder to Bucket 3. Buckets are **not pre-labeled during fetch** — they emerge from the final sort.

**Why buckets matter:**
- Bucket 3 is where trending injection and exploration items go (see §2.12, §2.20).
- Rewatch items are inserted at fixed positions rather than displacing high-score items (see §2.11).
- UI can optionally render different bucket sections differently.

---

## 2.4 Multi-Factor Similarity Scoring

Each candidate item receives a composite score. This replaces the old simple-sort approach.

### Formula

```
final_score =
  (
    0.40 * genre_match_score
  + 0.20 * rating_score
  + 0.15 * popularity_score
  + 0.15 * keyword_similarity_score
  + 0.10 * recency_score
  ) * similarity_weight
+ user_preference_score * user_weight
```

Where `similarity_weight + user_weight = 1.0` (see §2.21 for dynamic weighting).

### Weight Rationale

| Factor | Weight | Reason |
|--------|--------|--------|
| Genre match | 0.40 | Strongest signal of relevance |
| Rating quality | 0.20 | Ensures we don't surface trash |
| Popularity | 0.15 | Proxy for quality + discoverability |
| Keyword similarity | 0.15 | Thematic similarity beyond genre |
| Recency | 0.10 | Slight preference for modern content |

---

## 2.5 Feature Extraction

Before scoring any candidate, extract features from the **current item** (the one being viewed).

### What to Extract

| Feature | Source | How |
|---------|--------|-----|
| `genre_ids` | TMDB item detail | `item["genre_ids"]` |
| `keyword_ids` | TMDB `/movie/{id}/keywords` or `/tv/{id}/keywords` | `.keywords[].id` |
| `vote_average` | TMDB item detail | `item["vote_average"]` |
| `popularity` | TMDB item detail | `item["popularity"]` |
| `release_year` | TMDB item detail | parse `release_date` or `first_air_date` |

### Implementation
```python
async def extract_features(item_id: int, media_type: str) -> dict:
    detail_task = tmdb_get(f"/{media_type}/{item_id}")
    keyword_task = tmdb_get(f"/{media_type}/{item_id}/keywords")

    detail, kw_data = await asyncio.gather(detail_task, keyword_task)

    keywords_key = "keywords" if media_type == "movie" else "results"
    keyword_ids = {kw["id"] for kw in kw_data.get(keywords_key, [])}

    date_field = "release_date" if media_type == "movie" else "first_air_date"
    release_year = int(detail.get(date_field, "0000")[:4]) or None

    return {
        "genre_ids": set(detail.get("genre_ids", [])),
        "keyword_ids": keyword_ids,
        "vote_average": detail.get("vote_average", 0),
        "popularity": detail.get("popularity", 0),
        "release_year": release_year,
    }
```

**Cache this result** — the same current item is used for all candidate scoring. No need to re-fetch per candidate.

---

## 2.6 Scoring Rules (Qualitative Adjustments)

On top of the normalized multi-factor score, apply rule-based adjustments:

| Condition | Adjustment | Notes |
|-----------|-----------|-------|
| Exact genre match (all genres match) | +0.10 bonus | Very strong match |
| Keyword overlap ≥ 50% | +0.08 bonus | Thematic twin |
| Keyword overlap ≥ 25% | +0.04 bonus | Thematic sibling |
| High rating (vote_average > 7.5) | +0.05 bonus | Quality signal |
| Very old content (> 30 years) | −0.05 penalty | Slight age penalty |
| Low popularity (popularity < 5) | −0.05 penalty | Obscure content risk |

These are **additive post-multipliers** applied after the weighted score computation, before final sort.

---

## 2.7 Quality Filter (Mandatory — Run BEFORE Scoring)

**Purpose:** Eliminate junk before scoring to reduce compute and protect output quality.

Filter out any candidate where:

| Filter | Threshold | Reason |
|--------|-----------|--------|
| Low rating | `vote_average < 6.0` | Below-average quality |
| Too few votes | `vote_count < 50` | Statistically unreliable rating |
| No poster | `poster_path IS NULL` | Unusable in UI |
| Is current item | `id == current_item_id` | Don't recommend itself |

### Implementation
```python
def passes_quality_filter(item: dict, current_item_id: int) -> bool:
    if item["id"] == current_item_id:
        return False
    if item.get("vote_average", 0) < 6.0:
        return False
    if item.get("vote_count", 0) < 50:
        return False
    if not item.get("poster_path"):
        return False
    return True

candidates = [c for c in raw_candidates if passes_quality_filter(c, current_item_id)]
```

**Order matters:** Run filter → deduplicate → score. Never score items that will be discarded.

---

## 2.8 User Personalization Layer

Blend the content-based similarity score with the user's personal preference signals.

### Inputs

| Signal | Source | Weight in user_preference_score |
|--------|--------|---------------------------------|
| Watched genres | `watch_history` table | 0.50 |
| Highly rated genres | `ratings` table (score ≥ 4) | 0.30 |
| Click behavior genres | `click_history` table | 0.20 |

### Computing user_preference_score

```python
def compute_user_preference_score(
    candidate_genre_ids: set,
    watched_genre_profile: dict,   # {genre_id: normalized_weight}
    rated_genre_profile: dict,
    click_genre_profile: dict,
) -> float:
    score = 0.0
    for genre_id in candidate_genre_ids:
        score += (
            watched_genre_profile.get(genre_id, 0) * 0.50
          + rated_genre_profile.get(genre_id, 0)  * 0.30
          + click_genre_profile.get(genre_id, 0)  * 0.20
        )
    # Normalize by number of candidate genres to keep 0–1 range
    return min(score / max(len(candidate_genre_ids), 1), 1.0)
```

### Blending Formula

```python
# Dynamic weights (see §2.21)
similarity_weight, user_weight = get_dynamic_weights(user)

final_score = (
    similarity_score * similarity_weight
  + user_preference_score * user_weight
)
```

**Cold-start handling:** If user has no watch/rate/click history, `user_preference_score = 0` and `user_weight` drops to 0.0 (pure similarity scoring).

---

## 2.9 Context-Aware Boost

Based on the **primary genre** of the current item, apply a score multiplier to candidates that match thematically related genres.

### Genre Boost Map

| Current Primary Genre | Boost Applied To | Multiplier |
|-----------------------|------------------|-----------|
| Action | Action, Thriller | × 1.10 |
| Romance | Romance, Drama | × 1.10 |
| Sci-Fi | Sci-Fi, Mystery | × 1.10 |
| Horror | Horror, Thriller | × 1.10 |
| Comedy | Comedy, Romance | × 1.08 |
| Drama | Drama, History | × 1.08 |
| Animation | Animation, Family | × 1.08 |
| Crime | Crime, Thriller | × 1.10 |
| Fantasy | Fantasy, Adventure | × 1.08 |
| Documentary | Documentary | × 1.05 |

### Implementation
```python
CONTEXT_BOOST_MAP = {
    28:    {28, 53},    # Action → Action, Thriller
    10749: {10749, 18}, # Romance → Romance, Drama
    878:   {878, 9648}, # Sci-Fi → Sci-Fi, Mystery
    27:    {27, 53},    # Horror → Horror, Thriller
    35:    {35, 10749}, # Comedy → Comedy, Romance
    18:    {18, 36},    # Drama → Drama, History
    16:    {16, 10751}, # Animation → Animation, Family
    80:    {80, 53},    # Crime → Crime, Thriller
    14:    {14, 12},    # Fantasy → Fantasy, Adventure
    99:    {99},        # Documentary → Documentary
}

def apply_context_boost(score: float, candidate_genre_ids: set, current_primary_genre_id: int) -> float:
    boost_targets = CONTEXT_BOOST_MAP.get(current_primary_genre_id, set())
    if candidate_genre_ids & boost_targets:
        return score * 1.10
    return score

# primary genre = first genre_id in current item's genre list
current_primary_genre_id = list(current_features["genre_ids"])[0] if current_features["genre_ids"] else None
```

---

## 2.10 Diversity Control (Soft Penalties)

After scoring, prevent repetitive feed by applying soft score penalties rather than hard cuts.

### Rules

| Constraint | Threshold | Penalty |
|-----------|-----------|---------|
| Same genre count exceeds limit | > 5 items with same primary genre | −10% score per additional item |
| Same franchise | > 2 items in same franchise/collection | −15% score per additional item |
| Content age | All content from same decade | Distribute: prefer mix of old + new |

### Implementation
```python
def apply_diversity_penalties(scored_candidates: list) -> list:
    genre_counts = defaultdict(int)
    franchise_counts = defaultdict(int)

    for item in scored_candidates:
        primary_genre = item["genre_ids"][0] if item["genre_ids"] else None
        franchise_id = item.get("belongs_to_collection", {}).get("id") if item.get("belongs_to_collection") else None

        # Genre soft penalty
        if primary_genre:
            genre_counts[primary_genre] += 1
            if genre_counts[primary_genre] > 5:
                item["final_score"] *= 0.90

        # Franchise soft penalty
        if franchise_id:
            franchise_counts[franchise_id] += 1
            if franchise_counts[franchise_id] > 2:
                item["final_score"] *= 0.85

    return sorted(scored_candidates, key=lambda x: x["final_score"], reverse=True)
```

**Why soft penalties over hard limits:** Hard limits can discard a highly relevant item just because 5 other items of the same genre scored higher. Soft penalties preserve ranking intent while reducing dominance.

---

## 2.11 Smart Rewatch Injection

Deliberately surface already-watched items that are worth revisiting.

### Eligibility Criteria (ALL must pass quality filter §2.7)

| Condition | Logic |
|-----------|-------|
| User rated it high | `user_rating >= 4` (out of 5) |
| Item is popular | `popularity > 50` AND `vote_average > 7.5` |
| Not watched recently | `watched_at < NOW() - 6 months` |

At least ONE condition must be true. Quality filter must also pass.

### Score Gate
Only inject if candidate's similarity score ≥ median score of all candidates. Prevents low-quality rewatches polluting results.

### Injection Logic
```python
REWATCH_POSITIONS = [8, 16, 24, 32]
MAX_REWATCH = 5  # never inject more than 5

def inject_rewatches(final_list: list, rewatch_candidates: list, median_score: float) -> list:
    eligible = [
        r for r in rewatch_candidates
        if r["score"] >= median_score and passes_quality_filter(r, current_item_id)
    ][:MAX_REWATCH]

    for i, pos in enumerate(REWATCH_POSITIONS):
        if i >= len(eligible):
            break
        if pos < len(final_list):
            final_list.insert(pos, eligible[i])

    return final_list[:40]  # re-trim to 40
```

**Why these positions?** Positions 8, 16, 24, 32 fall at natural "scroll break" points — roughly every 2 rows on a standard horizontal scroll UI. Feels organic, not forced.

---

## 2.12 Trending Injection (Optional)

Inject trending content into the exploration bucket only.

### Source
`GET /trending/all/week` from TMDB.

### Eligibility Rules

| Rule | Value |
|------|-------|
| Genre match | At least 1 genre must match current item |
| Min rating | `vote_average ≥ 6.5` |
| Max count | 5 items max |
| Placement | Bucket 3 only (positions 31–40) |

### Implementation
```python
def filter_trending_for_injection(trending: list, current_genre_ids: set) -> list:
    return [
        t for t in trending
        if set(t.get("genre_ids", [])) & current_genre_ids
        and t.get("vote_average", 0) >= 6.5
        and t.get("poster_path")
    ][:5]

def inject_trending(final_list: list, trending_candidates: list) -> list:
    # Replace last N items in bucket 3 with trending items
    # Only if they aren't already in the list
    existing_ids = {(item["id"], item["media_type"]) for item in final_list}
    to_inject = [t for t in trending_candidates if (t["id"], t.get("media_type")) not in existing_ids]

    # Replace from position 35 onward (deep in bucket 3)
    inject_start = 35
    for i, item in enumerate(to_inject):
        pos = inject_start + i
        if pos < len(final_list):
            final_list[pos] = item

    return final_list
```

---

## 2.13 Final Pipeline

Complete execution flow in order. No step may be skipped.

```
STEP 1 — FEATURE EXTRACTION (parallel)
  - Fetch current item details
  - Fetch current item keywords
  → Produces: current_features (genres, keywords, vote_avg, popularity, year)

STEP 2 — CANDIDATE FETCH (parallel, async gather)
  - Same-type: GET /{media_type}/{id}/recommendations (+ /similar fallback)
  - Cross-type: GET /discover/{other_type}?with_genres=...
  - Trending:   GET /trending/all/week
  → Produces: raw_same[], raw_cross[], raw_trending[]

STEP 3 — CROSS-MEDIA RELEVANCE FILTER (§2.17)
  - For raw_cross items:
    - Keep only if ≥1 genre match OR keyword_score ≥ 0.25
    - Discard rest
  → Produces: filtered_cross[]

STEP 4 — MERGE
  - Combine raw_same[] + filtered_cross[] → raw_candidates[]

STEP 5 — QUALITY FILTER (§2.7)
  - Remove: vote_average < 6, vote_count < 50, no poster, is current item
  → Produces: quality_candidates[]

STEP 6 — DEDUPLICATION
  - Remove duplicates by (id, media_type) composite key
  → Produces: unique_candidates[]

STEP 7 — SCORE NORMALIZATION (§2.15)
  For each candidate, compute normalized sub-scores:
  - rating_score     = vote_average / 10
  - popularity_score = log(popularity + 1) / log(max_popularity_in_batch)
  - recency_score    = 1 - (current_year - release_year) / MAX_YEAR_GAP (=100)
  - genre_score      = |candidate_genres ∩ current_genres| / |current_genres|
  - keyword_score    = |candidate_keywords ∩ current_keywords| / |current_keywords|
                       (0 if current item has no keywords)

STEP 8 — MULTI-FACTOR SCORING (§2.4)
  similarity_score =
    0.40 * genre_score
  + 0.20 * rating_score
  + 0.15 * popularity_score
  + 0.15 * keyword_score
  + 0.10 * recency_score

STEP 9 — RULE ADJUSTMENTS (§2.6)
  Apply bonuses/penalties:
  - Full genre match → +0.10
  - keyword overlap ≥ 50% → +0.08
  - keyword overlap ≥ 25% → +0.04
  - vote_average > 7.5 → +0.05
  - release_year < current_year - 30 → -0.05
  - popularity < 5 → -0.05

STEP 10 — USER PERSONALIZATION (§2.8, §2.21)
  - Compute user_preference_score per candidate
  - Determine dynamic weights (strong/weak user data)
  final_score = similarity_score * sim_w + user_preference_score * usr_w

STEP 11 — CONTEXT-AWARE BOOST (§2.9)
  - Apply genre-based multiplier per §2.9 map

STEP 12 — SORT DESCENDING BY final_score

STEP 13 — DIVERSITY SOFT PENALTIES (§2.10, §2.18)
  - Apply penalty for genre count > 5
  - Apply penalty for franchise count > 2
  - Re-sort after penalties

STEP 14 — BUCKET ENFORCEMENT (§2.22)
  - Bucket 1: items[0:15]
  - Bucket 2: items[15:30]
  - Bucket 3: items[30:40]

STEP 15 — SMART REWATCH INJECTION (§2.11, §2.19)
  - Fetch user's watched + rated items
  - Filter eligible rewatch candidates
  - Insert at positions [8, 16, 24, 32] (max 5)

STEP 16 — TRENDING INJECTION (§2.12, §2.20)
  - Filter trending by genre + quality
  - Replace positions 35–39 if slots available (max 5)

STEP 17 — FINAL TRIM
  - Slice to exactly 40 items
  - If < 40: invoke fallback (§2.23)

STEP 18 — RETURN
```

---

## 2.14 Performance Rules

| Rule | Implementation |
|------|---------------|
| Parallel TMDB calls | All independent fetches via `asyncio.gather` |
| Hard timeout | 5 seconds total. If any fetch exceeds, skip it and continue with what's available |
| Cache keyword data | Redis key: `tmdb:keywords:{media_type}:{id}` TTL: 24 hours |
| Cache final recs | Redis key: `recs:{media_type}:{item_id}:{user_id}` TTL: 5–10 min (lower for popular items) |
| Non-blocking persistence | Fire-and-forget: log impressions/scores async |
| Filter before score | Always quality-filter + deduplicate before scoring to cut compute |
| Max parallel TMDB calls | 3–4 concurrent. Don't exceed TMDB rate limit (40 req/10s) |

---

## 2.15 Score Normalization

**Problem:** Raw values (e.g., `popularity = 400`, `vote_average = 7.5`, `release_year = 1995`) are on incompatible scales. Without normalization, popularity dominates the score formula.

**Solution:** Normalize every sub-score to [0, 1] before weighting.

```python
import math

MAX_YEAR_GAP = 100  # treat anything > 100 years old as max-old

def normalize_scores(candidate: dict, max_popularity: float, current_year: int) -> dict:
    vote_avg = candidate.get("vote_average", 0)
    popularity = candidate.get("popularity", 0)

    date_field = "release_date" if candidate["media_type"] == "movie" else "first_air_date"
    raw_year = candidate.get(date_field, "")
    release_year = int(raw_year[:4]) if raw_year and raw_year[:4].isdigit() else current_year

    rating_score = vote_avg / 10.0
    popularity_score = math.log(popularity + 1) / math.log(max_popularity + 1) if max_popularity > 0 else 0.0
    recency_score = max(0.0, 1.0 - (current_year - release_year) / MAX_YEAR_GAP)

    return {
        **candidate,
        "rating_score": rating_score,
        "popularity_score": popularity_score,
        "recency_score": recency_score,
    }
```

**max_popularity** = max popularity value across the current batch of candidates (computed once before scoring loop).

---

## 2.16 Keyword Similarity

**Problem:** Without a definition, "keyword_similarity" in the score formula is unimplementable.

**Definition:**

```
keyword_score = |candidate_keyword_ids ∩ current_keyword_ids| / |current_keyword_ids|
```

- If current item has **0 keywords** → `keyword_score = 0.0` for all candidates (no penalty, just neutral)
- If candidate has no keyword data available → `keyword_score = 0.0` (fetch attempted, skip gracefully)

### Thresholds
| Overlap | Classification | Bonus (see §2.6) |
|---------|---------------|-----------------|
| ≥ 50% | Strong thematic match | +0.08 |
| ≥ 25% | Medium thematic match | +0.04 |
| < 25% | Low / none | No bonus |

### Implementation
```python
def compute_keyword_score(
    candidate_keyword_ids: set,
    current_keyword_ids: set
) -> float:
    if not current_keyword_ids:
        return 0.0
    intersection = candidate_keyword_ids & current_keyword_ids
    return len(intersection) / len(current_keyword_ids)
```

**Keyword fetch strategy:** Fetch candidate keywords only for items that pass the quality filter. Cache per item in Redis (TTL 24h). Never re-fetch if cached.

---

## 2.17 Cross-Media Relevance Filter

**Problem:** When discovering TV shows for a movie (or vice versa), TMDB `/discover` returns genre-matched results, but a "History" genre movie may not meaningfully cross to a "History" TV show.

**Solution:** Apply a relevance gate before cross-type items enter the scoring pool.

### Gate Logic
```python
def cross_media_relevant(
    candidate: dict,
    current_genre_ids: set,
    current_keyword_ids: set
) -> bool:
    cand_genres = set(candidate.get("genre_ids", []))
    genre_match = bool(cand_genres & current_genre_ids)  # at least 1 shared genre

    # keyword similarity as secondary gate
    cand_keywords = get_cached_keywords(candidate["id"], candidate["media_type"])
    kw_score = compute_keyword_score(cand_keywords, current_keyword_ids)
    strong_keyword_match = kw_score >= 0.25

    return genre_match or strong_keyword_match
```

**Applied to:** Only cross-type candidates. Same-type candidates skip this filter (they already matched via TMDB's own algorithm).

---

## 2.18 Dynamic Diversity Control

**Problem:** Hard limit "max 5 per genre" removes the 6th item even if it scores 0.95. This wastes a great match.

**Solution:** Soft penalty system. The 6th item of the same genre stays in the list but gets a score penalty, pushing it lower.

### Rules
```python
GENRE_THRESHOLD = 5
FRANCHISE_THRESHOLD = 2
GENRE_PENALTY = 0.10      # 10% reduction per excess item
FRANCHISE_PENALTY = 0.15  # 15% reduction per excess item

def apply_diversity_penalties(items: list) -> list:
    genre_seen = defaultdict(int)
    franchise_seen = defaultdict(int)

    for item in items:
        g = item.get("primary_genre_id")
        f = item.get("franchise_id")

        if g:
            genre_seen[g] += 1
            if genre_seen[g] > GENRE_THRESHOLD:
                excess = genre_seen[g] - GENRE_THRESHOLD
                item["final_score"] *= (1.0 - GENRE_PENALTY * excess)

        if f:
            franchise_seen[f] += 1
            if franchise_seen[f] > FRANCHISE_THRESHOLD:
                excess = franchise_seen[f] - FRANCHISE_THRESHOLD
                item["final_score"] *= (1.0 - FRANCHISE_PENALTY * excess)

    return sorted(items, key=lambda x: x["final_score"], reverse=True)
```

**Caps:** Score never goes below 0. Penalty multiplied per excess count (diminishing but bounded).

---

## 2.19 Rewatch Injection Correction

**Problem:** Injecting rewatch items blindly degrades list quality — a low-scoring item could displace a high-scoring one.

**Solution:** Only inject if the rewatch item's similarity score passes a score gate.

### Score Gate
```python
scores = [item["similarity_score"] for item in scored_candidates]
median_score = statistics.median(scores)

eligible_rewatches = [
    r for r in rewatch_candidates
    if r["similarity_score"] >= median_score
    and passes_quality_filter(r, current_item_id)
][:5]
```

### Injection
Insert at positions [8, 16, 24, 32] — these are 0-indexed. Items already at those positions shift right. Final list trimmed back to 40.

```python
def inject_at_positions(final_list: list, items_to_inject: list, positions: list) -> list:
    for i, pos in enumerate(positions):
        if i >= len(items_to_inject):
            break
        final_list.insert(pos + i, items_to_inject[i])  # +i accounts for previous inserts
    return final_list[:40]
```

---

## 2.20 Trending Injection Control

**Problem:** Trending ≠ Relevant. A trending action movie shouldn't appear in results for a documentary.

### Strict Gate
```python
def filter_trending(
    trending: list,
    current_genre_ids: set,
    current_item_id: int
) -> list:
    return [
        t for t in trending
        if set(t.get("genre_ids", [])) & current_genre_ids   # at least 1 genre match
        and t.get("vote_average", 0) >= 6.5                   # quality gate
        and t.get("poster_path")                              # has UI asset
        and t["id"] != current_item_id                        # not the current item
    ][:5]  # max 5 items
```

### Placement
- Place only in **Bucket 3** (positions 31–40).
- Never inject into Bucket 1 or 2 — those are reserved for high-confidence matches.
- Replace positions 35–39 (last 5 of bucket 3) with trending items, if available.

---

## 2.21 Dynamic User Weighting

**Problem:** A user with 1 watch and no ratings should not have the same user weight as one with 200 watches and 50 ratings.

**Solution:** Determine user data strength, then set weights accordingly.

### Strength Thresholds
```python
def get_dynamic_weights(
    watch_count: int,
    rating_count: int,
    click_count: int
) -> tuple[float, float]:
    """Returns (similarity_weight, user_weight)"""

    # Strong: enough data to trust user profile
    if watch_count >= 20 or rating_count >= 10 or click_count >= 30:
        return (0.60, 0.40)

    # Moderate: some data, moderate trust
    if watch_count >= 5 or rating_count >= 3 or click_count >= 10:
        return (0.70, 0.30)

    # Weak: cold start, rely on content similarity
    return (0.80, 0.20)
```

**Note:** User weighting only applies to authenticated users. For anonymous requests, use (1.0, 0.0) — pure similarity.

---

## 2.22 Bucket Enforcement

**Problem:** Buckets were conceptually defined but not enforced in code — items weren't actually sliced into buckets before delivery.

**Solution:** After full scoring + diversity + rewatch injection, slice the sorted list into explicit buckets:

```python
def enforce_buckets(final_list: list) -> dict:
    return {
        "bucket_1": final_list[0:15],   # High confidence
        "bucket_2": final_list[15:30],  # Medium relevance
        "bucket_3": final_list[30:40],  # Exploration
    }

# Or flatten for API response (buckets tracked internally for logging/analytics)
```

**UI contract:** The API may return a flat list of 40 OR return the bucket structure. Frontend decides rendering. Bucket metadata can be included per-item for future UI differentiation.

---

## 2.23 Fallback Handling

**Problem:** TMDB sometimes returns fewer results than expected (obscure item, new release, limited catalog).

### Fallback Cascade
```python
async def ensure_40_candidates(candidates: list, current_genre_ids: set, media_type: str) -> list:
    if len(candidates) >= 40:
        return candidates

    deficit = 40 - len(candidates)
    existing_ids = {(c["id"], c["media_type"]) for c in candidates}

    # Fallback 1: Trending (filtered by genre)
    trending = await tmdb_get("/trending/all/week")
    filtered_trending = [
        t for t in trending
        if set(t.get("genre_ids", [])) & current_genre_ids
        and (t["id"], t.get("media_type", media_type)) not in existing_ids
        and t.get("vote_average", 0) >= 6.0
    ]

    candidates.extend(filtered_trending[:deficit])

    if len(candidates) >= 40:
        return candidates

    # Fallback 2: Top rated in matching genres
    genre_ids_str = ",".join(str(g) for g in current_genre_ids)
    top_rated = await tmdb_get(f"/discover/{media_type}", params={
        "sort_by": "vote_average.desc",
        "with_genres": genre_ids_str,
        "vote_count.gte": 200,
    })
    for item in top_rated:
        if (item["id"], media_type) not in existing_ids:
            candidates.append(item)
        if len(candidates) >= 40:
            break

    return candidates
```

**Edge case:** If fallbacks still can't fill 40 (extremely niche item), return as many as available (e.g., 30) rather than padding with unrelated content.

---

## 2.24 Performance Optimization — Full Spec

| Optimization | Implementation |
|-------------|---------------|
| Parallel fetches | `asyncio.gather(same_task, cross_task, trending_task, keyword_task)` |
| Total timeout | `asyncio.wait_for(pipeline(), timeout=5.0)` |
| Keyword cache | Redis key: `kw:{media_type}:{id}`, TTL: 24h |
| Current item feature cache | Redis key: `features:{media_type}:{id}`, TTL: 1h |
| Final recs cache | Redis key: `recs:{media_type}:{item_id}:{user_id}`, TTL: 5 min (popular items: 10 min) |
| User profile cache | Redis key: `user_profile:{user_id}`, TTL: 15 min |
| Concurrent TMDB cap | Max 4 parallel calls to stay under TMDB rate limit (40 req/10s) |
| Filter before score | Quality filter runs first; scoring only on clean candidates |
| Score batch compute | Compute `max_popularity` once before the loop; don't recompute per candidate |
| Non-blocking writes | Impression logging / score persistence via background task (FastAPI `BackgroundTasks`) |

### Cache TTL Strategy

| Cache | TTL | Reason |
|-------|-----|--------|
| Keyword data | 24 hours | Keywords rarely change |
| Item features | 1 hour | Details stable short-term |
| Final recs (popular item) | 10 min | Higher traffic, stable enough |
| Final recs (obscure item) | 5 min | Less traffic, still fresh |
| User profile | 15 min | Balances freshness vs compute |

### Timeout Behavior
If TMDB times out for any single call:
- Same-type times out → use cross-type only, still attempt 40
- Cross-type times out → use same-type only
- Trending times out → skip trending injection, continue without it
- Keywords time out → keyword_score = 0 for all, scoring continues

Never block the response waiting for failed TMDB calls.
