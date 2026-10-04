# Frontend Architecture

The frontend in `frontend/src/` is a React 19 single-page app built with Vite. The browser renders everything; the backend only sends JSON. There is no CSS framework — every page has its own `.css` file next to it.

## Folder guide

| Folder | What lives there |
|---|---|
| `pages/` | One component per route (`Home.jsx`, `MovieDetail.jsx`, `Explore.jsx`, `TierBoard.jsx`, …) with a matching CSS file. `pages/settings/` and `pages/analysis/` hold sub-sections |
| `components/` | Reusable pieces: `MovieCard`, `MovieRow`, `FeedbackControl` (thumbs), `SearchOverlay`, `Navbar`, `RatingMeter`, trailer and news cards, `tierlist/` board parts |
| `services/` | One file per backend area (`movieService.js`, `newsService.js`, …). Pages call these, never `axios` directly |
| `hooks/` | Shared logic: scroll restore, session state, tier drag engine, hide-and-replace after a thumbs-down |
| `utils/` | `api.js` (the HTTP client), `storage.js` (token storage), tier export/images, analytics |
| `context/` | `AuthContext.jsx` — who is logged in |

## The HTTP client (`utils/api.js`)

All network traffic goes through one Axios instance. It:
1. Adds `Authorization: Bearer <token>` to every request.
2. On a 401, pauses other requests, refreshes the token once, then replays them.
3. Waits up to **120 seconds**, because a sleeping Azure server takes 15–30 s to wake.
4. If the primary backend fails, retries on the secondary (Render). If both fail, it fires an `mv:db-overload` event that shows a friendly toast.

## Token storage (`utils/storage.js`)

"Remember me" on → tokens go to `localStorage` (survive browser restart). Off → `sessionStorage` (cleared when the tab closes). Always use this wrapper for auth, never `localStorage` directly.

## Making pages feel fast

- **Page bundles**: Home, detail, person and dashboard pages load from one `/api/v1/pages/...` call.
- **Home snapshot**: the last home page is kept in `localStorage` for 24 h and shown instantly while the server wakes.
- **Lazy sections**: `LazyMount` delays below-the-fold sections (and their requests) until they scroll into view.
- **Search**: input is debounced 250–300 ms and recent answers are kept in a small in-memory cache.
- **Safe failures**: a failed API call falls back to an empty list instead of crashing the page.
- **Code splitting**: `vite.config.js` splits React, Motion and OGL into separate cached chunks.

## Visual layer

- `motion` for page transitions and scroll reveals.
- `ogl` (WebGL) for the Aurora background.
- `recharts` for the analysis charts.

## Before building

Run `npm run assets:webp` once on a fresh checkout — some pages import `.webp` copies of images that this script generates.
