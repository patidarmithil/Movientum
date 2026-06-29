# Codebase Architecture Index
> Last updated: 2026-06-29 | Stack: FastAPI + React (Vite) + PostgreSQL (Supabase) + Redis (Upstash) + Celery

---

## Directory Structure

* `/backend` — FastAPI Python server. Entry: `app/main.py`. Dockerized.
* `/backend/app` — Core application package.
* `/backend/app/routers` — FastAPI route handlers (one file per domain).
* `/backend/app/services` — Business logic layer.
* `/backend/app/db` — ORM models, DB session, Redis cache.
* `/backend/app/schemas` — Pydantic request/response schemas.
* `/backend/app/repositories` — DB query abstractions.
* `/backend/app/tasks` — Celery background tasks.
* `/backend/app/utils` — Auth helpers, JWT, password, deps.
* `/backend/app/ml` — ML ranker model (LightGBM-style JSON + training).
* `/backend/alembic` — DB migration scripts.
* `/backend/scripts` — One-off admin/data scripts.
* `/backend/uploads` — User-uploaded files storage.
* `/frontend` — React + Vite SPA. Entry: `src/main.jsx`.
* `/frontend/src/pages` — Full page components (route-level).
* `/frontend/src/components` — Shared UI components.
* `/frontend/src/services` — Axios API call wrappers (one per domain).
* `/frontend/src/context` — React context providers.
* `/frontend/src/hooks` — Custom React hooks.
* `/frontend/src/utils` — Axios instance, cache, storage helpers.
* `/moctale_scrapper` — TMDB + Moctale data scraping scripts.
* `/AI_Context` — Architecture docs for AI agent context.
* `/plans` — Design plans, logs, implementation docs.
* `/testing` — Evaluation scripts and model test results.

---

## File Definitions

### `/backend/app/main.py`
* **Purpose**: FastAPI app factory. Mounts all routers, CORS, lifespan hooks (DB check, Redis check, startup tasks). Runs cleanup, temp_tracker processing on startup.
* **Exports**: `app` (FastAPI instance)
* **Routers mounted**: auth, movies, tv, search, ratings, watch, watchlist, recommendations, news, users, feedback, clicks, notifications, recommendation_signals, requests, internal, person, watching_tracker, temp_tracker

### `/backend/app/config.py`
* **Purpose**: Single source of truth for all env config via pydantic-settings.
* **Exports**: `Settings` (class), `settings` (singleton via `get_settings()`)
* **Key fields**: `tmdb_api_key`, `async_database_url`, `redis_url`, `jwt_secret_key`, `app_env`, `cors_origins`

### `/backend/app/telemetry.py`
* **Purpose**: OpenTelemetry metrics integration (Azure Monitor). Tracks ML pipeline, graph analytics, and retrain logic.
* **Exports**: `init_telemetry()`

### `/backend/app/celery_app.py`
* **Purpose**: Celery instance config with Redis broker. Registers task autodiscovery.
* **Exports**: `celery_app`

---

### `/backend/app/db/database.py`
* **Purpose**: SQLAlchemy async engine + session factory. DB health check.
* **Exports**: `AsyncSessionLocal`, `engine`, `check_db_connection()`

### `/backend/app/db/cache.py`
* **Purpose**: Redis client wrapper. Get/set/delete with TTL. Health check.
* **Exports**: `get_redis()`, `check_redis_connection()`, `cache_get()`, `cache_set()`, `cache_delete()`

### `/backend/app/db/orm_models.py`
* **Purpose**: All SQLAlchemy ORM table definitions. Alembic reads these for migrations.
* **Exports (models)**: `Genre`, `Movie`, `MovieGenre`, `MovieDirector`, `Director`, `User`, `Rating`, `WatchHistory`, `Watchlist`, `UserGenrePreference`, `Notification`, `Feedback`, `Click`, `NewsArticle`, `RecommendationFeedback`, `TempTracker`, `WatchingTracker`, `TVEpisode`

### `/backend/app/db/orm_models_news.py`
* **Purpose**: News-specific ORM model (stub/separate).

---

