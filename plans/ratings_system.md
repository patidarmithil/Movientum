# Ratings System — Movientum

## Overview

Movientum combines a rich, fine-grained **numeric rating system (0–10 scale)** in the database with a simplified **4-tiered qualitative meter system** (Skip, Timepass, Go for it, Perfection) on the frontend. 

1. **User Rating**: Logged-in users can rate a movie across 4 specific categories (Story, Acting, Direction, Visuals) plus an **Overall Score** on a 0–10 scale. Alternatively, they can quick-rate using the 4-pill qualitative selector.
2. **Qualitative Mapping**: The system automatically groups the numeric `overall_score` into the 4 qualitative buckets for rendering the visual **Moctale Meter** (semicircular gauge).
3. **Database Storage**: Ratings are stored as numeric floats in the `ratings` table to preserve detailed signals for the FedPCL recommendation model.

---

## 1. Rating Categories & Numeric Mapping

For rendering the distribution meter on the frontend, numeric `overall_score` values are classified into the 4 buckets as follows:

| Category | Color | Range (overall_score) | Meaning | GNN Weight |
|---|---|---|---|---|
| **Skip** 🔴 | `#FF4D6D` | `[0.0, 5.0)` | Not worth time | `-1.0` (Strong Negative) |
| **Timepass** 🟡 | `#FFC300` | `[5.0, 7.0)` | Decent, forgettable | `+0.3` (Weak Positive) |
| **Go for it** 🟢 | `#00E5A0` | `[7.0, 9.0)` | Recommend | `+0.7` (Recommend) |
| **Perfection** 🟣 | `#9B59FF` | `[9.0, 10.0]` | Masterpiece | `+1.0` (Masterpiece) |

---

## 2. User Rating Flow

### 2.1 Frontend UX

- On the movie detail page, the rating widget displays the semicircular **Moctale Meter**.
- If the user is a guest, the meter is read-only, and rating pills are greyed out with a tooltip: `"Login to rate"`.
- If logged in, they can quick-rate by clicking one of the 4 pills directly, which maps to a default score:
  - **Skip**: `overall_score = 3.0`
  - **Timepass**: `overall_score = 6.0`
  - **Go for it**: `overall_score = 8.0`
  - **Perfection**: `overall_score = 10.0`
- Alternatively, clicking a "Detailed Rating" button opens a modal where the user can rate individual sub-categories (Story, Acting, Direction, Visuals) on a `0.0 - 10.0` slider. The overall score is then calculated as the average of the selected scores.

### 2.2 Rating Buttons Layout

```
[ Skip 🔴 ]  [ Timepass 🟡 ]  [ Go for it 🟢 ]  [ Perfection 🟣 ]
```

Visual: Colored pill buttons. The selected state glows with the category's signature color.

### 2.3 API — User Submits Rating

```http
POST /api/v1/ratings
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "movie_id": 27205,
  "overall_score": 8.0,
  "story_score": 8.5,       // Optional
  "acting_score": 7.5,      // Optional
  "direction_score": 8.0,   // Optional
  "visuals_score": 8.0,     // Optional
  "review_text": "Great visuals and direction!" // Optional
}
```

**Response 200:**
```json
{
  "id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d",
  "movie_id": 27205,
  "overall_score": 8.0,
  "updated_distribution": {
    "skip": 5,
    "timepass": 15,
    "go_for_it": 120,
    "perfection": 24,
    "total": 164
  }
}
```

- **UPSERT logic:** Stored in the `ratings` table. One rating per user per movie. If they rate again, the record is updated.
- On success, the UI refreshes the meter with the updated distribution.

### 2.4 API — Fetch User's Existing Rating

```http
GET /api/v1/ratings/status/27205
Authorization: Bearer <JWT>
```

**Response 200:**
```json
{
  "has_rated": true,
  "rating": {
    "overall_score": 8.0,
    "story_score": 8.5,
    "acting_score": 7.5,
    "direction_score": 8.0,
    "visuals_score": 8.0,
    "review_text": "Great visuals and direction!",
    "created_at": "2026-05-26T12:00:00Z"
  }
}
```

---

## 3. Seed Ratings Fallback Flow (TMDB Integration)

### 3.1 Purpose
Since local user ratings will be sparse when the platform launches, the system leverages TMDB's community ratings (`vote_average` and `vote_count` from the `movies` table) to generate a seed distribution for the meter. This ensures every movie has a populated gauge on day one.

