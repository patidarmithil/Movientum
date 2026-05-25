# Ratings System — Movientum

## Overview

Two rating flows:
1. **User Rating** — logged-in user picks one of 4 categories for a movie
2. **Predefined Rating** — admin-imported bulk data (JSON) → classified into same 4 categories → shown as meter to all visitors

Both converge into single UI: semicircular meter showing distribution across 4 categories.

---

## 1. Rating Categories

| Category | Color | Meaning | Value (stored) |
|---|---|---|---|
| Skip | Red (`#FF4D6D`) | Not worth time | `skip` |
| Timepass | Yellow (`#FFC300`) | Decent, forgettable | `timepass` |
| Go for it | Green (`#00E5A0`) | Recommend | `go_for_it` |
| Perfection | Purple (`#9B59FF`) | Masterpiece | `perfection` |

These are the **only** valid rating values — no stars, no decimals.

---

## 2. User Rating Flow

### 2.1 Frontend UX

- On movie detail page → rating widget shows semicircular meter
- If user not logged in → meter visible (read-only), buttons greyed with tooltip "Login to rate"
- If logged in + not rated → 4 colored buttons visible below meter
- If logged in + already rated → user's pick highlighted, option to change
- On click → optimistic UI update → API call → confirm or revert on error

### 2.2 Rating Buttons Layout

```
[ Skip 🔴 ]  [ Timepass 🟡 ]  [ Go for it 🟢 ]  [ Perfection 🟣 ]
```

Visual: colored pill buttons. Selected = glowing border + filled bg.

### 2.3 API — User Submits Rating

```
POST /api/v1/ratings
Auth: Bearer <JWT>

Body:
{
  "movie_id": "tt1234567",
  "category": "go_for_it"   // skip | timepass | go_for_it | perfection
}

Response 200:
{
  "success": true,
  "user_rating": "go_for_it",
  "updated_distribution": {
    "skip": 1, "timepass": 11, "go_for_it": 80, "perfection": 9,
    "total": 101
  }
}
```

- UPSERT logic — one rating per user per movie
- On success → frontend updates meter live

### 2.4 API — Fetch User's Existing Rating

```
GET /api/v1/ratings/user?movie_id=tt1234567
Auth: Bearer <JWT>

Response:
{
  "movie_id": "tt1234567",
  "category": "go_for_it",   // null if not rated
  "rated_at": "2026-05-20T10:00:00Z"
}
```

---

## 3. Predefined Rating Flow (Bulk / Admin)

### 3.1 Purpose

User provides pre-classified movie rating data (JSON) from external sources (critics, aggregators, etc.).  
Admin feeds this → system stores as `predefined_ratings` → visible on meter even when user ratings are sparse.

### 3.2 Input JSON Format (admin-provides)

```json
[
  {
    "movie_id": "tt1234567",
    "source": "critics_pool_2024",
    "ratings": {
      "skip": 2,
      "timepass": 15,
      "go_for_it": 112,
      "perfection": 13
    }
  },
  ...
]
```

User (admin) classifies external data into these 4 buckets before upload.  
System does **not** auto-classify — user does classification, provides ready JSON.

### 3.3 Admin Ingest API

```
POST /api/v1/admin/ratings/bulk
Auth: Bearer <Admin JWT>

Body: JSON array as above

Response:
{
  "inserted": 142,
  "skipped": 3,   // duplicates by movie_id + source
  "errors": []
}
```

- Idempotent by `(movie_id, source)` — re-upload same source safe
- Stored in `predefined_ratings` table (separate from user ratings)

### 3.4 How predefined + user ratings merge for meter

```
combined_distribution = user_ratings + predefined_ratings (summed by category)
```

Display priority:
- If combined total > 0 → show meter with real data
- If total = 0 → show **empty meter** (grayed out, label: "No ratings yet")

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

### 5.1 `user_ratings` table

```sql
CREATE TABLE user_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  movie_id    VARCHAR(20) NOT NULL,  -- TMDB/IMDB id
  category    VARCHAR(20) NOT NULL   -- skip | timepass | go_for_it | perfection
                CHECK (category IN ('skip','timepass','go_for_it','perfection')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, movie_id)  -- one rating per user per movie
);

CREATE INDEX idx_ur_movie_id ON user_ratings(movie_id);
CREATE INDEX idx_ur_user_id  ON user_ratings(user_id);
```

### 5.2 `predefined_ratings` table