### `/backend/app/routers/auth.py`
* **Purpose**: Register, login, refresh token, logout, `/me` endpoints.

### `/backend/app/routers/movies.py`
* **Purpose**: Movie list, trending, detail, similar, cast, import from TMDB. Largest router (~48KB).

### `/backend/app/routers/tv.py`
* **Purpose**: TV show list, detail, episodes, seasons.

### `/backend/app/routers/search.py`
* **Purpose**: Full-text + filter search across movies/TV. (~20KB)

### `/backend/app/routers/ratings.py`
* **Purpose**: CRUD for user ratings (1-10 scale).

### `/backend/app/routers/watch.py`
* **Purpose**: Watch history: add, remove, get, mark-complete.

### `/backend/app/routers/watchlist.py`
* **Purpose**: Watchlist collections: create, add/remove items, share, reorder.

### `/backend/app/routers/recommendations.py`
* **Purpose**: Get personalized recs, content-based recs. (~16KB)

### `/backend/app/routers/news.py`
* **Purpose**: Fetch/list movie news articles.

### `/backend/app/routers/users.py`
* **Purpose**: User profile get/update, genre preferences.

### `/backend/app/routers/feedback.py`
* **Purpose**: Submit user feedback and bug reports.

### `/backend/app/routers/clicks.py`
* **Purpose**: Track user click signals for rec learning.

### `/backend/app/routers/notifications.py`
* **Purpose**: User notification list + mark-read.

### `/backend/app/routers/recommendation_signals.py`
* **Purpose**: Explicit rec feedback signals (thumbs up/down, not interested).

### `/backend/app/routers/requests.py`
* **Purpose**: Users request content to be added to platform.

### `/backend/app/routers/internal.py`
* **Purpose**: Internal/admin endpoints (cron triggers, cleanup).

### `/backend/app/routers/person.py`
* **Purpose**: Person (actor/director) detail + filmography.

### `/backend/app/routers/watching_tracker.py`
* **Purpose**: Track currently-watching progress (episode, runtime).

### `/backend/app/routers/temp_tracker.py`
* **Purpose**: Temp interest tracker to auto-promotes to Plan to Watch.

---

### `/backend/app/services/tmdb_service.py`
* **Purpose**: All TMDB API calls: fetch movie, TV, person, images. (~22KB)
* **Exports**: `fetch_movie()`, `fetch_tv()`, `fetch_person()`, `fetch_trending()`, `search_tmdb()`

### `/backend/app/services/recommendation_service.py`
* **Purpose**: Core CF + hybrid recommendation engine. (~14KB)
* **Exports**: `get_recommendations()`, `get_similar_items()`

### `/backend/app/services/advanced_recs.py`
* **Purpose**: Advanced rec algorithms (FedPCL-inspired, graph-based). Largest service (~29KB)
* **Exports**: `get_advanced_recommendations()`

### `/backend/app/services/content_recs_service.py`
* **Purpose**: Content-based filtering using metadata embeddings.
* **Exports**: `get_content_recs()`

### `/backend/app/services/search_service.py`
* **Purpose**: Full-text search logic, filter parsing, ranking.
* **Exports**: `search_movies()`, `search_tv()`, `search_all()`

### `/backend/app/services/rating_service.py`
* **Purpose**: Rating upsert, aggregation, user rating history.
* **Exports**: `upsert_rating()`, `get_user_ratings()`

### `/backend/app/services/watch_service.py`
* **Purpose**: Watch history logic, recently-watched, stats.
* **Exports**: `add_to_watch_history()`, `get_watch_history()`

### `/backend/app/services/auth_service.py`
* **Purpose**: User registration, login, token validation logic.
* **Exports**: `register_user()`, `authenticate_user()`

### `/backend/app/services/feedback_service.py`
* **Purpose**: Feedback persistence + signal aggregation. (~17KB)

### `/backend/app/services/click_service.py`
* **Purpose**: Click event persistence + signal weighting.

### `/backend/app/services/news_service.py`
* **Purpose**: NewsAPI fetch + article dedup + storage.
* **Exports**: `fetch_and_store_news()`, `get_latest_news()`

### `/backend/app/services/analysis_service.py`
* **Purpose**: User stats, genre breakdown, watch trends. (~15KB)