### 3.2 Mapping Algorithm (TMDB to Moctale Meter)
When rendering a movie's meter, if the local user ratings are fewer than a threshold (e.g., 5 local ratings), the backend supplements the distribution using TMDB metrics:
1. **Total Seed Votes**: We cap the TMDB `vote_count` at a reasonable number (e.g., `100` votes) to ensure that local user ratings can eventually shift the meter distribution as they accumulate.
2. **Distribution Modeling**: We distribute these 100 votes across the 4 categories based on the movie's TMDB `vote_average`:
   * If `vote_average` < 5.0: 60% Skip, 30% Timepass, 10% Go for it, 0% Perfection.
   * If 5.0 <= `vote_average` < 7.0: 10% Skip, 60% Timepass, 25% Go for it, 5% Perfection.
   * If 7.0 <= `vote_average` < 8.5: 2% Skip, 18% Timepass, 65% Go for it, 15% Perfection.
   * If `vote_average` >= 8.5: 0% Skip, 5% Timepass, 35% Go for it, 60% Perfection.

### 3.3 Dynamic Merge Logic
When a client requests the rating distribution:
* **Sparse User Ratings (< 5 total local ratings)**: The API merges the actual user ratings with the simulated TMDB seed distribution (weighted to sum to 100 votes).
* **Mature User Ratings (>= 5 total local ratings)**: The API phases out the TMDB seed data entirely and shows only actual user ratings to represent the local community.

---

## 4. Meter UI — Semicircular Design

### 4.1 Visual Spec (from image reference)

```
        ████████████████████
      ██   Go for it (green) ██
    █                          █
  █  Timepass(yellow)           Perfection(purple)  █
     Skip (red tip)             (purple tip)
         
         79%
        112/142 Votes

  ● Skip 1%  ● Timepass 11%  ● Go for it 79%  ● Perfection 9%
```

- Semicircle arc split proportionally by category percentages
- Arc drawn left-to-right: Skip → Timepass → Go for it → Perfection
- Center text: dominant category % + total votes count
- Bottom legend: 4 colored dots + label + %

### 4.2 Arc Rendering Logic

```
Total = skip + timepass + go_for_it + perfection

skip_pct      = skip / total * 100
timepass_pct  = timepass / total * 100
go_for_it_pct = go_for_it / total * 100
perfection_pct = perfection / total * 100

Arc segments drawn using SVG or Canvas:
- Total arc = 180° (semicircle)
- Each segment angle = (category_pct / 100) * 180°
- Colors: #FF4D6D | #FFC300 | #00E5A0 | #9B59FF
```

### 4.3 Empty Meter State

If no ratings:
- Draw full arc in muted gray (`#333`)
- Center text: "No ratings yet"
- Legend shows all 4 categories at 0%

### 4.4 Frontend Component

```
<RatingMeter
  distribution={{ skip, timepass, go_for_it, perfection }}
  userRating="go_for_it"   // null if not rated
  onRate={(category) => submitRating(movieId, category)}
/>
```

Props:
- `distribution` — counts object (required)
- `userRating` — string | null (current logged-in user pick)
- `onRate` — callback (null if user not logged in → buttons hidden)

---

## 5. Database Schema

