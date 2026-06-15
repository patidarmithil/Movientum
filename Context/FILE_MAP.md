# File Map — Movientum

## Backend  (`backend/`)

### Entry Point
| File | Purpose |
|---|---|
| `app/main.py` | FastAPI app, CORS, lifespan (DB+Redis check + automatic old movie cleanup), router registrations, global exception handlers |
| `app/config.py` | Pydantic Settings — single source of truth for all env vars. Import `settings` object. Never use `os.getenv()` elsewhere |
| `app/celery_app.py` | Celery configuration and tasks setup |

### Routers (`app/routers/`)
| File | Prefix | Endpoints |
|---|---|---|
| `auth.py` | `/api/v1/auth` | POST `/register`, POST `/login`, POST `/refresh`, POST `/logout`, GET `/me` |
| `movies.py` | `/api/v1/movies` | GET `/trending`, GET `/top_rated`, GET `/upcoming`, GET `/explore`, GET `/genre/{genre_id}`, GET `/{movie_id}`, GET `/{movie_id}/credits` |
| `tv.py` | `/api/v1/tv` | GET `/{tv_id}`, GET `/{tv_id}/credits` |
| `search.py` | `/api/v1/search` | GET `/` (FTS + TMDB fallback), GET `/autocomplete`, GET `/instant` (live typing predictive search, pg_trgm fuzzy matching, limit=20) |
| `ratings.py` | `/api/v1/ratings` | POST `/`, GET `/user`, GET `/movie/{movie_id}`, DELETE `/{rating_id}` |
| `watch.py` | `/api/v1/watch` | POST `/history`, GET `/history`, POST `/watchlist`, GET `/watchlist`, DELETE `/watchlist/{movie_id}` |
| `recommendations.py` | `/api/v1/recommendations` | GET `/` (personalized), GET `/similar/{id}` |
| `person.py` | `/api/v1/person` | GET `/{person_id}` (actor/director info + filmography) |
| `clicks.py` | `/api/v1/clicks` | POST `/` (log item click behavior event) |
| `users.py` | `/api/v1/users` | GET `/analysis` (user behavioral activity charts & dashboard summary analytics) |
| `news.py` | `/api/v1/news` | GET `/feed/latest` (unpersonalized latest feed), GET `/feed/for-you` (personalized news feed based on user genre/watch preferences), POST `/fetch/global` (manual newsAPI crawl trigger), POST `/article/{article_id}/view` (no-op) |
| `requests.py` | `/api/v1/requests` | POST `/` (saves user request for missing content to `requested_content` table) |

> ⚠️ **Route ordering matters in movies.py**: `/trending`, `/top_rated`, `/upcoming`, `/explore`, `/genre/{id}` MUST be defined BEFORE `/{movie_id}` — FastAPI matches in order.

### Services (`app/services/`)
| File | Responsibility |
|---|---|
| `auth_service.py` | User management (create, authenticate, fetch, bcrypt checks) |
| `tmdb_service.py` | Sourced API calls to TMDB. Singleton client, rate limiters, retries, fallbacks |
| `advanced_recs.py` | 11-step similarity engine. Core logic: `get_advanced_similar_items(db, item_id, media_type, user_id)` |
| `recommendation_service.py` | Scored personalized feed recommendations |
| `search_service.py` | FTS search on database + TMDB fallback, autocomplete prefix search, and instant search (uses trigram cosine similarity) |
| `rating_service.py` | User category-based rating CRUD (skip, timepass, go_for_it, perfection) |
| `watch_service.py` | Watch history & Watchlist transactions |
| `analysis_service.py` | Aggregate database analytics for dashboard graphs |
| `click_service.py` | Click logging transaction handlers |
| `news_service.py` | Redis-only News Service. Fetches from NewsAPI, filters clickbait, scores articles in memory against user preferences/history |

### DB Layer (`app/db/`)
| File | Responsibility |
|---|---|
| `database.py` | Async SQLAlchemy connection context & pools. Dependency `get_db()` |
| `orm_models.py` | DB Schema Declarations: Movie, Genre, MovieGenre, Director, MovieDirector, User, Rating, WatchHistory, Watchlist, UserGenrePreference, ClickHistory, MovieRating, TvRating, RatingNeeded, RequestedContent |
| `orm_models_news.py` | Deprecated (News system uses Redis exclusively for storage) |
| `cache.py` | Upstash Redis connection + async cache get/set/invalidate wrapper + key builders + inflight lock stampede guard |

