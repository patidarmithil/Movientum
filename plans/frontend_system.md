# Frontend System — Movientum

## Overview

Movientum frontend built with React. Component-based. Every UI piece is reusable, composable, and decoupled from data logic. State flows from global store or context down to components. API calls isolated in service layer — never inside components directly.

---

## Architecture Philosophy

React = UI layer only. Business logic stays in backend. Frontend job:
1. Render data
2. Capture user input
3. Call APIs
4. Update UI based on response

No business rules in frontend. No raw DB queries. Clean separation.

---

## Page Structure

### 1. Home Page (`/`)
- Entry point for all users (logged in or not)
- Sections:
  - **Hero Banner** — featured movie or trending content
  - **Trending Movies** — horizontal scroll carousel
  - **Recommended For You** — personalized row (shows only when logged in)
  - **Recently Watched** — user's continue-watching strip
  - **Genre Rows** — e.g., Action, Drama, Sci-Fi rows
- Non-logged users see generic popular content
- Logged users see personalized content fetched via authenticated API calls

### 2. Login / Register Page (`/login`, `/register`)
- Two separate routes but share similar layout
- Login form: email + password + submit
- Register form: name + email + password + confirm password
- On success: JWT token stored, redirect to Home
- On failure: inline error messages per field
- "Forgot Password" link on Login page
- OAuth buttons (Google) as future integration point

### 3. Movie List Page (`/movies`)
- Grid layout of MovieCard components
- Filter sidebar:
  - Genre filter (multi-select)
  - Year range slider
  - Rating filter
  - Sort by: Popularity, Release Date, Rating
- Pagination or infinite scroll
- Each filter change triggers new API call with query params

### 4. Movie Detail Page (`/movies/:id`)
- Full movie info:
  - Poster, title, year, runtime, genre tags
  - Director, cast list
  - Plot synopsis
  - Average community rating
  - Related news articles
- Action buttons:
  - **Add to Watchlist**
  - **Mark as Watched**
  - **Rate This Movie** (opens rating modal)
- Recommendation strip: "Movies like this"
- User reviews section (future)

### 5. Search Results Page (`/search?q=...`)
- Triggered from global search bar
- Shows results as grid of MovieCards
- Fallback message if no results
- Autocomplete dropdown integrated in search bar

### 6. User Dashboard (`/dashboard`)
- Accessible only to logged-in users
- Tabs:
  - **Watch History** — timeline of watched movies
  - **Watchlist** — saved movies to watch later
  - **My Ratings** — movies user has rated with scores
  - **Preferences** — genre preferences, notification settings
- Account settings link: change email, password

---

## Component Architecture

### Atomic Design Approach

```
atoms       → Button, Input, Badge, Spinner, Avatar
molecules   → SearchBar, MovieCard, StarRating, GenreTag
organisms   → Navbar, MovieGrid, FilterSidebar, HeroSection
templates   → PageLayout, AuthLayout
pages       → Home, MovieList, MovieDetail, Dashboard, Login
```

### Key Reusable Components

**MovieCard**
- Props: `movie` object (id, title, poster, year, rating, genre)
- Displays: poster image, title, year, rating badge
- Click → navigates to Movie Detail Page
- Used everywhere: Home rows, Movie List, Search Results, Dashboard

**SearchBar**
- Lives in Navbar (global, always visible)
- Has autocomplete dropdown
- On Enter or click → navigates to Search Results Page
- Debounced input: waits 300ms after last keystroke before calling API

**RatingModal**
- Opens as overlay on Movie Detail Page
- Category-based rating inputs (Story, Acting, Direction, Visuals, Overall)
- Submit calls ratings API
- Closes and updates UI optimistically

**Navbar**
- Fixed top bar
- Left: Movientum logo
- Center: SearchBar
- Right: Login button (guest) or Avatar + dropdown (logged in)
- Dropdown: Dashboard, Watchlist, Logout

---

## State Management Strategy

