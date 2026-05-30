# 🎬 Movientum — Federated Personalized Movie Recommendation Platform

> **BTP (Bachelor's Thesis Project)** — A full-stack movie discovery platform that integrates a privacy-preserving federated learning recommendation system (FedPCL) as its core AI engine.

---

## 📖 Table of Contents

- [Project Overview](#-project-overview)
- [Research Foundation](#-research-foundation)
- [System Architecture](#-system-architecture)
- [Technology Stack](#-technology-stack)
- [Features Implemented](#-features-implemented)
- [Features Planned / In Progress](#-features-planned--in-progress)
- [Backend — API Reference](#-backend--api-reference)
- [Database Schema](#-database-schema)
- [Caching Strategy (Redis)](#-caching-strategy-redis)
- [FedPCL — Federated Recommendation System](#-fedpcl--federated-recommendation-system)
- [Recommendation Pipeline (Current)](#-recommendation-pipeline-current)
- [MLOps & Training Pipeline](#-mlops--training-pipeline)
- [Deployment](#-deployment)
- [Environment Variables](#-environment-variables)
- [Local Development Setup](#-local-development-setup)
- [Project Structure](#-project-structure)
- [Evaluation Metrics](#-evaluation-metrics)

---

## 🚀 Project Overview

**Movientum** is a cinematic discovery platform built around personalized, privacy-preserving movie recommendations. Users can browse movies, rate them using a custom category system, track their watch history, manage a watchlist, and receive personalized "For You" recommendations — all without their raw interaction data ever leaving their device.

The platform's primary research contribution is the integration of **FedPCL (Federated Personalized Contrastive Learning)**, an advanced federated learning algorithm that solves three core challenges in recommendation systems:

| Problem | Cause | FedPCL Solution |
|---------|-------|-----------------|
| **Data Sparsity** | Each user has tiny interaction graph (~20–100 movies) | Structural contrastive learning via 2-hop neighbours |
| **Non-IID Data** | Users have wildly different taste profiles | K-means clustering + per-cluster item embedding models |
| **Privacy** | Gradients can leak interaction patterns | Local Differential Privacy (LDP) applied before any upload |

---

## 📄 Research Foundation

> **Paper:** Wang et al., *"Personalized Federated Contrastive Learning for Recommendation,"* IEEE TCSS Vol. 12, No. 5, October 2025.

The FedPCL architecture implemented here is based directly on this paper. Benchmark results from the paper:

| Dataset | HR@10 | NDCG@10 |
|---------|-------|---------|
| Steam | 80.36% | 65.55% |
| ML-100K | 63.81% | 45.03% |
| ML-1M | 62.86% | 44.12% |
| Amazon | 34.04% | 22.93% |

Movientum targets **HR@10 ≥ 60%** on the Movientum user dataset by end of 400 federated training rounds.

---

## 🏗 System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        MOVIENTUM PLATFORM                               │
│                                                                         │
│  User's Browser                                                         │
│  ┌─────────────────────────────────┐                                   │
│  │   React SPA (Single Page App)   │                                   │
│  │   Pages: Home, Movies, Search,  │                                   │
│  │   Dashboard, Login, MovieDetail │                                   │
│  └──────────────┬──────────────────┘                                   │
│                 │ HTTPS + JWT                                           │
│                 ▼                                                       │
│  ┌─────────────────────────────────┐                                   │
│  │    NGINX  (Reverse Proxy)       │                                   │
│  │  SSL · Rate Limit · Route       │                                   │
│  └──────────┬──────────┬───────────┘                                   │
│         /api/*          /* (SPA static files)                          │
│             ▼                                                           │
│  ┌──────────────────┐                                                  │
│  │  FASTAPI BACKEND │                                                  │
│  │  Auth · Log · CORS Middleware                                       │
│  │  Routers → Services → Repositories                                  │
│  └──┬────────────┬───┘                                                 │
│     ▼            ▼                                                      │
│  ┌──────┐     ┌──────┐   ┌─────────────┐   ┌────────────────┐        │
│  │  PG  │     │Redis │   │Celery Worker│   │ External APIs  │        │
│  │  DB  │     │Cache │   │(Background) │   │ TMDB · NewsAPI │        │
│  └──────┘     └──────┘   └─────────────┘   └────────────────┘        │
│                                                                         │
│  ┌─────────────────────────────────┐                                   │
│  │  FedPCL Training Module         │                                   │
│  │  (PyTorch · LightGCN · K-means) │                                   │
│  └─────────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Architecture Principles

- **Modular Monolith**: All backend features in one deployable service, structured internally with clear module boundaries (Router → Service → Repository). Easy to split into microservices later.
- **Strict Layer Separation**: Routers handle HTTP only. Services own business logic. Repositories own DB queries. No cross-layer direct access.
- **Cache-First**: Every read goes through Redis first. DB is hit only on cache miss.

---

## 🔧 Technology Stack

### Frontend

| Technology | Version | Role |
|-----------|---------|------|
| **React** | 19.x | UI framework (SPA) |
| **React Router DOM** | 7.x | Client-side routing |
| **Vite** | 8.x | Build tool & dev server |
| **Axios** | 1.x | HTTP client with JWT interceptors |
| **OGL** | 1.x | WebGL for Aurora background animation |
| **Vanilla CSS** | — | Custom design system, glassmorphism, animations |

**Deployed on:** [Vercel](https://vercel.com) — with SPA rewrites configured via `vercel.json`.

### Backend

| Technology | Version | Role |
|-----------|---------|------|
| **FastAPI** | 0.115.0 | Async REST API framework |
| **Python** | 3.13 | Runtime |
| **Uvicorn** | 0.30.6 | ASGI server (dev + prod) |
| **Gunicorn** | 23.0.0 | Process manager (prod, 4 workers) |
| **SQLAlchemy** | 2.0.36 | Async ORM |
| **Alembic** | 1.14.0 | Schema migration management |
| **asyncpg** | 0.30.0 | Async PostgreSQL driver |
| **python-jose** | 3.3.0 | JWT creation & validation (HS256) |
| **passlib[bcrypt]** | 1.7.4 | Password hashing (bcrypt cost=12) |
| **httpx** | 0.27.2 | Async HTTP client (TMDB API calls) |
| **Celery** | 5.4.0 | Background task queue |
| **PyYAML** | 6.0.2 | Config loading (`params.yaml`, `definitions.yaml`) |
| **Pydantic** | 2.11.7 | Request/response validation |

**Deployed on:** [Railway](https://railway.app) (or equivalent PaaS) / self-hosted VPS with Docker.

### Database & Infrastructure

| Service | Technology | Role |
|---------|-----------|------|
| **PostgreSQL** | 15+ (via Supabase) | Primary persistent data store |
| **Redis** | 7+ (via Upstash) | Cache, token blacklist, Celery broker |
| **Supabase** | — | Managed PostgreSQL hosting |
| **Upstash Redis** | — | Managed Redis (serverless, HTTP-compatible) |
| **Nginx** | — | Reverse proxy, SSL termination, rate limiting |

### ML & Research

| Technology | Role |
|-----------|------|
| **PyTorch** | FedPCL model training (LightGCN backbone) |
| **NumPy / scikit-learn** | K-means clustering, matrix ops |
| **MLflow** | Experiment tracking, model registry |
| **Prometheus + Grafana** | Model drift monitoring, business metrics |

### External APIs

| API | Purpose |
|-----|---------|
| **TMDB (The Movie Database)** | Movie metadata, images, trending, similar movies |
| **NewsAPI** | Movie-related news articles |

---

## ✅ Features Implemented

### Backend (FastAPI)

#### Auth System (`/api/v1/auth`)
- [x] `POST /register` — user registration with bcrypt (cost=12) password hashing
- [x] `POST /login` — credential verification, returns JWT access + refresh tokens
- [x] `POST /refresh` — rotate refresh tokens (30-day lifetime)
- [x] `POST /logout` — blacklists JWT `jti` in Redis (TTL = remaining token lifetime)
- [x] `GET /me` — returns current user profile (auth-gated)
- [x] Same `"Invalid credentials"` for wrong email AND wrong password (prevents user enumeration)
- [x] Redis token blacklist — logout is immediately effective

#### Movies (`/api/v1/movies`)
- [x] `GET /movies` — paginated movie list with genre filter, sort options
- [x] `GET /movies/{id}` — full movie detail (with genres, director, cast)
- [x] `GET /movies/trending` — trending movies (TMDB + local popularity)
- [x] Redis caching on all movie endpoints (TTL 30min–1hr)

#### TV Shows (`/api/v1/tv`)
- [x] `GET /tv/{id}` — TV show detail page
- [x] Similar TV shows via TMDB

#### Search (`/api/v1/search`)
- [x] `GET /search?q=&page=` — PostgreSQL full-text search (FTS with `tsvector` + GIN index)
- [x] `GET /search/autocomplete?q=` — debounced prefix search, Redis-cached 5min
- [x] TMDB fallback if local results < 5

#### Ratings (`/api/v1/ratings`)
- [x] `POST /ratings` — submit rating with category enum (upsert: 1 per user per movie)
- [x] `GET /ratings/me` — paginated personal ratings
- [x] `GET /ratings/distribution/{movie_id}` — public bucket counts per category
- [x] `PUT /ratings/{id}` — update own rating
- [x] `DELETE /ratings/{id}` — delete own rating
- [x] Custom 4-category rating system: `skip` / `timepass` / `go_for_it` / `perfection`
- [x] Cache invalidation on mutation (rating dist + user recommendations)

#### Watch History & Watchlist (`/api/v1/watch`)
- [x] `POST /watch` — mark movie as watched (upsert)
- [x] `GET /watch/history` — paginated watch history
- [x] `POST /watch/watchlist` — add to watchlist (idempotent)
- [x] `DELETE /watch/watchlist/{movie_id}` — remove from watchlist
- [x] `GET /watch/watchlist` — fetch watchlist
- [x] `GET /watch/status/{movie_id}` — `{watched: bool, watchlisted: bool}`

#### Recommendations (`/api/v1/recommendations`)
- [x] `GET /recommendations` — personalized picks (rule-based, genre affinity, trending fallback)
- [x] `GET /recommendations/similar/{id}` — similar movies (genre-overlap, popularity sort)
- [x] Advanced recommendations service (`advanced_recs.py`) — multi-factor scoring with TMDB signals

#### Person Pages (`/api/v1/person`)
- [x] `GET /person/{id}` — director/actor detail with filmography

#### Click Tracking (`/api/v1/clicks`)
- [x] Click-through logging for user preference signals

#### Analysis Service
- [x] `analysis_service.py` — user behavior analytics (watch patterns, genre affinities, ratings distribution)

### Frontend (React + Vite)

#### Pages
- [x] **Home** — Hero section, Trending row, genre rows, "For You" row (auth-gated)
- [x] **Movie List** — Paginated grid, genre filter sidebar, sort dropdown
- [x] **Movie Detail** — Full detail, RatingMeter, Similar Movies row, Cast & Crew
- [x] **TV Detail** — TV show detail page
- [x] **Search** — Full-text results page (reads `?q=` param)
- [x] **Login** — JWT auth, "remember me", inline validation, Aurora background
- [x] **Register** — Full registration form with password strength indicator
- [x] **Dashboard** — Protected route, 3 tabs: Watch History / Watchlist / My Ratings
- [x] **Explore** — Browse/discovery page
- [x] **Person Page** — Director/actor filmography
- [x] **Analysis** — User analytics dashboard (watch patterns, genre stats)

#### Components
- [x] **Navbar** — SearchBar (center), Login/Avatar dropdown (right), responsive
- [x] **SearchBar** — Debounced 300ms autocomplete, 8 results, click → MovieDetail
- [x] **MovieCard** — Glassmorphic card, hover animation, genre badges
- [x] **MovieCardSkeleton** — Loading state placeholder
- [x] **RatingMeter** — SVG semicircular gauge showing category distribution
  - 4 color-coded buckets: Skip `#FF4D6D` / Timepass `#FFC300` / Go For It `#00E5A0` / Perfection `#9B59FF`
  - Guest: read-only. Logged-in: clickable category pills
- [x] **Aurora** — Animated WebGL aurora background (OGL-powered)
- [x] **BorderGlow** — Animated border glow effect component
- [x] **CastCrew** — Cast and crew display component
- [x] **ProtectedRoute** — Redirects unauthenticated users to `/login`

#### Auth & State
- [x] `AuthContext.jsx` — Global auth state (`user`, `token`, `isLoggedIn`, `isLoading`)
- [x] Session restore on page reload (localStorage)
- [x] Axios interceptors — auto-attach JWT, transparent token refresh on 401

#### Services (Frontend API Layer)
- [x] `authService.js` — register, login, logout, refreshToken
- [x] `movieService.js` — all movie API calls
- [x] `searchService.js` — search + autocomplete
- [x] `ratingService.js` — submit/update/delete ratings, get distribution
- [x] `watchService.js` — mark watched, watchlist CRUD, status check

---

## 🔄 Features Planned / In Progress

### Recommendation System — FedPCL Integration

> ⚠️ **The FedPCL federated recommendation engine is designed and documented but not yet wired into the live platform.** The current recommendation endpoint uses rule-based logic (genre affinity + popularity). FedPCL integration is the primary remaining milestone.

| Feature | Status |
|---------|--------|
| Rule-based recommendations (genre affinity + trending fallback) | ✅ Done |
| Advanced multi-factor recommendation scoring (TMDB signals) | ✅ Done |
| FedPCL server module (aggregation, K-means clustering) | 📐 Designed |
| FedPCL client module (LightGCN training, LDP noise) | 📐 Designed |
| `GET /api/v1/recommendations` wired to FedPCL model | ⏳ Pending |
| MLflow experiment tracking integration | ⏳ Pending |
| Federated training round lifecycle (bi-weekly cron) | ⏳ Pending |

### Other Pending Items

| Feature | Status |
|---------|--------|
| Email OTP verification on register | ⏳ Phase 4 |
| Docker Compose production setup | 📐 Designed |
| CI/CD GitHub Actions pipeline | ⏳ Pending |
| Celery news sync cron (bi-hourly NewsAPI fetch) | ⏳ Pending |
| Prometheus + Grafana monitoring stack | 📐 Designed |

---

## 📡 Backend — API Reference

### Base URL

- Development: `http://localhost:8000/api/v1`
- Production: `https://<your-domain>/api/v1`

### Authentication

JWT Bearer tokens. Access token lifetime: **60 minutes**. Refresh token: **30 days**.

```
Authorization: Bearer <access_token>
```

### Endpoint Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | Public | Create account |
| POST | `/auth/login` | Public | Login, get tokens |
| POST | `/auth/refresh` | Refresh token | Rotate access token |
| POST | `/auth/logout` | Access token | Blacklist token in Redis |
| GET | `/auth/me` | ✅ Required | Current user profile |
| GET | `/movies` | Public | Paginated movie list |
| GET | `/movies/{id}` | Public | Movie detail |
| GET | `/movies/trending` | Public | Trending movies |
| GET | `/search?q=` | Public | Full-text search |
| GET | `/search/autocomplete?q=` | Public | Autocomplete suggestions |
| POST | `/ratings` | ✅ Required | Submit/update rating |
| GET | `/ratings/me` | ✅ Required | My ratings |
| GET | `/ratings/distribution/{movie_id}` | Public | Rating category breakdown |
| PUT | `/ratings/{id}` | ✅ Required | Update rating |
| DELETE | `/ratings/{id}` | ✅ Required | Delete rating |
| POST | `/watch` | ✅ Required | Mark movie watched |
| GET | `/watch/history` | ✅ Required | Watch history |
| POST | `/watch/watchlist` | ✅ Required | Add to watchlist |
| DELETE | `/watch/watchlist/{movie_id}` | ✅ Required | Remove from watchlist |
| GET | `/watch/watchlist` | ✅ Required | Get watchlist |
| GET | `/watch/status/{movie_id}` | ✅ Required | Watch + watchlist status |
| GET | `/recommendations` | ✅ Required | Personalized picks |
| GET | `/recommendations/similar/{id}` | Public | Similar movies |
| GET | `/tv/{id}` | Public | TV show detail |
| GET | `/person/{id}` | Public | Person filmography |
| GET | `/health` | Public | Health check |

### Rating Categories

```
skip        → Did not enjoy
timepass    → Average / watchable
go_for_it   → Good, recommend
perfection  → Masterpiece
```

---

## 🗄 Database Schema

**Database:** PostgreSQL 15+ (hosted on Supabase). Managed via **Alembic** migrations.

### Core Tables

| Table | Description |
|-------|-------------|
| `users` | Registered accounts (UUID PK, bcrypt hash, role) |
| `movies` | TMDB movie catalog (TMDB ID as PK, popularity, vote_average, FTS vector) |
| `genres` | Genre lookup (TMDB genre IDs) |
| `movie_genres` | Many-to-many: movies ↔ genres |
| `directors` | Director profiles (TMDB person IDs) |
| `movie_directors` | Many-to-many: movies ↔ directors |
| `ratings` | User ratings (4-category enum, upsert on conflict) |
| `watch_history` | Watch records (upsert on conflict) |
| `watchlist` | Saved-for-later entries |
| `user_genre_preferences` | Explicit genre weights (onboarding) |

### FedPCL Model Storage (Planned)

| Table | Description |
|-------|-------------|
| `fedpcl_models` | Versioned global embedding tables (`E_global` as BYTEA) |
| `fedpcl_clusters` | Per-cluster embedding tables (`E_cluster[k]` as BYTEA) |
| `user_cluster_assignments` | `{user_id → cluster_id}` mapping |

### Key Indexes

```sql
-- Full-text search on movies
CREATE INDEX idx_movies_search_vector ON movies USING GIN(search_vector);

-- Popularity-based trending
CREATE INDEX idx_movies_popularity ON movies(popularity DESC);

-- Rating and watch lookups
CREATE INDEX idx_ratings_user_id ON ratings(user_id);
CREATE INDEX idx_watch_history_user_id ON watch_history(user_id);
```

---

## ⚡ Caching Strategy (Redis)

Redis hosted on **Upstash** (serverless, HTTP-compatible). Used for:

1. **Cache** — Speed up repeated reads
2. **JWT Blacklist** — Enforce logout immediately
3. **Celery Broker** — Background task queue

### Cache Key Reference

| Key Pattern | TTL | Invalidated By |
|-------------|-----|----------------|
| `movie:detail:{id}` | 1 hour | Movie data update |
| `movie:trending` | 30 min | Daily sync task |
| `movie:list:{hash(params)}` | 30 min | — |
| `search:results:{query_hash}` | 10 min | — |
| `search:autocomplete:{prefix}` | 5 min | — |
| `user:recommendations:{user_id}` | 15 min | User rates / watches movie |
| `rating:dist:{movie_id}` | 5 min | Any rating mutation |
| `news:feed:global` | 2 hours | News sync task |
| `auth:blacklist:{jti}` | Token remaining lifetime | — |
| `tmdb:keywords:{type}:{id}` | 24 hours | — |

### Request Latency (Cache State)

| Request | Cache State | Expected Latency |
|---------|-------------|------------------|
| Movie detail | Redis HIT | < 10ms |
| Movie detail | Redis MISS | 50–150ms |
| Search (local FTS) | Redis MISS | 50–200ms |
| Recommendations (rule-based) | Redis HIT | < 10ms |
| Autocomplete | Redis HIT | < 5ms |
| Auth login | Always DB | 150–300ms (bcrypt) |

---

## 🤖 FedPCL — Federated Recommendation System

> This section documents the complete FedPCL architecture as designed for Movientum. Integration into the live platform is the primary remaining milestone.

### Core Algorithm

FedPCL combines:
1. **LightGCN** — Graph Neural Network backbone for embedding propagation
2. **Contrastive Learning** — Self-supervised loss using 2-hop structural neighbours
3. **K-means Clustering** — Per-cluster personalized item embedding tables
4. **Local Differential Privacy (LDP)** — Laplacian noise applied client-side before upload

### LightGCN Embedding Propagation

```
Layer 0 (Initialization):
  e_u^(0) = randomly initialized user embedding [dim=64]
  E_i^(0) = item embedding from cluster/global model [dim=64]

Layer 1 (1-hop aggregation):
  e_u^(1) = (1/√|N_u|) × Σ E_i^(0)   for all i in user's movies

Layer 2 (2-hop aggregation):
  e_u^(2) = (1/√|N_u|) × Σ E_i^(1)

Final user representation:
  e_u_agg = (e_u^(0) + e_u^(1) + e_u^(2)) / 3
```

### Total Loss

```
L_total = L_BPR + L_reg + β₁ × (L_Con^U + λ × L_Con^V)

Where:
  L_BPR  = Bayesian Personalized Ranking (pairwise ranking loss)
  L_Con^U = User contrastive loss (InfoNCE, temperature τ)
  L_Con^V = Item contrastive loss (cross-entropy on similarity matrix)
  β₁ = 0.1, λ = 1.0, τ = 0.2
```

Contrastive loss activates after `warmup_rounds=20` (BPR first builds stable base embeddings).

### Personalization Chain

```
User behavior (watch_history + ratings)
  → train_items list for this user

K-means clustering on noisy user embeddings
  → user assigned to cluster k (taste archetype group)

E_personal = 0.5 × E_cluster[k] + 0.5 × E_global

score(movie j) = e_u_agg · E_personal[j]
  → sort descending → top-N = recommendations
```

### Local Differential Privacy (LDP)

Applied **client-side** before any data leaves the device:

```python
# Clip gradients (bound sensitivity)
g_clipped = clamp(g, -σ, σ)    # σ = clip_sigma = 0.1

# Add Laplacian noise
g_private = g_clipped + Laplace(0, λ)   # λ = lambda_laplace = 0.001

# Privacy budget
ε = σ / λ = 100   (loose but fast to converge; tighten as compliance demands)
```

### FedPCL Hyperparameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `embed_dim` | 64 | Balance quality vs storage/compute |
| `n_gnn_layers` | 2 | 2-hop = sufficient collaborative signal |
| `n_rounds` | 400 | Paper default; convergence ~200 rounds |
| `clients_per_round` | 128 | Paper default |
| `local_epochs` | 10 | Sufficient local steps without divergence |
| `n_clusters` K | 5 | Paper default |
| `mu1, mu2` | 0.5, 0.5 | Equal blend cluster + global |
| `cluster_every` | 10 | Re-cluster every 10 rounds |
| `warmup_rounds` | 20 | Let BPR stabilize before CL activates |
| `beta1` β₁ | 0.1 | Contrastive loss weight |
| `tau` τ | 0.2 | InfoNCE temperature |
| `lr_item` | 0.1 | Item embedding SGD |
| `lr_user` | 0.001 | User embedding Adam |
| `clip_sigma` σ | 0.1 | LDP clip bound |
| `lambda_laplace` | 0.001 | LDP noise scale |

### Training Round Lifecycle

```
Bi-weekly cron trigger:
  Server selects K=128 eligible users (is_active=True AND ≥10 interactions)
    │
    ├── Server: compute E_personal per user (cluster blend)
    ├── Server: fetch 2-hop neighbour embeddings
    └── Server: dispatch training payload to each client
          │
          ├── Client: run 10 local LightGCN epochs
          ├── Client: compute item deltas
          ├── Client: apply LDP noise (Laplacian)
          └── Client: POST item_deltas_noisy + user_emb_noisy to server
                │
                ├── Server: FedAvg aggregate → E_global updated
                ├── Server: Cluster FedAvg → E_clusters[k] updated
                └── Every 10 rounds: K-means recluster
```

**RAW INTERACTION DATA NEVER LEAVES THE CLIENT.**

### FedPCL vs Alternatives

| Aspect | Centralized CF | FedAvg | FedPCL (Movientum) |
|--------|----------------|--------|---------------------|
| Privacy | None | Partial | Strong (LDP) |
| Personalization | Good | Poor (non-IID) | Strong (cluster models) |
| Data sparsity handling | Poor | Poor | Strong (2-hop CL) |
| GDPR compliance | Difficult | Moderate | Easiest |
| Accuracy | Highest | Lower | Near-centralized |

---

## 🛠 Recommendation Pipeline (Current)

The live recommendation endpoint (`advanced_recs.py`) uses a simplified, stable pipeline while FedPCL integration is pending:

```
STEP 1  Feature extraction  ──── Fetch item detail + current genres (parallel)
STEP 2  Candidate fetch     ──── same-type /recommendations → fallback /similar → /discover
STEP 3  Merge candidates
STEP 4  Quality filter      ──── vote_average ≥ 6.5 · vote_count ≥ 100 · poster exists
STEP 5  Deduplicate         ──── by (id, media_type) composite key
STEP 6  Score               ──── genre_overlap × 0.7 + rating_score × 0.3
STEP 7  User genre boost    ──── if authenticated: boost items matching user's top genres
STEP 8  Sort descending
STEP 9  Return top 40 items
```

**Caching:** Redis key `recs:{media_type}:{item_id}:{user_id}` — TTL 5–10 min.

**Fallback:** If TMDB partially fails, system still returns results using available data. No hard failure.

---

## 🔁 MLOps & Training Pipeline

### Experiment Tracking (MLflow)

Every training run tracked with:
- **Parameters**: `embed_dim`, `n_rounds`, `n_clusters`, `tau`, `lr_item`, `lr_user`, `clip_sigma`, etc.
- **Metrics per round**: `train_loss_bpr`, `train_loss_cl`, `eval_hr10`, `eval_ndcg10`
- **Artifacts**: `E_global_final.npy`, `cluster_assignments.json`, `training_config.yaml`

### Model Registry Stages

```
None → Staging → Production → Archived
```

Promotion requires: `HR@10 ≥ 0.60` AND `NDCG@10 ≥ 0.40` AND regression `≤ 2%` vs current production.

### ETL Pipeline (Pre-training)

```
Extract → watch_history + ratings + watchlist from PostgreSQL
Transform → merge interactions, weight by signal strength
          → filter users with ≥ 10 interactions
          → compute LightGCN adjacency weights
Load → versioned JSON dataset (e.g., dataset_v3_2026-05-30.json)
```

Interaction weights:

| Signal | Weight |
|--------|--------|
| Watched movie | 1.0 |
| Rated ≥ 6.0 | 1.5 |
| Rated < 5.0 | −0.5 |
| Watchlisted (not watched) | 0.5 |

### Retraining Triggers

| Trigger | Condition |
|---------|-----------|
| Scheduled | Bi-weekly cron (every 14 days) |
| Drift | HR@10 drops below 0.50 |
| Data growth | User base grows 20%+ since last training |

### Monitoring (Planned)

- **Prometheus** — metrics emission from FastAPI
- **Grafana** — HR@10, NDCG@10, CTR, watch completion, session length dashboards
- **Alertmanager** — email + Slack alerts on metric threshold breaches

| Metric | Target | Alert Below |
|--------|--------|-------------|
| CTR on recommendations | ≥ 8% | 5% |
| Watch completion from rec | ≥ 30% | 20% |
| Session length | ≥ 15 min | 10 min |
| HR@10 (offline) | ≥ 0.60 | 0.55 |

---

## 🚢 Deployment

### Frontend

**Platform:** [Vercel](https://vercel.com)

- SPA routing configured via `vercel.json` (all paths → `index.html`)
- Auto-deploy on `git push` to main branch
- Environment variable: `VITE_API_URL` (backend URL)

### Backend

**Platform:** Railway / Render / Self-hosted VPS (Ubuntu 22.04)

Docker Compose stack:
```
nginx        → port 80/443   (internet-facing, SSL via Let's Encrypt)
backend      → port 8000     (internal only, 4 Uvicorn workers)
celery       → no port       (task consumer)
postgres     → port 5432     (internal only — replaced by Supabase in cloud)
redis        → port 6379     (internal only — replaced by Upstash in cloud)
```

All containers on internal Docker network — only Nginx is internet-facing.

### Database (PostgreSQL)

**Platform:** [Supabase](https://supabase.com)

- Managed PostgreSQL with auto-backups
- Connection via `asyncpg` + SQLAlchemy async session
- Schema managed via Alembic migrations (`alembic upgrade head`)

### Cache (Redis)

**Platform:** [Upstash](https://upstash.com)

- Serverless Redis — pay per request
- HTTP-compatible (works in any environment)
- Used for: response cache, JWT blacklist, Celery broker

### CI/CD (Planned)

```
git push → GitHub Actions:
  1. Run tests (pytest)
  2. Build Docker image
  3. Push to registry
  4. SSH to server → docker compose pull + rolling restart
  5. Verify GET /api/health → 200
  6. Rollback if health check fails
```

---

## 🔑 Environment Variables

### Backend (`.env`)

```env
# Database
DATABASE_URL=postgresql+asyncpg://user:password@host:5432/dbname

# Cache
REDIS_URL=rediss://user:password@upstash-host:6379

# Auth
SECRET_KEY=your-very-long-random-secret-key
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# External APIs
TMDB_API_KEY=your-tmdb-api-key
NEWS_API_KEY=your-newsapi-key

# App
ENVIRONMENT=development   # or production
BACKEND_CORS_ORIGINS=["http://localhost:5173", "https://your-frontend.vercel.app"]
```

### Frontend (`.env`)

```env
VITE_API_URL=http://localhost:8000   # or production backend URL
```

---

## 💻 Local Development Setup

### Prerequisites

- Python 3.13+
- Node.js 20+
- PostgreSQL 15+ (or Supabase account)
- Redis 7+ (or Upstash account)

### 1. Clone & setup backend

```bash
git clone https://github.com/your-username/movientum.git
cd movientum

# Create virtual environment
cd backend
python -m venv venv
venv\Scripts\activate    # Windows
# or: source venv/bin/activate (Linux/macOS)

pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your DB_URL, REDIS_URL, TMDB_API_KEY, etc.

# Run migrations
alembic upgrade head

# Start backend
uvicorn app.main:app --reload --port 8000
```

### 2. Setup frontend

```bash
cd frontend
npm install

# Configure environment
cp .env.example .env
# Set VITE_API_URL=http://localhost:8000

npm run dev
# Runs on http://localhost:5173
```

### 3. (Optional) Start Celery worker

```bash
cd backend
celery -A app.celery_app worker --loglevel=info
```

### Health Check

```
GET http://localhost:8000/api/health
→ {"status": "ok", "db": "ok", "cache": "ok"}
```

---

## 📁 Project Structure

```
movientum/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, middleware, router registration
│   │   ├── config.py                # Settings (Pydantic), Redis, DB config
│   │   ├── celery_app.py            # Celery instance + task registration
│   │   ├── routers/
│   │   │   ├── auth.py              # /auth endpoints
│   │   │   ├── movies.py            # /movies endpoints
│   │   │   ├── search.py            # /search endpoints
│   │   │   ├── ratings.py           # /ratings endpoints
│   │   │   ├── watch.py             # /watch endpoints
│   │   │   ├── recommendations.py  # /recommendations endpoints
│   │   │   ├── tv.py                # /tv endpoints
│   │   │   ├── person.py            # /person endpoints
│   │   │   ├── clicks.py            # /clicks endpoints
│   │   │   └── users.py             # /users endpoints
│   │   ├── services/
│   │   │   ├── auth_service.py      # Auth business logic
│   │   │   ├── recommendation_service.py
│   │   │   ├── advanced_recs.py     # Multi-factor recommendation pipeline
│   │   │   ├── rating_service.py    # Rating CRUD logic
│   │   │   ├── watch_service.py     # Watch/watchlist logic
│   │   │   ├── search_service.py    # FTS + TMDB search
│   │   │   ├── tmdb_service.py      # TMDB API client
│   │   │   ├── click_service.py     # Click tracking
│   │   │   └── analysis_service.py  # User analytics
│   │   ├── db/
│   │   │   └── database.py          # SQLAlchemy async session factory
│   │   ├── repositories/            # Pure DB access layer
│   │   ├── schemas/                 # Pydantic request/response models
│   │   ├── utils/
│   │   │   ├── jwt_utils.py         # Token creation + validation
│   │   │   ├── password_utils.py    # bcrypt helpers
│   │   │   └── deps.py              # FastAPI dependencies (get_current_user)
│   │   └── tasks/                   # Celery background tasks
│   ├── alembic/                     # Database migration files
│   ├── params.yaml                  # FedPCL hyperparameters
│   ├── definitions.yaml             # System-wide config definitions
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Routes + ProtectedRoute
│   │   ├── main.jsx                 # React entry point
│   │   ├── index.css                # Global design system / CSS variables
│   │   ├── pages/
│   │   │   ├── Home.jsx             # Landing + recommendation rows
│   │   │   ├── MovieDetail.jsx      # Movie detail + RatingMeter
│   │   │   ├── MovieList.jsx        # Browse grid with filters
│   │   │   ├── Search.jsx           # Search results page
│   │   │   ├── Login.jsx            # Auth page
│   │   │   ├── Register.jsx         # Registration page
│   │   │   ├── Dashboard.jsx        # User dashboard (protected)
│   │   │   ├── Explore.jsx          # Discovery page
│   │   │   ├── Analysis.jsx         # User analytics
│   │   │   ├── TVDetail.jsx         # TV show detail
│   │   │   └── PersonPage.jsx       # Actor/director page
│   │   ├── components/
│   │   │   ├── Navbar.jsx           # Global navigation
│   │   │   ├── SearchBar.jsx        # Debounced autocomplete search
│   │   │   ├── MovieCard.jsx        # Glassmorphic movie card
│   │   │   ├── RatingMeter.jsx      # SVG category rating gauge
│   │   │   ├── Aurora.jsx           # WebGL aurora background
│   │   │   ├── BorderGlow.jsx       # Animated border effect
│   │   │   ├── CastCrew.jsx         # Cast display
│   │   │   └── ProtectedRoute.jsx   # Auth guard HOC
│   │   ├── context/
│   │   │   └── AuthContext.jsx      # Global auth state
│   │   ├── services/                # API call functions
│   │   └── utils/
│   │       └── api.js               # Axios instance + JWT interceptors
│   ├── vercel.json                  # SPA rewrite config for Vercel
│   └── package.json
│
├── fedpcl/                          # FedPCL research code (standalone)
├── fedgnn/                          # FedGNN experiments
├── plans/                           # Architecture and design documentation
│   ├── system_architecture.md
│   ├── final_workflow.md
│   ├── fedpcl_system_implemented.md
│   ├── implementation_plan.md
│   ├── database_system.md
│   ├── mlops.md
│   ├── improvements.md
│   └── ...
└── README.md
```

---

## 📊 Evaluation Metrics

### Recommendation Quality

| Metric | Formula | Target |
|--------|---------|--------|
| **HR@10** | % of test users where held-out movie appears in top-10 | ≥ 60% |
| **NDCG@10** | Discounted Cumulative Gain at rank 10 (ranking quality) | ≥ 40% |

**Evaluation protocol:** Leave-one-out. Train on all interactions except most recent. Test: rank held-out movie against 100 random negatives. Hit if held-out movie in top 10 of 101.

### Business Metrics

| Metric | Target |
|--------|--------|
| Click-through rate on recommendations | ≥ 8% |
| Watch completion from recommendation | ≥ 30% |
| Avg session length (users who saw recs) | ≥ 15 min |
| Discovery rate (recs outside preferred genres) | 10–20% |

---

## 📚 Documentation

All detailed system design documents live in the [`plans/`](./plans/) directory:

| Document | Contents |
|----------|----------|
| [`system_architecture.md`](./plans/system_architecture.md) | Full architecture diagram, component responsibilities |
| [`final_workflow.md`](./plans/final_workflow.md) | End-to-end user journey workflows (signup, search, rate, recommend) |
| [`fedpcl_system_implemented.md`](./plans/fedpcl_system_implemented.md) | Complete FedPCL deep implementation guide |
| [`implementation_plan.md`](./plans/implementation_plan.md) | Phase-by-phase build roadmap (Phases 3.1–3.5C) |
| [`database_system.md`](./plans/database_system.md) | All tables, relationships, indexes, migration strategy |
| [`mlops.md`](./plans/mlops.md) | ML lifecycle, MLflow setup, ETL pipelines, CI/CD for ML |
| [`improvements.md`](./plans/improvements.md) | Advanced recommendation engine design (40-item pipeline) |
| [`auth_system.md`](./plans/auth_system.md) | JWT, bcrypt, security design |
| [`search_system.md`](./plans/search_system.md) | FTS + autocomplete architecture |
| [`scalability_and_future.md`](./plans/scalability_and_future.md) | Scaling path, future roadmap |

---

## 🔮 Future Roadmap

- **FedPCL Live Integration** — wire federated model into `/recommendations` endpoint
- **Secure Aggregation** — cryptographic masking during gradient aggregation
- **Adaptive ε** — tighten LDP noise over time as model converges
- **On-Device Inference** — full recommendation scoring in browser after model download (zero server calls)
- **Cross-Session Continuity** — sync user embeddings across devices via encrypted backup
- **Asynchronous FedPCL** — remove round structure, submit whenever new data exists
- **Email OTP Verification** — Phase 4 auth improvement
- **Mobile App** — React Native client with same backend

---

## 📜 License

This project is a **Bachelor's Thesis Project (BTP)**. All code and research is for academic purposes.

---

*Built with ❤️ for our BTP — Federated Personalized Contrastive Learning for Movie Recommendations*
