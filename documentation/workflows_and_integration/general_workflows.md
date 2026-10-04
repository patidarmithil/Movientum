# User Workflows

Step-by-step walks through what happens when a user does something. Each step names the file that does it.

## 1. Sign up / log in

1. `Register.jsx` or `Login.jsx` → `authService` → `POST /auth/register` or `/auth/login` (or `/auth/google`).
2. `auth_service.py` hashes or checks the password with bcrypt (Google: verifies the ID token).
3. Server returns an access token (48 h) and refresh token (7 days).
4. `storage.js` saves them — `localStorage` if "Remember me", else `sessionStorage`.
5. `AuthContext` marks the user logged in; `/` now goes to `/home`.

## 2. Token expires quietly

1. A request returns 401.
2. `api.js` holds all other requests, calls `/auth/refresh` once.
3. Server returns a new pair and blacklists the old refresh token in Redis.
4. The held requests are replayed. The user notices nothing. If refresh fails, they are logged out.

## 3. Open a movie page

1. `MovieDetail.jsx` → `pageService.getMovie` → `GET /pages/movie/{id}`.
2. `pages.py` reads the static bundle (shared, 7 days) and the user bundle (6 h) from Redis.
3. On a miss: read `movies`; if absent, fetch from TMDB, save it, and **in the background** add it to `content_catalog` and splice it into the graph.
4. The page shows details, rating meter, cast, trailers, providers. More Like This, AI picks and news load as the user scrolls.

## 4. Rate, watch, save

| Action | Endpoint | Effect |
|---|---|---|
| Rate | `POST /ratings` | Upsert rating, update meter, bust caches |
| Mark watched | `POST /watch` | Save history; background taste update (+15 genre); recs TTL drops to 3 min |
| Add to watchlist | `POST /watch/watchlist` | Taste update (+8 genre) |
| Add to a collection | `POST /watchlists/{id}/items` | Busts list and rec caches |

## 5. Search

1. User types in `SearchOverlay.jsx`; after 250 ms of quiet, check the in-memory cache.
2. `GET /search/instant` → `search_service.rank_titles`: trigram search in PostgreSQL, fuzzy scoring, TMDB only if local results are weak.
3. Nothing found → "Request this title" → `POST /requests`.

## 6. Get recommendations

1. `Home.jsx` / `Recommendations.jsx` → `GET /recommendations`.
2. Pick seeds (recent / established / diverse) from the user's history and watchlist.
3. For each seed: graph walk → 16 features → ranker → blend with baseline.
4. Merge buckets 12.5 / 65 / 17.5 / 7.5 %, re-order by relevance + quality + taste + novelty, spread genres, ensure language variety.
5. Cache 15 min per 5-page block.

Details: `../ml_and_recommendations/recommendation_engine_overview.md`.

## 7. Give feedback on a card

1. Thumbs on `FeedbackControl.jsx` → `POST /rec-feedback` (clicks batched to `/rec-feedback/batch`).
2. Server replies immediately; a background worker updates the taste profile, logs a training row, suppresses a dismissed title for 90 days, and busts rec caches.
3. The card is replaced by another one in the UI.
4. Tonight at 03:30 the ranker retrains on these rows.

## 8. Make a tier list

1. `/tierlist` → pick a template → `GET /tierlist/templates/{slug}` (resolved from TMDB on first open, cached 7 days).
2. Drag tiles into rows (`useTierDrag.js`). Guests autosave to `localStorage`.
3. Save → `POST /tierlist` (login). Share → `/tierlist/s/{shareId}` works for anyone.
4. Export PNG → drawn on a canvas in the browser.

## 9. Admin runs a job

1. `/admin` → System Tasks → press a job (e.g. "News Daily Fetch").
2. `POST /internal/trigger/news_daily_fetch` (admin token checked).
3. The job runs inside the API as a background task; the panel polls `/internal/progress/{task}`.
4. For news: fetch ~700 articles → dedupe to ~500 → enrich → swap the Redis snapshot.