### `/backend/app/services/graph_cache.py`
* **Purpose**: In-memory graph cache for collaborative filtering user-item matrix.

---

### `/backend/app/schemas/movie.py`
* **Purpose**: Pydantic schemas for movie request/response.
* **Exports**: `MovieBase`, `MovieResponse`, `MovieDetail`, `MovieListResponse`

### `/backend/app/schemas/user.py`
* **Purpose**: User schemas: register, login, profile update.
* **Exports**: `UserCreate`, `UserResponse`, `UserUpdate`

### `/backend/app/schemas/rating.py`
* **Purpose**: Rating create/response schemas.

### `/backend/app/schemas/watchlist.py`
* **Purpose**: Watchlist + collection schemas.

### `/backend/app/schemas/watch.py`
* **Purpose**: Watch history schemas.

### `/backend/app/schemas/search.py`
* **Purpose**: Search query + result schemas.

### `/backend/app/schemas/news.py`
* **Purpose**: News article response schema.

### `/backend/app/schemas/feedback.py`
* **Purpose**: Feedback submission schema.

### `/backend/app/schemas/recommendation_feedback.py`
* **Purpose**: Rec signal schema (thumbs, not-interested).

### `/backend/app/schemas/recommendations.py`
* **Purpose**: Recommendation response schema.

---

### `/backend/app/repositories/watchlist_repo.py`
* **Purpose**: All watchlist DB queries: create collection, add/remove items, get by user. (~11KB)

### `/backend/app/repositories/search_repo.py`
* **Purpose**: Raw DB search queries (FTS, filter).

---

### `/backend/app/tasks/sync_movies.py`
* **Purpose**: Celery task: sync trending/popular movies from TMDB on schedule.

### `/backend/app/tasks/fetch_news.py`
* **Purpose**: Celery task: fetch news from NewsAPI periodically.

### `/backend/app/tasks/retrain_ranker.py`
* **Purpose**: Celery task: retrain ML ranker from user interaction data.

### `/backend/app/tasks/check_episodes.py`
* **Purpose**: Celery task: check for new TV episodes on TMDB.

---

### `/backend/app/utils/jwt_utils.py`
* **Purpose**: JWT create/decode/verify helpers.
* **Exports**: `create_access_token()`, `create_refresh_token()`, `verify_token()`

### `/backend/app/utils/password_utils.py`
* **Purpose**: bcrypt hash + verify.
* **Exports**: `hash_password()`, `verify_password()`

### `/backend/app/utils/deps.py`
* **Purpose**: FastAPI dependency injection: `get_db()`, `get_current_user()`, `get_redis_dep()`.

### `/backend/app/utils/persistence.py`
* **Purpose**: File persistence helpers for uploads.

---

### `/backend/app/ml/ranker.py`
* **Purpose**: LightGBM-style ranker: load model from ranker.json, score item candidates.
* **Exports**: `Ranker`, `rank_candidates()`

### `/backend/app/ml/training.py`
* **Purpose**: Ranker training pipeline from interaction logs. (~8KB)
* **Exports**: `train_ranker()`

### `/backend/app/ml/ranker.json`
* **Purpose**: Serialized trained ranker model weights (~339KB).

---

### `/backend/alembic/env.py`
* **Purpose**: Alembic migration env. Imports Base from orm_models, runs sync migrations.

---

### `/frontend/src/main.jsx`
* **Purpose**: React app entry. Mounts App to DOM.

### `/frontend/src/App.jsx`
* **Purpose**: Root router (React Router v6). Wraps app in AuthProvider. Defines all routes.
* **Routes**: `/`, `/movies`, `/movie/:id`, `/tv/:id`, `/login`, `/register`, `/dashboard`, `/search`, `/explore`, `/person/:id`, `/analysis`, `/news`, `/recommendations`, `/recommendations/content`, `/company/:id`, `/country/:code`, `/help`, `/privacy`, `/terms`, `/intro`, `/feedback`, `/admin`, `/watchlist/:id`, `/settings/*`

### `/frontend/src/index.css`
* **Purpose**: Global CSS variables, typography, resets, animations. (~14KB)

