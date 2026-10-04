# Ratings

Movientum does not use stars. A user picks one of **four words** that describe how the title felt. There are no text reviews.

| Category | Meaning |
|---|---|
| `skip` | Not worth your time |
| `timepass` | Fine to have on, nothing special |
| `go_for_it` | Good, recommend it |
| `perfection` | Must-watch |

One rating per user per title. Rating again replaces the old one.

## The rating meter

Each title page shows how everyone voted as percentages of the four categories (`RatingMeter.jsx`). To avoid empty meters on new sites, `movie_ratings` / `tv_ratings` hold imported scores (from an external scraper) that seed the meter. User votes add on top.

## What happens when you rate

1. `POST /api/v1/ratings` → `rating_service.upsert_rating`.
2. If the title is not in `movies` yet, a small stub row is inserted first (the rating needs something to point at).
3. The rating row is inserted or updated; the aggregate meter is nudged.
4. Caches are busted: the title's distribution (`rating:dist:...`, shared by everyone), the user's ratings list, dashboard bundle, and the user's recommendation pools.

## Ratings and recommendations

Ratings are **not** sent through the thumbs feedback path, so they do not directly change `user_taste_profiles` weights. They still affect recommendations:
- Titles the user rated low are excluded from their feeds.
- Rated titles count as "interacted" for news personalisation and analysis.

Taste weights move from thumbs, watch history and watchlist actions instead (see `../ml_and_recommendations/recommendation_engine_overview.md`).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/ratings` | Rate or re-rate |
| GET | `/api/v1/ratings/me` | Your ratings (cached 48 h, busted on write) |
| GET | `/api/v1/ratings/distribution/{type}/{id}` | Meter data (cached 7 d, busted when anyone rates) |
| PUT / DELETE | `/api/v1/ratings/{id}` | Change or remove |
| POST | `/api/v1/ratings/needed` | Ask for a title to get a meter score |
