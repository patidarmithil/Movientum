# Backend System — Movientum

## Overview

Movientum backend built with **FastAPI** (Python). Chosen for:
- Async support (handles concurrent requests efficiently)
- Auto-generated OpenAPI docs
- Type safety via Pydantic models
- Fast development + easy to extend

Backend is a **modular monolith** at start. Each feature (auth, movies, ratings, recommendations) is a self-contained module. Can split into microservices later without rewriting business logic.

---

## API Gateway Concept

No separate API Gateway service at MVP stage. FastAPI itself acts as gateway:
- Single entry point for all requests
- Middleware handles auth, logging, CORS
- Router modules group related endpoints

Future: Add Nginx or Kong as true API gateway for rate limiting, SSL termination, request routing to microservices.

---

## Directory Structure (Modular Layout)

```
/app
  main.py               → App entry, middleware registration, router mounting
  config.py             → Environment variables, settings (DB URL, JWT secret, etc.)
  
  /routers              → HTTP route definitions (thin layer)
    auth.py
    movies.py
    ratings.py
    watch.py
    search.py
    recommendations.py
    news.py

  /services             → Business logic (thick layer)
    auth_service.py
    movie_service.py
    rating_service.py
    watch_service.py
    search_service.py
    recommendation_service.py
    news_service.py

  /repositories         → Data access layer (DB queries)
    user_repo.py
    movie_repo.py
    rating_repo.py
    watch_repo.py

  /models               → Pydantic request/response schemas
    user_models.py
    movie_models.py
    rating_models.py

  /db                   → Database connection, session management
    database.py
    orm_models.py       → SQLAlchemy ORM table definitions

  /middleware
    auth_middleware.py  → JWT validation
    logging_middleware.py
    error_handler.py

  /utils
    jwt_utils.py
    password_utils.py
    cache_utils.py
```

---

## Three-Layer Architecture

### Layer 1: Routers (HTTP Layer)
- Defines URL paths and HTTP methods
- Validates incoming request via Pydantic models
- Calls appropriate service function
- Returns HTTP response

Router does NOT contain business logic. It only:
1. Receives request
2. Validates shape
3. Delegates to service
4. Returns result

### Layer 2: Services (Business Logic Layer)
- Core of the application
- Orchestrates data flow between repos
- Applies business rules (e.g., "user can't rate a movie they haven't watched — or can they?")
- Calls external APIs (TMDB, news APIs)
- Handles caching decisions
- Calls ML recommendation engine

Services are pure logic. No HTTP knowledge. No DB queries directly.

### Layer 3: Repositories (Data Access Layer)
- Only place raw DB queries happen
- Uses SQLAlchemy ORM or raw SQL
- Returns domain objects (not DB rows)
- Easy to swap DB without touching business logic

---

## Request Lifecycle

Full lifecycle of a request (example: `GET /api/movies/123`):

```
1. HTTP Request arrives at FastAPI
2. Middleware chain:
   a. CORS middleware — check origin
   b. Auth middleware — validate JWT if route is protected
   c. Logging middleware — log request details
3. Router matches path → calls movie_router.get_movie(id=123)
4. Router validates path param (must be int)
5. Router calls movie_service.get_movie_by_id(123)
6. Service checks cache (Redis):
   - Cache HIT → return cached data immediately
   - Cache MISS → proceed to DB
7. Service calls movie_repo.find_by_id(123)
8. Repository queries PostgreSQL
9. Repository returns Movie domain object
10. Service enriches data (e.g., adds user-specific watch status)
11. Service stores result in cache (TTL: 1 hour)
12. Service returns enriched movie data
13. Router serializes to JSON via Pydantic response model
14. HTTP 200 response sent to client
```

---

## API Endpoint Groups

### Auth Endpoints
```
POST /api/auth/register     → Create new user
POST /api/auth/login        → Return JWT token
POST /api/auth/logout       → Invalidate token (blacklist)
POST /api/auth/refresh      → Refresh expired JWT
GET  /api/auth/me           → Get current user profile
```

### Movie Endpoints
```
GET  /api/movies            → List movies (paginated, filtered)
GET  /api/movies/{id}       → Single movie details
GET  /api/movies/trending   → Trending movies
GET  /api/movies/genre/{genre} → Movies by genre
```

### Search Endpoints
```
GET  /api/search?q={query}              → Full search
GET  /api/search/autocomplete?q={query} → Autocomplete suggestions
```

