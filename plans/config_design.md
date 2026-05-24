# Configuration Design — params.yaml & definitions.yaml

## Overview

Movientum separates **runtime configuration** (params.yaml) from **system constants** (definitions.yaml). This pattern is adopted directly from ML pipeline tooling (Kubeflow Pipelines, DVC, MLflow Projects) where config-as-code enables reproducible, parameterizable experiments.

---

## params.yaml — All Tunable Parameters

`params.yaml` holds every value that might change between environments, experiments, or training runs. No hardcoded magic numbers in code — always read from here.

### Structure and All Fields

```yaml
# ============================================================
# params.yaml — Movientum Runtime Configuration
# ============================================================

# ─── Database ────────────────────────────────────────────────
database:
  pool_size: 10            # SQLAlchemy connection pool size
  max_overflow: 20         # Extra connections beyond pool_size
  pool_timeout: 30         # Seconds to wait for connection
  pool_recycle: 1800       # Recycle connections every 30 min
  echo: false              # Log all SQL (true in development only)

# ─── Redis / Caching ─────────────────────────────────────────
cache:
  movie_detail_ttl: 3600          # 1 hour
  trending_ttl: 1800              # 30 minutes
  search_results_ttl: 600         # 10 minutes
  autocomplete_ttl: 300           # 5 minutes
  user_recommendations_ttl: 900   # 15 minutes
  genre_list_ttl: 86400           # 24 hours (very stable)
  news_feed_ttl: 7200             # 2 hours
  movie_news_ttl: 21600           # 6 hours
  fedpcl_model_ttl: 86400         # 24 hours (models change slowly)

# ─── Authentication ──────────────────────────────────────────
auth:
  jwt_algorithm: "HS256"
  access_token_expiry_minutes: 60
  refresh_token_expiry_days: 30
  remember_me_expiry_days: 90
  bcrypt_rounds: 12
  rate_limit_login_attempts: 5       # Per 15 minutes per IP
  rate_limit_login_window_seconds: 900
  rate_limit_register_per_hour: 10

# ─── External APIs ───────────────────────────────────────────
external_apis:
  tmdb:
    base_url: "https://api.themoviedb.org/3"
    image_base_url: "https://image.tmdb.org/t/p"
    requests_per_10s: 40           # TMDB rate limit
    retry_max_attempts: 3
    retry_backoff_seconds: 2       # Doubles per attempt
    timeout_seconds: 10

  news_api:
    base_url: "https://newsapi.org/v2"
    requests_per_day: 100          # Free tier limit
    page_size: 50
    max_article_age_hours: 48
    fetch_interval_minutes: 120    # Fetch every 2 hours

# ─── Search ──────────────────────────────────────────────────
search:
  autocomplete_min_chars: 2
  autocomplete_max_results: 8
  debounce_ms: 300                 # Frontend debounce (documented here)
  full_search_db_threshold: 5      # Min local results before TMDB fallback
  relevance_weight: 0.50
  popularity_weight: 0.30
  rating_weight: 0.20
  max_results_per_page: 20

# ─── Recommendations (Rule-Based Phase 1) ────────────────────
recommendations:
  genre_affinity_weight: 0.40
  director_affinity_weight: 0.20
  similar_rated_weight: 0.20
  trending_weight: 0.20
  min_rating_for_affinity: 6.0    # Ratings below this not counted as positive
  max_results: 20
  exploration_budget: 0.10        # 10% random genre exploration
  recency_bonus_days: 180         # Movies < 6 months old get boost
  recency_bonus_factor: 1.10      # 10% score boost

# ─── FedPCL Hyperparameters ──────────────────────────────────
fedpcl:
  embed_dim: 64
  n_gnn_layers: 2
  n_rounds: 400
  clients_per_round: 128
  local_epochs: 10
  n_clusters: 5
  mu1: 0.5                        # Cluster model blend weight
  mu2: 0.5                        # Global model blend weight
  cluster_every: 10               # Re-run K-means every N rounds
  warmup_rounds: 20               # Rounds before contrastive loss activates
  beta1: 0.1                      # Contrastive loss weight
  lam: 1.0                        # Item contrastive loss weight
  tau: 0.2                        # InfoNCE temperature
  lr_item: 0.1                    # Item embedding SGD learning rate
  lr_user: 0.001                  # User embedding Adam learning rate
  clip_sigma: 0.1                 # LDP clip bound
  lambda_laplace: 0.001           # LDP Laplace noise scale
  epsilon: 100.0                  # Privacy budget (sigma/lambda)
  min_interactions_to_participate: 10  # Min watch/rate events for eligibility
  client_collection_window_days: 3     # Days to wait for client updates
  retrain_interval_days: 14            # Bi-weekly retraining cycle
  model_keep_versions: 3               # Keep last N model versions

# ─── Model Validation Thresholds ─────────────────────────────
model_validation:
  min_hr10: 0.60
  min_ndcg10: 0.40
  max_regression_vs_prod: 0.02    # New model allowed to be 2% worse
  shadow_test_traffic_fraction: 0.10   # 10% shadow traffic for A/B
  shadow_test_duration_hours: 24
  auto_rollback_engagement_drop: 0.10  # Rollback if CTR drops 10%

# ─── Data Ingestion (TMDB Sync) ──────────────────────────────
data_ingestion:
  initial_seed_popular_pages: 25      # 25 pages × 20 = 500 popular movies
  initial_seed_top_rated_pages: 25
  daily_sync_enabled: true
  daily_sync_cron: "0 3 * * *"        # 3 AM daily
  weekly_sync_cron: "0 2 * * 0"       # 2 AM Sunday
  stale_threshold_hours: 24           # Re-fetch if fetched_at > 24h ago
  request_delay_seconds: 0.25         # 4 req/s (well within 40 req/10s limit)

# ─── Pagination ──────────────────────────────────────────────
pagination:
  default_page_size: 20
  max_page_size: 100
  autocomplete_limit: 8

# ─── Background Tasks (Celery) ───────────────────────────────
celery:
  news_fetch_cron: "0 */2 * * *"       # Every 2 hours
  recommendation_cache_ttl_after_rate: 0  # Invalidate immediately
  task_retry_max: 3
  task_retry_delay_seconds: 60
```

