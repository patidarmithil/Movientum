# Movientum — Frontend

React 19 + Vite single-page app for Movientum: movie and TV discovery, personal ratings, watchlists, tier lists, news and a graph + ML recommendation engine. Plain CSS (no framework), deployed to Vercel. The API it talks to lives in [`../backend`](../backend).

## Quick start

```bash
npm install
cp .env.example .env     # then fill in the values below
npm run dev              # http://localhost:5173
```

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | ESLint (flat config, `eslint.config.js`) |
| `npm run assets:webp` | One-off: write `.webp` siblings for intro/help images (needs `sharp`) |

`scripts/download-intro-assets.mjs` is a manual one-off that pulls Intro-page art from TMDB (reads `TMDB_API_KEY` from `../backend/.env`). It never runs during a build.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `VITE_API_URL` | Recommended | Primary backend base URL. If unset, the app uses `http://localhost:8000` on localhost and the production Azure API everywhere else. |
| `VITE_API_URL_SECONDARY` | Optional | Failover backend. Requests that fail on the primary (network error / 5xx) are retried here. |
| `VITE_GOOGLE_CLIENT_ID` | For Google sign-in | Google Identity Services client ID (ID-token flow, no secret). |
| `VITE_UMAMI_WEBSITE_ID` | Optional | Umami analytics site ID. |
| `VITE_UMAMI_SCRIPT` | Optional | Umami script path — `/st/track.js` goes through the Vercel proxy. |

Only `VITE_*` variables reach the browser; never put secrets here.

## Features

- **Home / browse** — trending, top rated, upcoming, genre rows, trailers and a news strip.
- **Detail pages** — movies (`/movies/:id`) and TV (`/tv/:id`) with cast & crew, trailers, image lightbox, where-to-watch (OTT) links, similar titles, related news and the 4-tier rating meter (Skip / Timepass / Go for it / Perfection).
- **People, companies, countries** — `/person/:id`, `/company/:id`, `/country/:iso`.
- **Search** — instant overlay search (debounced, cached) plus a full `/search` page.
- **Explore** — faceted browsing (`/explore/:facet`) and franchise pages (`/explore/franchise/:slug`).
- **Recommendations** — personalised feed (`/recommendations`) with thumbs/ignore feedback that updates the taste profile immediately, and AI "more like this" picks (`/rec-content`).
- **Analysis** — taste fingerprint, habits, signal timeline, engine X-ray and profile tuning (`/analysis`).
- **Tier lists** — build from blank or templates, share via link, export as image (`/tierlist`).
- **Dashboard & watchlists** — watched history, ratings, custom collections, plan-to-watch and episode tracking with release notifications.
- **News** — aggregated film/TV news (`/news`).
- **Settings** — profile and avatar, password, CSV import of watch history, CSV/JSON export (JSON is designed to hand to an AI chat), feedback with screenshots and "My issues" tracking, account deletion.
- **Admin** — dashboard, analytics and background-task controls (`/admin`, admin users only).
- **Auth** — email/password and Google sign-in, "Remember me" (localStorage vs sessionStorage), automatic token refresh.
- **PWA** — `manifest.json` and an install prompt.

## Project structure

```
src/
  App.jsx            Routes (React Router 7), lazy-loaded pages, page transitions
  main.jsx           Entry point
  components/        Shared UI; explore/ and tierlist/ hold feature-specific pieces
  pages/             One page per route, each with its own .css
    analysis/        Sections of the /analysis page
    settings/        Nested /settings/* routes
  services/          One wrapper per backend area — call the API through these
  context/           AuthContext (user, login/logout, token state)
  hooks/             Instant search, tier drag & drop, news dismiss, session state, …
  utils/             api.js (Axios instance), storage.js, analytics, OTT links, tier export
public/              Static assets, avatars, help images, manifest, robots.txt, sitemap.xml
```

## How the API layer works

`src/utils/api.js` is the single Axios instance. It:

- attaches the bearer token and runs a queued 401 → refresh → retry flow;
- uses a 120 s timeout, because the Azure backend can cold-start in 15–30 s (the UI shows a cold-start loader meanwhile);
- fails over to `VITE_API_URL_SECONDARY` when the primary is unreachable;
- short-circuits requests from search-engine crawlers.

It also exports `BASE_URL`, which is used to resolve API-relative upload paths (avatars, feedback screenshots). Auth tokens are read and written only through `src/utils/storage.js`.

## Conventions

- Pages own their CSS; there is no CSS framework. CSS minification is disabled in `vite.config.js` on purpose (it caused visual regressions).
- Search inputs debounce 250–300 ms with a `useRef` timer and a small in-memory query cache.
- API failures resolve to safe defaults (`.catch(() => setData([]))`) instead of throwing during render.
- The build splits `react-vendor`, `motion-vendor` and `ogl-vendor` chunks so they stay cached across deploys.
- Lint has 0 errors. The React Compiler advisory rules (`set-state-in-effect`, `refs`, `purity`, `immutability`) are set to warn: the app does not use the compiler and those patterns are correct at runtime.

## Deployment (Vercel)

- Framework preset: Vite. Build command `npm run build`, output directory `dist`, root directory `frontend`.
- Set the `VITE_*` variables in the Vercel project settings; they are baked in at build time, so redeploy after changing them.
- `vercel.json` proxies Umami under `/st/*` (avoids ad blockers), serves static files directly, sends every other path to the SPA, and sets long-lived cache headers on hashed `/assets/*`.
- Add the deployed origin to the backend's `ALLOWED_ORIGINS` so CORS allows it.
