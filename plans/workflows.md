# Workflows — Movientum

## Overview

Step-by-step flows for every major user journey. Traces path from user action through frontend → API → backend service → DB → response → UI update.

---

## Workflow 1: Signup Flow

```
User opens /register page
  │
  ├── User fills: name, email, password, confirm password
  │
  ├── Frontend validates (instant):
  │     ├── All fields filled?
  │     ├── Email format valid?
  │     ├── Password ≥ 8 chars?
  │     └── Passwords match?
  │
  ├── User clicks "Register"
  │
  ├── Frontend: POST /api/auth/register {name, email, password}
  │     ↓ Loading spinner shown
  │
  ├── Backend validates (authoritative):
  │     ├── Email format
  │     ├── Password strength
  │     └── Email not already registered
  │
  ├── If email exists → 409 response
  │     → Frontend shows: "Email already in use. Login instead?"
  │
  ├── If valid:
  │     → Hash password (bcrypt)
  │     → Create user in DB
  │     → Generate JWT token
  │     → Return {token, user}
  │
  ├── Frontend stores token in localStorage
  ├── Auth context updated: isLoggedIn = true, user = {...}
  │
  ├── Redirect to /onboarding (genre preference selection)
  │     → User picks 3+ favorite genres
  │     → POST /api/users/preferences {genres: [...]}
  │
  └── Redirect to Home page with personalized seed recommendations
```

---

## Workflow 2: Login Flow

```
User opens /login
  │
  ├── Fills email + password
  ├── Clicks "Login"
  │
  ├── Frontend: POST /api/auth/login {email, password}
  │
  ├── Backend:
  │     ├── Find user by email
  │     ├── Verify password hash
  │     ├── Check account active
  │     └── Generate JWT + refresh token
  │
  ├── If invalid → 401 "Invalid credentials"
  │     → Frontend shows error (no hint whether email or password wrong)
  │
  ├── If valid → {token, refresh_token, user}
  │
  ├── Frontend:
  │     → Store tokens
  │     → Update auth context
  │     → Check if redirect param exists: ?redirect=/dashboard
  │         → YES: go to dashboard
  │         → NO: go to Home
```

---

## Workflow 3: Browse → Watch → Rate

```
User on Home page
  │
  ├── Scrolls through movie rows
  │     → Rows loaded: GET /api/movies/trending
  │                     GET /api/recommendations (if logged in)
  │                     GET /api/movies/genre/action
  │
  ├── Clicks MovieCard "Inception"
  │     → Navigate to /movies/123
  │
  ├── Movie Detail Page loads:
  │     → GET /api/movies/123 (movie details)
  │     → GET /api/recommendations/similar/123 (similar movies)
  │     → GET /api/news/movie/123 (related news)
  │     → GET /api/watch/status/123 (have I watched this?) — if logged in
  │     → All requests fire in parallel
  │
  ├── User reads details, decides to watch
  │     → Clicks "Mark as Watched"
  │     → POST /api/watch {movie_id: 123}
  │     → Button updates to green checkmark ✓
  │     → Backend: creates watch_history record
  │     → Background task: trigger recommendation refresh
  │
  ├── User rates the movie
  │     → Clicks "Rate This Movie"
  │     → Rating modal opens
  │     → Sliders for: Story, Acting, Direction, Visuals, Overall
  │     → Clicks "Submit Rating"
  │     → POST /api/ratings {movie_id: 123, story: 8, acting: 9, ...overall: 8.5}
  │     → Modal closes
  │     → "Your Rating: 8.5" shows on page
  │     → Background: recommendation data updated
  │     → Background: FedPCL local training data updated
```

---

## Workflow 4: Search → Movie Click → Actions

```
User types "dark knight" in search bar (global Navbar)
  │
  ├── After 300ms debounce:
  │     → GET /api/search/autocomplete?q=dark+knight
  │     → Dropdown shows: "The Dark Knight (2008)", "The Dark Knight Rises (2012)"
  │
  ├── User sees dropdown, clicks "The Dark Knight (2008)"
  │     → Navigate directly to /movies/155
  │     (Skips search results page, goes straight to detail)
  │
  ├── OR user presses Enter
  │     → Navigate to /search?q=dark+knight
  │     → GET /api/search?q=dark+knight
  │     → Results page shows matching movies as grid
  │
  ├── On Search Results:
  │     → User sees results (local DB first, TMDB fallback if sparse)
  │     → User can apply filters: genre, year, rating
  │     → Each filter change: new API call with filter params
  │
  ├── User clicks a MovieCard
  │     → Navigate to /movies/{id}
  │     → (Same flow as Workflow 3 from Movie Detail Page)
```