---

## definitions.yaml — System Constants

`definitions.yaml` holds fixed domain definitions that rarely/never change. These define the **business vocabulary** of Movientum.

### Structure and All Fields

```yaml
# ============================================================
# definitions.yaml — Movientum System Constants & Definitions
# ============================================================

# ─── Rating Categories ───────────────────────────────────────
rating_categories:
  - key: "story"
    label: "Story & Writing"
    description: "Plot quality, script, narrative structure"
    weight: 0.25           # Weight in computed composite score
    optional: true

  - key: "acting"
    label: "Acting & Performance"
    description: "Quality of cast performances"
    weight: 0.20
    optional: true

  - key: "direction"
    label: "Direction"
    description: "Filmmaker's vision and execution"
    weight: 0.20
    optional: true

  - key: "visuals"
    label: "Visuals & Cinematography"
    description: "Camera work, VFX, production design"
    weight: 0.15
    optional: true

  - key: "overall"
    label: "Overall Score"
    description: "Your overall impression of the film"
    weight: 1.0            # Required field
    optional: false

rating_scale:
  min: 0.0
  max: 10.0
  step: 0.5               # Rating increments (0.5 steps)
  positive_threshold: 6.0  # Scores ≥ 6.0 = positive signal for recommendations
  negative_threshold: 4.0  # Scores < 4.0 = negative signal

# ─── User Roles ──────────────────────────────────────────────
user_roles:
  - role: "user"
    permissions:
      - "browse_movies"
      - "search"
      - "rate_movies"
      - "manage_own_watchlist"
      - "view_own_dashboard"
      - "participate_fedpcl"

  - role: "admin"
    permissions:
      - "*"               # All user permissions plus:
      - "manage_movies"
      - "manage_users"
      - "view_analytics"
      - "trigger_retraining"
      - "manage_news"

# ─── Recommendation Types ────────────────────────────────────
recommendation_types:
  - key: "personalized"
    label: "For You"
    description: "AI-personalized picks based on your taste"
    requires_auth: true

  - key: "trending"
    label: "Trending Now"
    description: "What everyone is watching this week"
    requires_auth: false

  - key: "similar"
    label: "Because You Watched X"
    description: "Movies similar to a specific title"
    requires_auth: false

  - key: "top_genre"
    label: "Top in [Genre]"
    description: "Highest rated in a specific genre"
    requires_auth: false

  - key: "hidden_gems"
    label: "Hidden Gems"
    description: "Critically loved, lesser-known films"
    requires_auth: false

  - key: "continue_watching"
    label: "Continue Watching"
    description: "Movies in your watchlist"
    requires_auth: true

# ─── Interaction Types ───────────────────────────────────────
interaction_types:
  - key: "watched"
    weight: 1.0
    label: "Marked as Watched"

  - key: "rated_positive"
    weight: 1.5
    label: "Rated ≥ 6.0"

  - key: "rated_negative"
    weight: -0.5
    label: "Rated < 5.0"

  - key: "watchlisted"
    weight: 0.5
    label: "Added to Watchlist"

  - key: "detail_viewed"
    weight: 0.3
    label: "Viewed Movie Detail Page"

# ─── FedPCL Client Eligibility ───────────────────────────────
fedpcl_eligibility:
  min_interactions: 10
  opted_in_required: true
  max_participation_frequency_days: 7    # Can't participate more than weekly
  excluded_roles: []                     # All roles eligible

# ─── Image Sizes ─────────────────────────────────────────────
image_sizes:
  poster:
    thumbnail: "w185"      # Watchlist, small cards
    card: "w342"           # MovieCard in grid
    detail: "w500"         # Movie Detail page
  backdrop:
    hero: "w1280"          # Home page hero banner
    banner: "w780"         # Movie Detail backdrop

# ─── Search Ranking Weights ──────────────────────────────────
# (Mirrors params.yaml but as semantic definitions)
search_weights:
  relevance: 0.50          # Full-text match score
  popularity: 0.30         # TMDB popularity
  rating: 0.20             # TMDB vote_average

# ─── News Sources (Whitelisted) ──────────────────────────────
news_source_tiers:
  tier1:
    - "variety.com"
    - "hollywoodreporter.com"
    - "deadline.com"
    - "indiewire.com"
  tier2:
    - "ign.com"
    - "collider.com"
    - "screenrant.com"
    - "cinemablend.com"

# ─── Movie Status Values ─────────────────────────────────────
movie_statuses:
  - "Released"
  - "In Production"
  - "Post Production"
  - "Planned"
  - "Rumored"
  - "Canceled"

# ─── Supported Languages ─────────────────────────────────────
supported_languages:
  - code: "en"
    label: "English"
  - code: "es"
    label: "Spanish"
  - code: "fr"
    label: "French"
  - code: "de"
    label: "German"
  - code: "ja"
    label: "Japanese"
  - code: "ko"
    label: "Korean"
```

