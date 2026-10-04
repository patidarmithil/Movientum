# Website Overview

A tour of every page a user can open. Routes are defined in `frontend/src/App.jsx`. Pages marked **Login** redirect to `/login` for guests (`ProtectedRoute`).

## Pages

| Route | Page | Login | What the user does there |
|---|---|---|---|
| `/` | — | | Sends logged-in users to `/home`, guests to `/intro` |
| `/intro`, `/about` | `Intro.jsx` | | Landing page with WebGL Aurora, section rail, poster marquee. No API calls |
| `/home` | `Home.jsx` | | Trending, For You, trailers row, news strip, watchlist strip. Loads from one page bundle |
| `/movies/:id`, `/tv/:id` | `MovieDetail.jsx`, `TVDetail.jsx` | | Details, rating meter, cast, trailers, streaming providers, More Like This, AI picks, news rail |
| `/person/:id` | `PersonPage.jsx` | | Biography and filmography |
| `/search` | `Search.jsx` | | Full search results (the overlay handles live typing) |
| `/explore`, `/explore/:facet`, `/explore/franchise/:slug` | Explore pages | | Filtered browsing, facet hubs, franchise pages |
| `/company/:id`, `/country/:id`, `/movies`, `/most-interested` | Browse pages | | Titles by studio, country, list, or upcoming interest |
| `/recommendations` | `Recommendations.jsx` | Login | The For You feed |
| `/rec-content` | `RecommendationsContent.jsx` | | Content DNA basket tool |
| `/tierlist`, `/tierlist/new`, `/tierlist/t/:slug`, `/tierlist/s/:shareId` | Tier list pages | | Templates, make a board, view a shared board |
| `/tierlist/my/:id` | `TierBoard.jsx` | Login | Edit a saved board |
| `/news` | `News.jsx` | | News feed with tabs and categories |
| `/dashboard` | `Dashboard.jsx` | Login | History, ratings, watchlist collections |
| `/watchlists/:collectionId` | `WatchlistDetail.jsx` | Login | One collection, with filters, banner, OTT filter |
| `/analysis` | `Analysis.jsx` | Login | Your taste profile and how the engine sees you |
| `/settings/*` | Settings pages | Login | Profile, password, CSV import, feedback, my issues, privacy, delete account |
| `/admin` | `AdminDashboard.jsx` | Login (admin) | Stats, manual jobs, infra, ML, messages, users |
| `/login`, `/register` | | | Email/password or Google sign-in |
| `/feedback`, `/help`, `/privacy`, `/terms` | | | Static and support pages |
| `*` | `ErrorPage.jsx` | | 404 |

## Always-present pieces

- **`Navbar.jsx`** — links, search button, notifications bell, profile menu.
- **`SearchOverlay.jsx`** — full-screen live search.
- **`PageTransition.jsx`** — fade between pages.
- **`ErrorBoundary.jsx`** — shows a fallback instead of a blank page on a crash.
- **`ColdStartLoader.jsx`** — poster wall and fun facts while the server wakes up.
- **`DbOverloadBanner.jsx`** — small toast when both backends are down.
- **`InstallPrompt.jsx`** — "add to home screen" for the PWA.

## Cards and feedback

`MovieCard.jsx` is used everywhere. When `showFeedback` is on, it shows `FeedbackControl.jsx` (thumbs up/down). A thumbs-down removes the card and slides in a replacement (`useFeedbackBuffer`). On phones the thumbs are always visible.

## Look and feel

Dark cinematic theme, glass panels, Outfit font. Design tokens are in `index.css`; each page has its own CSS. Animation uses `motion`; the Aurora background uses `ogl` (WebGL); charts use `recharts`.
