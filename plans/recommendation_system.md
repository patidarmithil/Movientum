# Recommendation System

This document outlines the current logic and workings of the recommendation system for both the home page and individual item pages.

## 1) Home Page "For You" Section (Overall Recommendations)

The "For You" section provides personalized recommendations for authenticated users. The logic ensures exactly 20 items are returned, leveraging the user's watch history or falling back to trending content.

### Algorithm & Logic
- **Condition Check**: The system first checks how many movies the user has watched (`watch_history`).
- **Trending Fallback (Cold Start)**: 
  - If the user has watched **fewer than 3 movies**, the system uses a `trending_fallback`.
  - It fetches the top trending items based on popularity and returns them.
- **Genre Affinity (Personalized)**: 
  - If the user has watched **3 or more movies**, the system utilizes a `genre_affinity` algorithm.
  - **Step 1**: It determines the user's top 3 favorite genres based on the frequency of genres in their watch history.
  - **Step 2**: It queries the database for movies that match these top 3 genres, which the user *has not yet watched*, sorted descending by popularity.
  - **Step 3 (Backfill)**: If the local database query returns fewer than 10 results, the system automatically reaches out to TMDB in parallel to discover additional movies and TV shows matching those top genres to backfill the recommendations.
  - **Step 4**: Results are deduplicated (ensuring watched items are excluded) and sliced to exactly 20 items.

### Caching
- Personalized recommendations are cached per user for **15 minutes**.
- The cache is invalidated automatically if the user adds a new movie to their watch history or modifies their ratings.

---

## 2) Individual Movie/TV Page Recommendations (More Like This)

The "More Like This" section on individual movie and TV pages has been upgraded for **accuracy, stability, and consistency** without increasing latency. The pipeline strictly limits TMDB API calls, focuses on high signal quality, and prevents irrelevant recommendations.

### Two-Stage Filtering & Relaxation Pipeline

1. **Fetch (Max 3 TMDB Calls)**: Concurrently fetch candidates (4 seconds timeout):
   - TMDB Recommendations for the given item.
   - TMDB Discover results (cross-type) based on the current item's genres.
   - TMDB Similar Items for the given item.
2. **Merge & Deduplicate**: Merge candidate sources in order (recommendations -> discover -> similar) and deduplicate by `(id, media_type)`.
3. **Hard Filter**: Filter candidates:
   - Must have a valid `poster_path`
   - `vote_count` $\ge$ 30
   - Exclude the current item.
4. **Strict Filter**: Keep items that pass strict quality checks:
   - `vote_average` $\ge$ 6.5
   - $\ge \min(2, \text{len}(current\_genre\_ids))$ genre matches.
   - Remove weak-only genres (Drama/Comedy only - matching genres cannot be a subset of `{18, 35}`).
   - Conditional Intensity Filter:
     - If calm-type: exclude high-intensity genres (Action 28, Horror 27, Thriller 53).
     - If action-type: must have at least one action genre.
     - If comedy-type: must have Comedy (35).
5. **Relax Level 1**: If candidates count < 40, append items that have $\ge 1$ genre match and `vote_average` $\ge$ 7.0.
6. **Relax Level 2**: If candidates count still < 40, append items that have `vote_average` $\ge$ 7.2.
7. **Final Fallback**: If candidates count still < 40, append items that have `vote_average` $\ge$ 6.5.
8. **Scoring & Personalization**:
   - Compute score: `0.50 * genre_match + 0.25 * rating_score + 0.15 * popularity_score + 0.10 * recency_score`.
   - Apply a $\times 1.2$ personalization boost to the top 50% of candidates matching the user's top 2 genres.
   - **No double filtering**: No items are discarded after the scoring stage.
9. **Sort & Slice**: Sort descending by final score and slice to exactly 40 items.
10. **Cache**: Wrap in bucket structures and cache with Redis.