---

## Workflow 5: Recommendation Flow

```
User logs in and visits Home
  │
  ├── Home requests: GET /api/recommendations
  │
  ├── Backend recommendation flow:
  │     ├── Check Redis: user:recommendations:{user_id}
  │     │     ├── HIT → return cached (< 1ms)
  │     │     └── MISS → compute
  │     │
  │     ├── Load user data:
  │     │     → Watch history (last 50 movies)
  │     │     → Ratings
  │     │     → Genre preferences
  │     │
  │     ├── Phase 1 (Rule-based):
  │     │     → Compute genre affinity scores
  │     │     → Find director affinities
  │     │     → Find similar-to-rated movies
  │     │     → Blend with trending
  │     │
  │     ├── Phase 2+ (ML model):
  │     │     → Load recommendation model (in-memory)
  │     │     → Run inference for this user
  │     │     → Get top 50 scored movies
  │     │
  │     ├── Post-process:
  │     │     → Remove already-watched
  │     │     → Apply diversity rules
  │     │     → Limit to top 20
  │     │     → Cache in Redis (TTL: 15 min)
  │     │
  │     └── Return: list of 20 movie objects with recommendation reason
  │
  ├── Frontend renders "For You" row
  │     → Each MovieCard shows reason: "Based on your love of Sci-Fi"
  │
  └── FedPCL update cycle (background, separate):
        → Every 14 days: new training round starts
        → Client eligible? Download model → train locally → submit update
        → Next round: better recommendations
```

---

## Workflow 6: Watchlist Management

```
User on Movie Detail Page /movies/456
  │
  ├── Clicks "Add to Watchlist"
  │     → POST /api/watch/watchlist {movie_id: 456}
  │     → Button changes: "Added to Watchlist ✓"
  │     → DB: insert into watchlist table
  │
  ├── User visits Dashboard → Watchlist tab
  │     → GET /api/watch/watchlist
  │     → Shows grid of saved movies
  │
  ├── User clicks movie in watchlist
  │     → Navigate to Movie Detail Page
  │
  ├── User removes from watchlist
  │     → Click "Remove from Watchlist" button
  │     → DELETE /api/watch/watchlist/456
  │     → Item disappears from list
```

---

## Workflow 7: Data Flow Diagram (Frontend → Backend → DB)

```
Frontend (React)
  │
  │  HTTPS JSON request (with JWT token in header)
  ▼
FastAPI Backend
  │
  ├── Middleware: validate JWT → attach user to request
  ├── Router: match URL → validate request body shape
  ├── Service: business logic
  │     ├── Cache check (Redis)
  │     ├── Repository call (DB query)
  │     ├── External API call (TMDB / NewsAPI) if needed
  │     └── Result processing
  ▼
PostgreSQL DB ←→ Redis Cache
  │
  │  DB returns data → Service processes → Router serializes
  ▼
JSON Response (200/201/4xx/5xx)
  │
  ▼
Frontend receives response
  │
  ├── Success: update state → re-render UI
  └── Error: show toast notification / inline error
```

---

## Workflow 8: Token Refresh (Transparent to User)

```
User is actively using app
  │
  ├── Access token expires (1 hour since login)
  │
  ├── User clicks something → API call made
  │
  ├── Backend returns 401 "Token expired"
  │
  ├── Frontend API interceptor catches 401:
  │     → POST /api/auth/refresh {refresh_token}
  │
  ├── Backend:
  │     → Validates refresh token
  │     → Issues new access token
  │     → Returns {access_token}
  │
  ├── Frontend:
  │     → Stores new access token
  │     → Retries original failed request with new token
  │
  └── User sees no interruption — seamless experience
```

---

## Workflow 9: Admin Adds New Movie (Manual Override)

```
Admin logs in with admin account
  │
  ├── Navigates to /admin/movies/add (admin-only route)
  │
  ├── Enters TMDB movie ID
  │
  ├── Frontend: GET /api/admin/movies/fetch-tmdb/{id}
  │     → Backend fetches full movie details from TMDB
  │     → Returns preview: title, poster, overview
  │
  ├── Admin reviews, clicks "Add to Catalog"
  │
  ├── POST /api/admin/movies {movie_id, ...details}
  │     → Backend stores movie in DB
  │     → Clears relevant cache keys
  │     → Movie appears in platform immediately
```
