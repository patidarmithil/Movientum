# Watchlists and Watch History

## Two systems exist

| System | Tables | Router | Status |
|---|---|---|---|
| **Collections** (many named lists) | `watchlist_collections`, `watchlist_items` | `watchlist.py` → `/api/v1/watchlists` | Main user experience |
| Single watchlist + watch history | `watchlist`, `watch_history` | `watch.py` → `/api/v1/watch` | Still live (dashboard, detail buttons, "watched") |

The two watchlists are not synced. Before changing a screen, check which one it reads.

## Collections

A user can make any number of lists ("Weekend sci-fi", "Watch with family"). Each list can mix movies and shows.

| Action | Endpoint |
|---|---|
| List / create | `GET` / `POST /watchlists` |
| Which lists hold this title | `GET /watchlists/movie/{type}/{id}/status` |
| Open / rename / delete a list | `GET` / `PATCH` / `DELETE /watchlists/{id}` |
| Add / remove a title | `POST /watchlists/{id}/items`, `DELETE /watchlists/{id}/items/{type}/{id}` |
| Upload / remove banner image | `POST` / `DELETE /watchlists/{id}/cover` (resized, WebP, stored in Supabase Storage) |
| Streaming services per item | `GET /watchlists/{id}/providers` (for the OTT filter) |

The list page (`WatchlistDetail.jsx`) has filters, the banner, and an OTT filter so you can see what is on Netflix, Prime, etc.

## Caching

Lists, list details, provider lists and "which lists hold this title" are cached 48 h. Every add/remove/rename busts exactly the keys it touched, so the bookmark on a detail page updates at once.

## Effect on recommendations

The **single watchlist and watch history** (`watch.py`) are taste signals (`feedback_labels.py`):

| Action | Genre weight change | Label for training |
|---|---|---|
| Watched | +15 | 5 |
| Added to watchlist | +8 | 4 |
| Removed from watchlist | −8 | 2 |
| Un-watched | −15 | 2 |

The update runs in the background after the response. The user's recommendation cache switches to a 3-minute lifetime so the feed reacts quickly. Watched and watchlisted titles are removed from that user's recommendations, and they are the seeds the "For You" feed is built from.

**Collections** do not change taste weights. Adding to a collection only busts the user's recommendation and dashboard caches.

## Related TV trackers

- `watching_tracker` — follow a show; a daily job (04:00) creates a notification when the next episode airs.
- `temp_tracker` — a light "interested" marker before committing to a list.