---

### `/frontend/src/context/AuthContext.jsx`
* **Purpose**: Auth state (user, token). Provides useAuth() hook. Handles login/logout/refresh.
* **Exports**: `AuthProvider`, `useAuth`

### `/frontend/src/hooks/useScrollRestore.js`
* **Purpose**: Restore scroll position on route back-navigation.

### `/frontend/src/hooks/useSessionState.js`
* **Purpose**: sessionStorage-backed state hook.

---

### `/frontend/src/utils/api.js`
* **Purpose**: Axios instance with base URL, auth interceptors, 401 fires mv:logout event.
* **Exports**: `api` (default)

### `/frontend/src/utils/pageCache.js`
* **Purpose**: In-memory page-level cache for API responses.
* **Exports**: `getCache()`, `setCache()`, `clearCache()`

### `/frontend/src/utils/storage.js`
* **Purpose**: LocalStorage helpers with JSON parse/stringify.
* **Exports**: `getItem()`, `setItem()`, `removeItem()`

### `/frontend/src/utils/analytics.js`
* **Purpose**: Umami analytics helpers. Queue pageviews/events in sessionStorage when Umami not yet loaded; flushes on load. Adblock-safe.
* **Exports**: `trackPageView()`, `trackEvent()`, `track()` (alias), `getQueue()`, `setQueue()`

---

### `/frontend/src/services/` (all wrap api.js)
| File | Domain |
|------|--------|
| `authService.js` | Login, register, refresh token |
| `movieService.js` | Movie list, detail, trending |
| `ratingService.js` | Get/set/delete ratings |
| `watchService.js` | Watch history CRUD |
| `watchlistService.js` | Watchlist collections |
| `planToWatchService.js` | Plan-to-watch list |
| `searchService.js` | Search queries |
| `newsService.js` | News articles |
| `feedbackService.js` | Feedback submission |
| `notificationService.js` | Notifications |
| `settingsService.js` | User settings |
| `userService.js` | User profile |
| `watchingTrackerService.js` | In-progress tracker |
| `tempTrackerService.js` | Temp interest tracker |

---

### `/frontend/src/pages/` (route-level components)
| File | Route | Purpose |
|------|-------|---------|
| `Intro.jsx` | `/intro` | Landing/onboarding page (~21KB) |
| `Home.jsx` | `/` | Main feed: trending, recs, news rows |
| `Explore.jsx` | `/explore` | Browse by genre/filter/sort (~30KB) |
| `MovieDetail.jsx` | `/movie/:id` | Full movie detail + cast, ratings, recs. YouTube backdrop: `fs` disabled on mobile (`window.innerWidth < 768 ? 0 : 1`) |
| `TVDetail.jsx` | `/tv/:id` | TV show detail + seasons/episodes (~29KB). YouTube backdrop: `fs` disabled on mobile (`window.innerWidth < 768 ? 0 : 1`) |
| `Search.jsx` | `/search` | Search results page |
| `Recommendations.jsx` | `/recommendations` | User personalized recs |
| `RecommendationsContent.jsx` | `/recommendations/content` | Content-based recs (~29KB) |
| `Analysis.jsx` | `/analysis` | User watch stats/charts (~22KB) |
| `Dashboard.jsx` | `/dashboard` | User dashboard (watchlist, history) |
| `WatchlistDetail.jsx` | `/watchlist/:id` | Watchlist collection detail (~22KB) |
| `PersonPage.jsx` | `/person/:id` | Actor/Director filmography |
| `CompanyPage.jsx` | `/company/:id` | Production company movies |
| `CountryPage.jsx` | `/country/:code` | Movies by origin country |
| `MovieList.jsx` | `/movies` | Paginated movie list |
| `News.jsx` | `/news` | News articles feed |
| `Login.jsx` | `/login` | Login form |
| `Register.jsx` | `/register` | Registration form |
| `Feedback.jsx` | `/feedback` | User feedback form |
| `AdminDashboard.jsx` | `/admin` | Admin panel (protected) |
| `Help.jsx` | `/help` | Help/FAQ page |
| `Privacy.jsx` | `/privacy` | Privacy policy |
| `TermsOfService.jsx` | `/terms` | Terms of service |
| `ErrorPage.jsx` | `*` | 404 / error fallback |
| `settings/` | `/settings/*` | Settings sub-pages (profile, password, privacy, etc.) |

