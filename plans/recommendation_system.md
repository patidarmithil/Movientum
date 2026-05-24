# Recommendation System — Movientum

## Overview

Movientum recommendation system evolves in phases. Starts simple (rule-based, fast to build), transitions to collaborative filtering ML, then to federated learning via FedPCL. Each phase runs on top of the previous — no full rewrites.

---

## Phase 1: Rule-Based Recommendations (MVP)

No ML. Pure logic. Fast to implement.

### Logic

**For unauthenticated users:**
- Show globally popular movies (sorted by TMDB popularity score)
- Show "Trending Now" (movies popular this week)
- Show top-rated by genre (static genre rows)

**For authenticated users (no watch history yet):**
- Prompt for genre preferences during onboarding
- Show movies matching selected genres, sorted by rating
- "Start watching to get personalized picks"

**For authenticated users (with watch history):**

1. **Genre affinity**: Count genres in user's watch history → rank genres by frequency → recommend top movies in top genres NOT yet watched

2. **Director affinity**: If user watched 2+ movies by same director → recommend other movies by that director

3. **Rating-based expansion**: If user rated a movie ≥ 7.0 → find similar movies (same genre + similar vote_average) → recommend those

4. **Popularity boost**: Blend popular movies into recommendations (30%) so users discover trending content

### Recommendation Blend Formula (Phase 1)
```
final_list =
  (genre_affinity_picks × 0.40)
  + (director_affinity_picks × 0.20)
  + (similar_to_rated_picks × 0.20)
  + (trending_popular_picks × 0.20)
```

Deduplicate, remove already-watched, return top 20.

---

## Phase 2: Collaborative Filtering (ML-Based)

### Concept

"Users similar to you liked these movies." Don't use content similarity — use behavior similarity.

### User-Item Matrix

Build matrix where:
- Rows = users
- Columns = movies
- Cells = rating score (or 0 if not rated)

```
         Movie A  Movie B  Movie C  Movie D
User 1:    8.0      7.5      0        9.0
User 2:    0        8.0      7.0      0
User 3:    7.5      0        8.5      8.0
```

### Training

Use **Matrix Factorization** (e.g., SVD or ALS):
- Decompose sparse matrix into two dense matrices (user factors × movie factors)
- Dot product of user vector + movie vector = predicted rating
- Train to minimize prediction error
- Learns latent features (e.g., "user likes cerebral sci-fi")

### Serving Recommendations

For user U:
1. Get user's latent vector from trained model
2. Compute dot product with all movie vectors
3. Sort by predicted rating descending
4. Filter out already-watched movies
5. Return top N

### Watch History as Implicit Feedback

Not all users rate movies. Use watch history as implicit signal:
- Watched = positive signal (weight: 1.0)
- Rated + score ≥ 7 = strong positive signal (weight: 2.0)
- Rated + score < 5 = negative signal (weight: -0.5)
- Added to watchlist = weak positive signal (weight: 0.5)

### Retraining Schedule

- Full retrain: weekly (all data)
- Incremental update: daily (new ratings/watches)
- Model stored as serialized file, loaded into memory for serving

---

## Phase 3: FedPCL Integration (Privacy-Preserving ML)

See `fedpcl_system_implemented.md` for deep explanation.

Summary: Instead of sending user data to central server, ML model trains locally on each user's device. Only model updates (gradients) are sent. Central server aggregates updates. Privacy preserved.

---

## User Behavior Tracking

All behavior tracked for recommendation engine input:

| Event | Data Captured | Weight |
|-------|--------------|--------|
| Movie viewed (detail page) | user_id, movie_id, timestamp | 0.3 |
| Added to watchlist | user_id, movie_id, timestamp | 0.5 |
| Marked as watched | user_id, movie_id, timestamp | 1.0 |
| Rated (overall_score) | user_id, movie_id, score | score/10 × 2.0 |
| Search query | user_id, query, clicked_result | 0.4 |
| Time spent on detail page | user_id, movie_id, duration_sec | proportional |

Events stored in `events` table or streamed to analytics pipeline.

---

## Cold Start Problem

New user has no behavior history. Solutions:

1. **Onboarding survey**: Ask 5 genre preference questions during registration
2. **Genre-based defaults**: Show top movies in chosen genres
3. **Demographic defaults**: If region known, show locally popular content
4. **Explicit ratings ask**: Prompt user to rate 5–10 movies they've already seen
5. **Popularity fallback**: Show globally trending content

New movie (no ratings): rely on TMDB popularity + genre similarity to other movies.

---

## Recommendation Diversity

Pure ML recommendations can get "trapped" in bubble (only recommends same genre forever).

**Diversity strategies:**
- **Exploration budget**: 10% of recommendations = random picks from other genres
- **Genre rotation**: Ensure at least 3 different genres in top 20 results
- **Recency bonus**: Boost newly released movies in recommendations
- **User-controlled serendipity slider** (future): User sets how adventurous recommendations should be

---

## Serving Architecture

```
User requests recommendations
  │
  ├── Check Redis: user:recommendations:{user_id}
  │     ├── HIT → return (fast path)
  │     └── MISS ↓
  │
  ├── Load user behavior data from DB
  ├── Call recommendation engine:
  │     Phase 1: rule engine (in-process)
  │     Phase 2: ML model inference (in-process or separate service)
  │     Phase 3: FedPCL aggregated model inference
  │
  ├── Post-process: deduplicate, filter watched, apply diversity rules
  ├── Cache result in Redis (TTL: 15 min)
  └── Return top 20 recommendations
```

---

## Recommendation Types

| Type | Description | Where Shown |
|------|-------------|------------|
| For You | Personalized picks | Home page hero row |
| Because You Watched X | Based on specific movie | Movie Detail page |
| Top in [Genre] | Genre-specific top picks | Genre rows on Home |
| Trending Now | Global popularity spike | Home page |
| Continue Watching | Resume from watchlist | Home page |
| Hidden Gems | High rated, low popularity | Discovery section |
