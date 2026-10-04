# API Endpoints

All endpoints live under `/api/v1/` and are registered in `backend/app/main.py`. Interactive docs are at `/docs` when `DEBUG=true`.

**Auth legend:** 🔒 login required · 🔓 optional (personalised if logged in) · 👑 admin · — public

## Routers

| Prefix | File | Main endpoints |
|---|---|---|
| `/auth` | `auth.py` | `register`, `login`, `google`, `refresh`, `logout` 🔒, `me` 🔒, `device-session`, `device-login`, `reset-password` |
| `/pages` | `pages.py` | `home`, `movie/{id}`, `tv/{id}`, `person/{id}`, `dashboard` 🔒 — one-call page bundles |
| `/movies` | `movies.py` | `trending`, `explore` 🔓, `genre/{id}`, `top_rated`, `upcoming`, `collection/{id}`, `company/{id}`, `country/{iso}`, `{id}`, `{id}/videos`, `{id}/credits`, `{id}/watch_providers` |
| `/tv` | `tv.py` | `{id}`, `{id}/videos`, `{id}/season/{n}/videos`, `{id}/credits`, `{id}/watch_providers` |
| `/person` | `person.py` | `{id}`, `{id}/credits` |
| `/search` | `search.py` | `instant`, `autocomplete`, `/` (results page). Not cached |
| `/explore` | `explore.py` | `franchises` |
| `/ratings` | `ratings.py` | `POST /` 🔒, `me` 🔒, `distribution/{type}/{id}`, `PUT`/`DELETE {id}` 🔒, `needed` 🔒 |
| `/watch` | `watch.py` | Watch history and single watchlist 🔒, `status/{type}/{id}` |
| `/watchlists` | `watchlist.py` | Collections CRUD, items, `cover`, `providers`, per-title status 🔒 |
| `/recommendations` | `recommendations.py` | `/` 🔒 (For You), `similar/{id}` 🔓, `content` 🔓 (DNA basket), `guest` |
| `/rec-feedback` | `recommendation_signals.py` | `/` and `/batch` 🔒 — thumbs, clicks, undo |
| `/ai-recs` | `ai_recs.py` | `similar` 🔓, `memory` GET/POST 🔒 |
| `/news` | `news.py` | `feed`, `categories`, `search`, `saved` 🔒, `status`, `for-title/{type}/{id}`, `article/{id}`, `article/{id}/view` 🔓, `/save` 🔒, `/feedback` 🔒 |
| `/trailers` | `trailers.py` | `home` 🔓 |
| `/tierlist` | `tierlist.py` | `templates`, `templates/{slug}`, `characters/{media}/{id}`, `share/{id}`, `mine` 🔒, CRUD on `{id}` 🔒 |
| `/users` | `users.py` | `me/analysis`, `/engine`, `/feedback`, taste-profile, date-range, rec-preferences, profile, password, delete, `import-list` 🔒 |
| `/notifications` | `notifications.py` | list, mark seen, mark all seen 🔒 |
| `/watching-tracker` | `watching_tracker.py` | `track`, `untrack`, `status/{id}` 🔒 |
| `/temp-tracker` | `temp_tracker.py` | add, remove, list 🔒 |
| `/feedback` | `feedback.py` | Bug reports with optional image 🔒 |
| `/contact` | `contact.py` | `POST` public, `GET` 👑 |
| `/requests` | `requests.py` | `POST` — request a missing title (guests allowed) |
| `/clicks` | `clicks.py` | Legacy; nothing in the frontend calls it. Clicks now go through `/rec-feedback` |
| `/admin` | `admin.py` | `stats`, `analytics`, `users` (list/delete/role/message) 👑 |
| `/internal` (also mounted at `/internal`) | `internal.py` | `trigger/{task}`, `progress/{task}`, `cancel/{task}` 👑 — admin panel jobs |

`GET /api/health` → `{status, version, environment, dependencies}`; 503 if the database or Redis is down.

## Conventions

- **Route order**: fixed paths come before `/{id}` in the same router, or FastAPI treats the word as an id.
- **Errors**: always `{error, message, status_code, code}`. Validation errors use code `MV-BVD01`, unexpected errors `MV-BSV01`.
- **Frontend mapping**: each `frontend/src/services/*.js` file wraps one router. `AI_Context/API_MAP.md` lists every function → endpoint.