The system uses the main `ratings` table defined in [orm_models.py](file:///c:/Users/USER/Desktop/BTP_baseline/FedPCL%20code/backend/app/db/orm_models.py). The schema is:

```sql
CREATE TABLE ratings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id        INTEGER NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  story_score     FLOAT CHECK (story_score >= 0 AND story_score <= 10),
  acting_score    FLOAT CHECK (acting_score >= 0 AND acting_score <= 10),
  direction_score FLOAT CHECK (direction_score >= 0 AND direction_score <= 10),
  visuals_score   FLOAT CHECK (visuals_score >= 0 AND visuals_score <= 10),
  overall_score   FLOAT NOT NULL CHECK (overall_score >= 0 AND overall_score <= 10),
  review_text     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at      TIMESTAMPTZ,
  UNIQUE (user_id, movie_id)  -- one rating per user per movie
);

CREATE INDEX idx_ratings_movie_id ON ratings(movie_id);
CREATE INDEX idx_ratings_user_id  ON ratings(user_id);
```

---

## 6. API — Get Movie Rating Distribution

```http
GET /api/v1/ratings/distribution/27205
```

**Response 200:**
```json
{
  "movie_id": 27205,
  "distribution": {
    "skip": 5,
    "timepass": 15,
    "go_for_it": 120,
    "perfection": 24,
    "total": 164
  },
  "percentages": {
    "skip": 3.0,
    "timepass": 9.1,
    "go_for_it": 73.2,
    "perfection": 14.6
  },
  "dominant_category": "go_for_it",
  "average_overall_score": 7.85,
  "has_data": true
}
```

---

## 7. Backend Service Logic

### 7.1 `RatingService` — Key Methods

```python
class RatingService:

    async def submit_user_rating(self, user_id: UUID, rating_data: RatingCreateSchema) -> dict:
        # 1. UPSERT into ratings table
        # 2. Invalidate Redis cache for movie:detail:{movie_id} and rating:distribution:{movie_id}
        # 3. Return the newly computed distribution

    async def get_distribution(self, movie_id: int) -> dict:
        # 1. Check Redis cache for key "rating:dist:{movie_id}"
        # 2. If HIT: return cached JSON
        # 3. If MISS: Query the ratings table using count filters:
        #    SELECT 
        #      COUNT(*) FILTER (WHERE overall_score < 5.0) AS skip,
        #      COUNT(*) FILTER (WHERE overall_score >= 5.0 AND overall_score < 7.0) AS timepass,
        #      COUNT(*) FILTER (WHERE overall_score >= 7.0 AND overall_score < 9.0) AS go_for_it,
        #      COUNT(*) FILTER (WHERE overall_score >= 9.0) AS perfection,
        #      AVG(overall_score) AS avg_score,
        #      COUNT(*) AS total
        #    FROM ratings WHERE movie_id = :movie_id
        # 
        # 4. If total < 5, dynamically merge with TMDB vote_average & vote_count fallback
        # 5. Save final compiled distribution to Redis (TTL = 300s)
        # 6. Return distribution payload

    async def get_user_rating(self, user_id: UUID, movie_id: int) -> Optional[dict]:
        # SELECT from ratings WHERE user_id = :user_id AND movie_id = :movie_id
```

---

## 8. Caching Strategy

| Layer | What is Cached | TTL | Rebuilding Trigger |
|---|---|---|---|
| **Redis** | `rating:dist:{movie_id}` (distribution JSON) | 300s | Read-through on cache miss, invalidated on rating submit |
| **Redis** | `movie:detail:{movie_id}` (includes ratings distribution) | 3600s | Invalidated on rating submit |

On rating submission:
1. Invalidate both Redis cache keys.
2. Next read will recompute from PostgreSQL `ratings` table and cache the new distribution.

---

## 9. Recommendation System Integration

The `ratings` table feeds the FedPCL recommendation engine:
* **Positive Signal**: `overall_score` >= 6.0 (corresponds to `Go for it` or `Perfection`).
* **Weak Positive Signal**: `5.0` <= `overall_score` < `6.0` (corresponds to `Timepass`).
* **Strong Negative Signal**: `overall_score` < 5.0 (corresponds to `Skip`).

Mapping used in local GNN graph construction (see `fedpcl_system_implemented.md`):
* `overall_score` in `[9.0, 10.0]` (Perfection) → weight `1.0`
* `overall_score` in `[7.0, 9.0)` (Go for it) → weight `0.7`
* `overall_score` in `[5.0, 7.0)` (Timepass) → weight `0.3`
* `overall_score` < `5.0` (Skip) → weight `-1.0` (negative edge)

---

## 10. Edge Cases & Rules

| Case | Behavior |
|---|---|
| **User rates same movie twice** | **UPSERT**: Updates the existing row in `ratings` table, invalidates caches, and recomputes the meter. |
| **No ratings exist (local & TMDB)** | **Empty Meter**: Gray arc shown, center text: `"No ratings yet"`, legend shows 0% for all categories. |
| **Sparse local ratings (< 5 votes)** | **TMDB Fallback Merged**: Merges local ratings with simulated TMDB seed distribution (weighted to sum to 100 votes). |
| **Mature local ratings (>= 5 votes)** | **Community Only**: Ignores TMDB seeds entirely, displaying 100% real local user ratings. |
| **User not logged in** | **Read-Only Meter**: Semicircle and legend are visible. Quick-rating pills and rating buttons are disabled/hidden. |

---

## 11. Future Considerations

- **Rating Abuse Detection**: Implement rate-limiting on submission (e.g., maximum of 1 rating per movie per user, and 5 rating updates per day per user).
- **Region-Specific Seeding**: Support regional TMDB ratings mapping based on user's region configuration.
- **FedPCL Re-training Trigger**: Queue the user for local retraining in the next federated round once they submit a new rating.