### Rating Endpoints
```
POST /api/ratings           → Submit rating for a movie
GET  /api/ratings/me        → Get all my ratings
GET  /api/ratings/movie/{id}→ Get ratings for a movie
PUT  /api/ratings/{id}      → Update existing rating
DELETE /api/ratings/{id}    → Delete a rating
```

### Watch History Endpoints
```
POST /api/watch             → Mark movie as watched
GET  /api/watch/history     → Get my watch history
POST /api/watch/watchlist   → Add movie to watchlist
DELETE /api/watch/watchlist/{id} → Remove from watchlist
GET  /api/watch/watchlist   → Get my watchlist
```

### Recommendation Endpoints
```
GET  /api/recommendations           → Get personalized recommendations
GET  /api/recommendations/similar/{movie_id} → Movies similar to given movie
```

### News Endpoints
```
GET  /api/news              → Get movie news (personalized if logged in)
GET  /api/news/movie/{id}   → News related to specific movie
```

---

## Separation of Concerns

| Layer | Knows About | Does NOT Know About |
|-------|-------------|---------------------|
| Router | HTTP, URLs, request shape | DB, business rules |
| Service | Business rules, external APIs, cache | HTTP, SQL |
| Repository | SQL, DB structure | HTTP, business rules |
| Middleware | Request/response lifecycle | Business data |

---

## Error Handling Strategy

Centralized error handling via middleware + custom exception classes.

### Custom Exception Hierarchy
```
MovientumException (base)
  ├── AuthException
  │     ├── InvalidCredentialsException
  │     ├── TokenExpiredException
  │     └── UnauthorizedException
  ├── MovieNotFoundException
  ├── RatingException
  │     └── DuplicateRatingException
  └── ExternalAPIException
        ├── TMDBUnavailableException
        └── NewsAPIException
```

### Error Response Format (consistent across all endpoints)
```json
{
  "error": "MOVIE_NOT_FOUND",
  "message": "No movie found with id 999",
  "status_code": 404,
  "timestamp": "2024-01-01T12:00:00Z"
}
```

### HTTP Status Code Rules
- `200` — Success
- `201` — Created (new user, new rating)
- `400` — Bad request (validation failure, malformed input)
- `401` — Unauthorized (no token / expired token)
- `403` — Forbidden (token valid but no permission)
- `404` — Resource not found
- `409` — Conflict (duplicate email on register)
- `422` — Unprocessable entity (Pydantic validation failure)
- `429` — Rate limit exceeded
- `500` — Internal server error (unhandled exceptions)
- `503` — External API unavailable

---

## Middleware Stack

Middleware executes in order for every request:

```
Request In:
  1. CORS Middleware       → Allow configured origins
  2. Rate Limiter          → Block >100 req/min per IP
  3. Request Logger        → Log method, path, IP, timestamp
  4. Auth Middleware       → Validate JWT, attach user to request state
  5. ↓ Router handles request ↓
  6. Response Logger       → Log status code, response time
  7. Error Handler         → Catch unhandled exceptions → return clean JSON error
Response Out
```

---

## Background Tasks

Some operations run async in background (FastAPI BackgroundTasks or Celery):

- **After user rates a movie**: Trigger model update data collection for FedPCL
- **After user marks watched**: Update recommendation engine input data
- **Periodic news fetch**: Cron every 2 hours to pull new movie news
- **Cache invalidation**: Clear stale movie data when DB updates

Background tasks don't block HTTP response. User gets immediate 200 OK while backend processes.

---

## Configuration Management

All secrets and environment-specific values in `.env` file:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET_KEY` — Secret for JWT signing
- `JWT_ALGORITHM` — HS256
- `JWT_EXPIRY_MINUTES` — Token lifetime
- `TMDB_API_KEY` — The Movie DB API key
- `NEWS_API_KEY` — News API key
- `REDIS_URL` — Cache connection
- `ENVIRONMENT` — development / staging / production

Never hardcode secrets. Never commit `.env` to git.

---

## API Versioning Strategy

All routes prefixed with `/api/v1/`. When breaking changes needed → add `/api/v2/` routes. Old routes stay alive until clients migrated.

Current: `/api/v1/movies`, `/api/v1/auth`, etc.

---

## Documentation

FastAPI auto-generates:
- **Swagger UI** at `/docs` — interactive API explorer
- **ReDoc** at `/redoc` — clean reference docs

Both available in development. Disabled or secured in production.