```sql
CREATE TABLE predefined_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id    VARCHAR(20) NOT NULL,
  source      VARCHAR(100) NOT NULL,   -- e.g. "critics_pool_2024"
  skip        INT DEFAULT 0,
  timepass    INT DEFAULT 0,
  go_for_it   INT DEFAULT 0,
  perfection  INT DEFAULT 0,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (movie_id, source)
);

CREATE INDEX idx_pr_movie_id ON predefined_ratings(movie_id);
```

### 5.3 `rating_distribution_cache` (denormalized, fast read)

```sql
CREATE TABLE rating_distribution_cache (
  movie_id    VARCHAR(20) PRIMARY KEY,
  skip        INT DEFAULT 0,
  timepass    INT DEFAULT 0,
  go_for_it   INT DEFAULT 0,
  perfection  INT DEFAULT 0,
  total       INT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

Cache rebuilt on:
- Any user_rating INSERT/UPDATE
- Any predefined_ratings bulk import
- Can also use Redis hash for hot movies

---

## 6. API — Get Movie Rating Distribution

```
GET /api/v1/ratings/distribution?movie_id=tt1234567

Response 200:
{
  "movie_id": "tt1234567",
  "distribution": {
    "skip": 1,
    "timepass": 11,
    "go_for_it": 80,
    "perfection": 9,
    "total": 101
  },
  "percentages": {
    "skip": 1.0,
    "timepass": 10.9,
    "go_for_it": 79.2,
    "perfection": 8.9
  },
  "dominant_category": "go_for_it",
  "has_data": true   // false → show empty meter
}
```

Read from `rating_distribution_cache` → fast, no heavy JOIN.

---

## 7. Backend Service Logic

### 7.1 `RatingService` — key methods

```python
class RatingService:

    def submit_user_rating(user_id, movie_id, category):
        # 1. UPSERT into user_ratings
        # 2. Recompute distribution cache for this movie
        # 3. Invalidate Redis key for movie
        # 4. Return updated distribution

    def get_distribution(movie_id):
        # 1. Check Redis cache → return if hit
        # 2. Query rating_distribution_cache
        # 3. If miss → compute from scratch, store in cache
        # 4. Return distribution + percentages

    def get_user_rating(user_id, movie_id):
        # Simple SELECT from user_ratings

    def bulk_import_predefined(data: list[dict]):
        # 1. Validate JSON structure
        # 2. UPSERT into predefined_ratings (by movie_id + source)
        # 3. Recompute distribution cache for all affected movies
        # 4. Return insert/skip/error counts

    def rebuild_distribution_cache(movie_id):
        # 1. SUM user_ratings by category for movie_id
        # 2. SUM predefined_ratings by category for movie_id
        # 3. Add together → write to rating_distribution_cache
        # 4. Write to Redis with TTL=300s
```

---

## 8. Caching Strategy

| Layer | What cached | TTL |
|---|---|---|
| Redis | `rating_dist:{movie_id}` hash | 300s |
| PostgreSQL | `rating_distribution_cache` table | Updated on write |

On rating submit → invalidate Redis key → next read recomputes from DB.  
Hot movies (trending) → Redis TTL reduced to 60s.

---

## 9. Recommendation System Integration

`user_ratings` feeds FedPCL recommendation engine:
- `go_for_it` + `perfection` → **positive** signal (user likes)
- `skip` → **strong negative** signal
- `timepass` → **weak positive** signal

Mapping used in local GNN graph (see `fedpcl_system_implemented.md`):
```
perfection → weight 1.0
go_for_it  → weight 0.7
timepass   → weight 0.3
skip       → weight -1.0  (negative edge)
```

---

## 10. Edge Cases & Rules

| Case | Behavior |
|---|---|
| User rates same movie twice | UPSERT — replaces old rating |
| No ratings exist | Empty meter shown (gray arc, "No ratings yet") |
| Only predefined, no user ratings | Meter uses predefined data |
| Only user ratings, no predefined | Meter uses user data |
| Admin re-uploads same source | UPSERT by (movie_id, source) — safe |
| User not logged in | Meter visible, rate buttons hidden |
| Movie not in predefined list | Falls back to user ratings only |
| Total votes = 0 | `has_data: false` → empty meter |

---

## 11. Future Considerations

- **Weight predefined vs user ratings** — currently equal sum; can add confidence weighting
- **Per-region predefined sets** — different sources for different regions
- **Rating analytics dashboard** — admin sees distribution trends over time
- **Abuse detection** — rate limiting on rating endpoint (1 change per 24h per movie)
- **FedPCL training trigger** — batch rating updates trigger local model retraining round