---

### `/frontend/src/components/` (shared UI)
| Component | Purpose |
|-----------|---------|
| `Navbar.jsx` | Top nav with search, auth, mobile menu (~28KB) |
| `MovieCard.jsx` | Card with poster, rating badge, hover actions |
| `MovieRow.jsx` | Horizontal scrollable row of MovieCards |
| `RatingMeter.jsx` | Star/score rating UI widget (~18KB) |
| `SearchBar.jsx` | Inline search input with suggestions |
| `SearchOverlay.jsx` | Full-screen search overlay (~14KB) |
| `InfoBanner.jsx` | Global info/alert banner (~7KB) |
| `TrailerModal.jsx` | YouTube trailer embed modal |
| `SaveToCollectionModal.jsx` | Add-to-watchlist modal |
| `AddContentModal.jsx` | Request new content modal |
| `WatchlistCollectionCard.jsx` | Watchlist collection card |
| `WatchlistSection.jsx` | Watchlist section in dashboard |
| `CastCrew.jsx` | Cast/crew grid display |
| `ProductionTags.jsx` | Genre/company/country tag pills |
| `HomeNewsStrip.jsx` | Horizontal news ticker strip |
| `NewsCard.jsx` | News article card |
| `NewsArticlesSection.jsx` | News section wrapper |
| `FilterDropdown.jsx` | Generic filter dropdown |
| `Aurora.jsx` | Animated aurora background effect |
| `BorderGlow.jsx` | CSS glow border animation component |
| `ShinyText.jsx` | Shimmering text animation |
| `StaggerContainer.jsx` | Framer Motion stagger wrapper |
| `PageTransition.jsx` | Route transition animation |
| `ScrollReveal.jsx` | Intersection-observer reveal animation |
| `ScrollRestore.jsx` | Scroll position restore (~8KB) |
| `ColdStartLoader.jsx` | Loading state for cold-start recs |
| `MovieCardSkeleton.jsx` | Skeleton placeholder for MovieCard |
| `ProtectedRoute.jsx` | Auth guard wrapper for protected routes |
| `ErrorBoundary.jsx` | React error boundary |
| `InstallPrompt.jsx` | PWA install prompt |
| `RequestContentModal.jsx` | Modal to request content |
| `AnalyticsLoader.jsx` | Mounts Umami script lazily (requestIdleCallback / 5s fallback). Deduplicates route pageviews. On script error → fallback `fetch` impl bypasses adblockers. Flushes queued events after load. |

---

### `/moctale_scrapper/`
| File | Purpose |
|------|---------|
| `scrapper.py` | Main Moctale/TMDB scraper (~8KB). Fetch movie/TV metadata. |
| `save_auth.py` | Save auth session for scraping. |
| `convert.py` | Convert scraped data formats. |
| `movie_import.ipynb` | Jupyter notebook for bulk movie import. |
| `dataset.csv` | Full scraped movie dataset (~1.4MB). |
| `movie_list.json` | Raw movie list from Moctale (~840KB). |

### `/AI_Context/`
| File | Purpose |
|------|---------|
| `ARCHITECTURE.md` | High-level system architecture |
| `FILE_MAP.md` | Previous manual file map (superseded by this map.md) |
| `KNOWN_PATTERNS.md` | Established coding patterns + gotchas |

### `/testing/`
| File | Purpose |
|------|---------|
| `evaluate_model.py` | Rec model offline evaluation (~22KB) |
| `check_db.py` | DB schema/FK integrity checker |
| `check_predictions.py` | Validate model prediction output |
| `results.json` | Evaluation metrics results |

---

## Key Patterns