Use **React Context API** for global state at start. Migrate to **Redux Toolkit** when state complexity grows (e.g., when adding FedPCL recommendation updates, real-time notifications).

### Context Slices

**AuthContext**
- Holds: `user` object, `token`, `isLoggedIn`
- Methods: `login()`, `logout()`, `register()`
- Persists token in `localStorage`

**MovieContext** (optional, can be fetched per-page)
- Holds: `currentMovie`, `watchHistory`, `watchlist`
- Methods: `addToWatchlist()`, `markWatched()`, `removeFromWatchlist()`

**SearchContext**
- Holds: `query`, `results`, `isLoading`
- Manages autocomplete state

### Why Context First, Redux Later

Context = simple, no extra library. Enough for MVP.
Redux needed when: multiple components need same data simultaneously, async middleware complexity grows, FedPCL adds frequent background model updates.

---

## Routing Logic

Use **React Router v6**.

```
/                   → Home (public)
/login              → Login Page (redirect to / if already logged in)
/register           → Register Page
/movies             → Movie List Page (public)
/movies/:id         → Movie Detail Page (public)
/search             → Search Results Page (public)
/dashboard          → Dashboard (protected — requires auth)
/dashboard/history  → Watch History tab
/dashboard/watchlist→ Watchlist tab
/dashboard/ratings  → My Ratings tab
```

**Protected Routes**: Wrapper component checks `isLoggedIn` from AuthContext. If false → redirect to `/login` with `?redirect=/dashboard` so user lands back after login.

---

## Frontend–Backend Communication

All API calls go through a centralized **API service layer**.

### API Service Layer Structure

```
/src/services/
  authService.js       → register, login, logout, refreshToken
  movieService.js      → getMovies, getMovieById, searchMovies
  ratingService.js     → submitRating, getUserRatings
  watchService.js      → markWatched, getWatchHistory, addToWatchlist
  recommendService.js  → getRecommendations, getPersonalized
  newsService.js       → getMovieNews, getPersonalizedNews
```

Each service function:
1. Builds request (URL, method, headers, body)
2. Attaches JWT token from localStorage to `Authorization: Bearer <token>` header
3. Calls `fetch` or `axios`
4. Returns parsed JSON or throws error with message

Components call service functions → never call `fetch` directly.

### Error Handling in Frontend

- API errors shown as toast notifications (top-right corner)
- Form validation errors shown inline below each field
- 401 Unauthorized → auto logout + redirect to login
- 404 Not Found → show "Not Found" component
- 500 Server Error → show "Something went wrong, try again" message
- Loading states: skeleton screens (not spinners) for better UX

---

## Data Flow Example: Movie Detail Page

```
User clicks MovieCard
  → Router navigates to /movies/:id
  → MovieDetailPage mounts
  → useEffect triggers movieService.getMovieById(id)
  → API call to GET /api/movies/{id}
  → Backend returns movie JSON
  → State updated: setMovie(data)
  → Component re-renders with movie data
  → Simultaneously: fetchRecommendations(id), fetchRelatedNews(id)
  → All three panels fill in as data arrives
```

---

## UI Reuse Strategy

Every repeated UI element = component. Pass data via props, never hardcode.

Key principles:
- MovieCard used in 5+ places — single source of truth
- Genre tags = Badge component reused across filters, cards, detail page
- Buttons have variants: `primary`, `secondary`, `ghost`, `danger`
- Layout uses CSS Grid and Flexbox — no fixed pixel widths
- Responsive breakpoints: mobile (< 768px), tablet (768–1024px), desktop (> 1024px)

---

## Performance Strategies

- **Lazy loading**: Each page loaded only when navigated to (`React.lazy + Suspense`)
- **Image lazy loading**: Movie posters load only when in viewport
- **Debouncing**: Search input waits 300ms before API call
- **Memoization**: `useMemo` / `useCallback` for expensive computations
- **Skeleton screens**: Show layout placeholders while data fetches
- **Client-side caching**: Store fetched movie data in Context to avoid refetch on revisit within same session