### Schemas (`app/schemas/`)
| File | Pydantic Models |
|---|---|
| `movie.py` | Request/Response shapes for movies |
| `user.py` | Auth request structures & payload wrappers |
| `rating.py` | Rating input validation and output shapes |
| `watch.py` | Watch status request/response bodies |
| `search.py` | Search output formats |
| `news.py` | Pydantic schema validation for news feed items |

### Utilities (`app/utils/`)
| File | Purpose |
|---|---|
| `jwt_utils.py` | Access/Refresh token encoder/decoders |
| `deps.py` | Auth inject dependencies (`get_current_user`, blacklist validators) |
| `persistence.py` | Popularity thresholds for deciding which TMDB movies persist into the local DB |

---

## Frontend  (`frontend/src/`)

### Pages (`src/pages/`)
| File | Route | Notes |
|---|---|---|
| `Home.jsx` | `/` | Home landing page showing trending rows, recommendations, and News strip |
| `MovieDetail.jsx` | `/movies/:id` | Detailed movie viewer, crew, similar items, custom rating meter |
| `TVDetail.jsx` | `/tv/:id` | TV show details |
| `Explore.jsx` | `/explore` | Multi-criteria explore filters (genres, minimum score, sorting options) |
| `Search.jsx` | `/search` | Fallback search page |
| `MovieList.jsx` | `/movies` | Paginated movie browsing |
| `PersonPage.jsx` | `/person/:id` | Actor/Director metadata + scrollable filmography |
| `CompanyPage.jsx` | `/company/:id` | Production company profile |
| `CountryPage.jsx` | `/country/:id` | Movies filtered by origin country |
| `Dashboard.jsx` | `/dashboard` | User dashboard (watchlist, ratings, watch history summaries) |
| `Analysis.jsx` | `/analysis` | Interactive charts representing user watchlist distribution, ratings, and click analytics |
| `News.jsx` | `/news` | Scored personalized news articles feed |
| `Login.jsx` | `/login` | Form supporting "Remember me" toggling |
| `Register.jsx` | `/register` | User sign-up page |

### Components (`src/components/`)
| File | Purpose |
|---|---|
| `Navbar.jsx` | Global header containing links, search trigger, and user profile buttons |
| `SearchOverlay.jsx` | Moctale-style Fullscreen overlay for real-time predictive search (debounced, caches inputs, keyboard navigation, has fallback empty request content modal) |
| `RequestContentModal.jsx` | Modal shown from search empty states to submit requested content |
| `MovieCard.jsx` | Media card with details and click tracking hooks |
| `MovieCardSkeleton.jsx` | Shimmer loader placeholder for grid content |
| `RatingMeter.jsx` | Custom category selector (skip/timepass/go_for_it/perfection) showing aggregate votes |
| `CastCrew.jsx` | Actor and crew lists on details page |
| `ProtectedRoute.jsx` | Guard wrapping admin/user protected routes |
| `Aurora.jsx` | WebGL canvas dynamic backdrop effect |
| `BorderGlow.jsx` | Radial hover-bound border glow animation |
| `HomeNewsStrip.jsx` | Slider strip displaying latest news on the homepage |
| `NewsArticlesSection.jsx` | List layout with pagination for news view |
| `NewsCard.jsx` | Scored news item display card |
| `ProductionTags.jsx` | Visual list tags of production companies on details page |
| `ShinyText.jsx` | Text styling gradient micro-animation |

### Services (`src/services/`)
| File | API Wrappers |
|---|---|
| `authService.js` | Login, register, logout, me, refresh calls |
| `movieService.js` | All standard TMDB catalog endpoints |
| `ratingService.js` | User rating CRUD actions |
| `watchService.js` | Watchlist and history triggers |
| `searchService.js` | Search autocomplete and instant search methods |
| `userService.js` | Analytics fetches |
| `newsService.js` | News feed endpoints |

### Core (`src/`)
| File | Purpose |
|---|---|
| `utils/api.js` | Axios instance configured with VITE_API_URL, 45s timeouts, bearer injection interceptors, and automatic 401 token refresh queue |
| `utils/storage.js` | Dynamic storage wrapper routing items between localStorage and sessionStorage based on "Remember Me" status |
| `context/AuthContext.jsx` | Global context keeping user auth state synchronized |
| `App.jsx` | Core Router configurations + session validation |
| `main.jsx` | DOM Mount point |
| `index.css` | Color tokens, layout standards, reset stylesheet |
