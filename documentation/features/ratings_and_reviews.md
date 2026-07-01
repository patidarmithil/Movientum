# Ratings System

## Overview & Architecture

Movientum rejects the traditional 5-star or 10-point rating scale. Instead, it utilizes a proprietary, 4-category categorical rating system designed to capture the user's *emotional intent* and *viewing context* rather than an arbitrary numerical score. 

The platform **does not support text reviews**.

---

## Logics & Business Rules

### The 4 Categories
1. **`skip`** (Value 1): "I regret watching this / Do not recommend."
2. **`timepass`** (Value 2): "It was okay to have on in the background, but nothing special."
3. **`go_for_it`** (Value 3): "Solid movie, highly recommend for a movie night."
4. **`perfection`** (Value 4): "Absolute masterpiece, must-watch."

### ML Impact
These categorical ratings serve as the strongest explicit signals for the Recommendation Engine. 
- A `perfection` rating aggressively updates the `UserTasteProfile` JSONB vectors (Genre, Cast, Crew), heavily boosting those traits.
- A `skip` rating applies a negative weight penalty, teaching the XGBoost model to avoid similar content.

---

## Code Structure & Detailed Logic

### Database Implementation (`orm_models.py`)
Ratings are stored in the `ratings` table. The `rating` column is constrained to `INTEGER` values 1 through 4. A unique constraint ensures a user can only have one active rating per movie (upsert behavior).

```python
class Rating(Base):
    __tablename__ = "ratings"
    id = Column(Integer, primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    movie_id = Column(Integer, ForeignKey("movies.id"))
    rating = Column(Integer, nullable=False) # 1=skip, 2=timepass, 3=go_for_it, 4=perfection
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

### Routing (`ratings.py`)
- `POST /api/v1/ratings`: Upserts a user's rating for a specific `movie_id`.
- `DELETE /api/v1/ratings`: Removes a rating.
- `GET /api/v1/ratings/me`: Fetches all ratings for the authenticated user, primarily used to populate the Dashboard.

---

## Tables & Summaries

### ML Signal Weights

| Rating Category | Integer | Taste Profile Impact |
|---|---|---|
| `perfection` | 4 | Huge Positive (+3.0) |
| `go_for_it` | 3 | High Positive (+1.5) |
| `timepass` | 2 | Mild Positive (+0.5) |
| `skip` | 1 | High Negative (-2.0) |

---

## Workflows & Lifecycles

### Rating Submission Flow
```mermaid
flowchart TD
    A[User clicks 'Perfection'] --> B[POST /api/v1/ratings]
    B --> C[Upsert row in 'ratings' table]
    C --> D[Trigger /api/v1/rec-feedback logic]
    D --> E[Update UserTasteProfile weights]
    E --> F[Invalidate Redis user:ratings:{uid}]
    F --> G[Return 200 OK]
```