* **Auth flow**: JWT access (48h) + refresh (7d) tokens. `AuthContext` fires `mv:logout` event on 401 via `api.js` interceptor.
* **Caching**: Redis via `cache.py`. Page-level cache via `pageCache.js` (frontend).
* **Recommendations**: Hybrid CF + content-based + ML ranker. `advanced_recs.py` for FedPCL graph approach.
* **DB sessions**: Always use `get_db()` dep injection. Never create sessions manually in routers.
* **Config**: Only use `settings` singleton from `config.py`. Never `os.getenv()` directly.
* **Migrations**: Alembic only. Run from `/backend`. Add new models to `orm_models.py` first.

---

## Error Code Registry

Format: `MV-[LAYER][CATEGORY][NUMBER]`
- Layer: `B` = backend, `F` = frontend
- Category: `AU` auth · `DB` database · `RD` Redis · `TK` TMDB · `TM` timeout · `RC` recommendations · `ML` ML ranker · `VD` validation · `SV` server · `NW` network · `RO` routing · `UI` UI/component

| Code | Layer | Meaning | Where to look |
|------|-------|---------|---------------|
| MV-BAU01 | Backend | JWT verify failed — token invalid/expired | `utils/jwt_utils.py` · `utils/deps.py` |
| MV-BAU02 | Backend | Refresh token missing or revoked | `routers/auth.py` refresh endpoint |
| MV-BDB01 | Backend | DB connection failed at startup | `db/database.py` · `main.py` lifespan |
| MV-BDB02 | Backend | DB query timeout (>30s) | Any router — check SQLAlchemy logs |
| MV-BDB03 | Backend | FK constraint violation on insert | `routers/tv.py` persist genres · `routers/movies.py` |
| MV-BDB04 | Backend | Unique constraint violation on insert | DB insert without ON CONFLICT guard |
| MV-BRD01 | Backend | Redis connection failed | `db/cache.py` · `main.py` lifespan |
| MV-BRD02 | Backend | Redis cache set failed (serialization) | `db/cache.py` `set_cached()` |
| MV-BTK01 | Backend | TMDB fetch failed — network/ConnectError | `services/tmdb_service.py` `_get()` |
| MV-BTK02 | Backend | TMDB 429 rate limit hit | `services/tmdb_service.py` retry loop |
| MV-BTK03 | Backend | TMDB 404 — content not found | `services/tmdb_service.py` `_get()` |
| MV-BTM01 | Backend | TMDB request timeout (>30s) | `services/tmdb_service.py` timeout config |
| MV-BRC01 | Backend | Recommendation engine empty result | `services/recommendation_service.py` |
| MV-BRC02 | Backend | Graph cache miss — cold start recs | `services/advanced_recs.py` graph init |
| MV-BML01 | Backend | Ranker model load failed (ranker.json missing) | `ml/ranker.py` |
| MV-BML02 | Backend | Ranker score NaN or invalid output | `ml/ranker.py` `rank_candidates()` |
| MV-BSV01 | Backend | Unhandled 500 internal server error | `main.py` global exception handler |
| MV-BSV02 | Backend | Startup lifespan hook failed | `main.py` lifespan `startup` section |
| MV-BVD01 | Backend | Pydantic validation error — bad request body | Any router with request body |
| MV-FAU01 | Frontend | Login API returned 401 | `services/authService.js` |
| MV-FAU02 | Frontend | Silent refresh failed — forced logout | `context/AuthContext.jsx` refresh logic |
| MV-FNW01 | Frontend | Axios network error (no response from server) | `utils/api.js` interceptor |
| MV-FNW02 | Frontend | API response timeout on frontend (>10s) | `utils/api.js` timeout config |
| MV-FRO01 | Frontend | React Router unknown route hit | `App.jsx` catch-all → `ErrorPage.jsx` |
| MV-FRO02 | Frontend | ProtectedRoute — user not authenticated | `components/ProtectedRoute.jsx` |
| MV-FUI01 | Frontend | React ErrorBoundary caught render crash | `components/ErrorBoundary.jsx` |
| MV-FUI02 | Frontend | Component null ref / state corruption | Check component stack in error detail |
| MV-FTM01 | Frontend | API call took >10s — timeout shown to user | `utils/api.js` timeout interceptor |
| MV-FDB01 | Frontend | localStorage quota exceeded | `utils/storage.js` `setItem()` |