---

## How These Configs Integrate with Kubeflow / ML Pipelines

### Kubeflow Pipelines Usage

Kubeflow Pipelines (KFP) orchestrates multi-step ML workflows. Each pipeline component reads its parameters from `params.yaml`.

**Pipeline structure:**
```
Movientum FedPCL Pipeline:
  Step 1: ETL Component
    Reads: database.pool_size, data_ingestion.*
    Outputs: versioned dataset artifact

  Step 2: Validate Data Component
    Reads: fedpcl.min_interactions_to_participate
    Outputs: validated dataset or FAIL

  Step 3: FedPCL Training Component
    Reads: fedpcl.* (all hyperparameters)
    Outputs: E_global, E_clusters, MLflow run_id

  Step 4: Evaluate Component
    Reads: model_validation.*
    Outputs: eval metrics, pass/fail decision

  Step 5: Deploy Component (conditional on Step 4 PASS)
    Reads: fedpcl.model_keep_versions
    Outputs: deployed model version
```

**Why YAML not hardcoded:** KFP pipeline runs can be parametrized from the CLI:
```bash
kfp run submit --pipeline fedpcl_pipeline \
  --param fedpcl.n_clusters=7 \
  --param fedpcl.embed_dim=128
```

Different experiment runs → different parameter values → fully tracked in MLflow. Same pipeline code, different configs = reproducible experiments.

### DVC (Data Version Control) Integration

`params.yaml` is the **DVC params file**:
```bash
dvc params diff          # Shows what params changed between runs
dvc run -n train_fedpcl  # Tracks params.yaml as dependency
```

DVC hashes `params.yaml` and dataset version together → run is reproducible and cacheable.

### Why Separate params.yaml from definitions.yaml

| | params.yaml | definitions.yaml |
|--|-------------|-----------------|
| **Changes** | Frequently (tuning, A/B tests) | Rarely (business logic stable) |
| **Who changes it** | ML engineers, DevOps | Product/architecture team |
| **Tracked by** | DVC + MLflow (every run) | Git only (version controlled) |
| **In Kubeflow** | Pipeline input parameters | Shared constants (baked into image) |
| **Example content** | `lr_item: 0.1` | `rating_scale.max: 10.0` |
