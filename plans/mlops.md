# MLOps — Movientum ML Lifecycle

## Overview

MLOps = ML + DevOps. Covers how ML models in Movientum are built, tracked, versioned, validated, deployed, and monitored. Two ML systems need MLOps: the **offline collaborative filtering** baseline and the **FedPCL federated recommendation** system. Both follow the same pipeline structure with different training mechanics.

---

## Experiment Tracking with MLflow

Every training run — whether a baseline model test or a FedPCL round — is tracked in MLflow.

### What MLflow Tracks

**Parameters** (what you configured before training):
```
embed_dim: 64
n_rounds: 400
clients_per_round: 128
local_epochs: 10
n_clusters: 5
mu1: 0.5
mu2: 0.5
beta1: 0.1
tau: 0.2
lr_item: 0.1
lr_user: 0.001
clip_sigma: 0.1
lambda_laplace: 0.001
dataset: "movientum_users"
warmup_rounds: 20
```

**Metrics** (what changed during training, logged per round):
```
round: 1, 2, ..., 400
train_loss_bpr: 2.31, 1.45, ...
train_loss_cl: 0.00, 0.00, ..., 0.45, 0.41, ...  (starts at warmup=20)
train_loss_total: 2.31, 1.45, ...
eval_hr10: 0.01, 0.12, ..., 0.62
eval_ndcg10: 0.01, 0.09, ..., 0.44
n_clients_participated: 128, 121, 130, ...  (varies by eligibility)
avg_items_per_client: 24.3
```

**Artifacts** (files saved per run):
```
E_global_round0001.npy     → item embeddings at round 1
E_global_round0100.npy     → item embeddings at round 100
E_global_final.npy         → final trained item embeddings
cluster_assignments.json   → {user_id: cluster_id} at final round
training_config.yaml       → full hyperparameter snapshot
eval_results.json          → HR@10 and NDCG@10 per round
```

### MLflow Experiment Structure

```
MLflow Experiments:
  ├── fedpcl-baseline        → initial random model tests
  ├── fedpcl-stage3          → FedAvg + clustering, no contrastive
  ├── fedpcl-stage4          → clustering + contrastive, no LDP
  ├── fedpcl-stage5          → full FedPCL (clustering + CL + LDP)
  └── fedpcl-production      → live system experiments

Each experiment has multiple Runs:
  Run 1: embed_dim=32, K=3
  Run 2: embed_dim=64, K=5  ← best result, promoted to production
  Run 3: embed_dim=128, K=7
```

### MLflow Server Deployment

MLflow tracking server runs as separate service:
- `http://mlflow.internal:5000` (internal, not exposed to users)
- Backend store: PostgreSQL (reuses Movientum DB, separate schema)
- Artifact store: local filesystem or S3 bucket
- Auth: basic auth or IP-restricted (internal only)

---

## CI/CD for ML

### Model Versioning

Every model version gets a version string: `v{major}.{minor}` (e.g., `v1.8`)

Version bumps:
- **Minor** (`v1.7 → v1.8`): new training round completed, no architecture change
- **Major** (`v1.x → v2.0`): architecture change (new GNN layers, new cluster count, etc.)

Model registry (MLflow Model Registry):
```
Stages:
  None      → experiment models (never deployed)
  Staging   → candidate for deployment, under evaluation
  Production → live model serving recommendations
  Archived  → older versions kept for rollback
```

Promotion flow:
```
Training run completes
  → Model registered in MLflow (stage: None)
  → Automated validation runs (see Validation section)
  → If validation passes → promote to Staging
  → Manual review (optional for major versions)
  → Promote to Production
  → Previous Production → Archived
```

### Automated Retraining Pipeline

Retraining triggers:
1. **Scheduled**: bi-weekly cron (every 14 days)
2. **Drift triggered**: model performance drops below threshold (HR@10 < 0.50)
3. **Data triggered**: user base grows 20%+ since last training

Pipeline steps (automated, runs on backend server):
```
STEP 1: Data Extraction
  → Query PostgreSQL: SELECT user_id, movie_id, interaction_type
    FROM (watch_history UNION ratings) WHERE created_at > last_training_date
  → Merge with existing training data
  → Export to training format (JSON per user)

STEP 2: Data Validation
  → Check: minimum users (≥ 100 eligible)
  → Check: no duplicate interactions
  → Check: no null movie IDs
  → Check: data format schema valid
  → FAIL → alert DevOps, abort pipeline

STEP 3: Training
  → Load params from params.yaml
  → Initialize FedPCL server with current E_global as warmstart
  → Run N_rounds=400 federated training rounds
  → Log all metrics to MLflow

STEP 4: Evaluation
  → Run eval on held-out validation set
  → Compare vs current Production model
  → Compute: HR@10, NDCG@10, delta vs production

STEP 5: Validation Gate
  → HR@10 >= 0.60? AND NDCG@10 >= 0.40? AND delta >= -0.02?
  → PASS → register model, promote to Staging
  → FAIL → alert ML team, keep current Production, log failure reason

STEP 6: Deployment
  → Load new E_global and E_clusters from MLflow artifacts
  → Update fedpcl_models table in PostgreSQL
  → Clear recommendation caches (Redis flush for user:recommendations:*)
  → Log deployment event

STEP 7: Post-deployment monitoring (24h)
  → Track real-world CTR and engagement
  → Auto-rollback if engagement drops > 10%
```

### Model Validation Before Deployment

Two layers of validation:

**Offline Validation** (automated):
```
Test set: 10% of users held out (never used in training)
Metrics:
  HR@10 ≥ 0.60          (hit rate threshold)
  NDCG@10 ≥ 0.40        (ranking quality threshold)
  Delta vs Production ≥ -0.02  (not allowed to regress > 2%)
  Loss not NaN           (training stability check)
  Embedding range valid  (no exploding gradients: |E_global| < 10)
```

**Shadow Testing** (before full production):
```
For 24h: route 10% of recommendation requests to new model
Track:
  Click-through rate (CTR) vs 90% on old model
  Watch completion signals
  Session length
Decision: if shadow CTR within 5% of control → full promotion
```

---

## ETL Pipelines

### Overview

ETL = Extract, Transform, Load. Runs before every training cycle to prepare clean training data.

### Step 1: Data Extraction

Extract from Movientum PostgreSQL:

```
Source tables:
  watch_history    → (user_id, movie_id, watched_at)
  ratings          → (user_id, movie_id, overall_score, created_at)
  watchlist        → (user_id, movie_id, added_at)  ← weak signal

Merge logic:
  All watched movies → positive interaction, weight=1.0
  Rated ≥ 6.0 movies → positive interaction, weight=1.5
  Rated < 5.0 movies → negative signal, weight=-0.5
  Watchlisted (not watched) → weak positive, weight=0.5

Group by user_id → {user_id: [(movie_id, weight), ...]}
Filter: users with ≥ 10 total interactions → eligible training set
```

### Step 2: Data Cleaning

```
Remove:
  Duplicate (user_id, movie_id) pairs → keep max weight
  Ghost movies (movie_id not in movies table)
  Inactive users (is_active=False)
  Bot accounts (> 500 interactions in < 24 hours)
  
Clamp:
  Interaction weights to [-1.0, 2.0]
  
Validate:
  All movie_ids exist in movies table
  All user_ids exist in users table
  No NULL values in user_id or movie_id
```

### Step 3: Feature Engineering

Transform raw interaction lists into GNN-ready structures:

```
User-Item Interaction Dict:
  train_dict = {uid: [iid1, iid2, ...]}

Item-User Inverted Index:
  item2users = {iid: [uid1, uid2, ...]}  ← for 2-hop neighbour lookup

Adjacency Degree Arrays:
  item_degree[iid] = number of users who interacted with item
  user_degree[uid] = number of items user interacted with

LightGCN Precomputed Weights:
  For each client uid:
    w_anchor[iid] = 1 / sqrt(item_degree[iid])
    W_neigh[iid][v] = 1 / sqrt(item_degree[iid] × user_degree[v])

These weights computed ONCE on server, shared with clients.
```

### Step 4: Data Versioning

Each ETL run produces a versioned dataset snapshot:
```
data/
  dataset_v1_2024-01-01.json    ← format: [{user_id, items: [...]}]
  dataset_v2_2024-03-15.json
  dataset_v3_2024-05-20.json    ← latest
```

Stored reference in MLflow as artifact for reproducibility.
Old datasets kept for:
- Retraining older model versions (debugging)
- Comparing data distributions over time
- Audit trail

Retention policy: keep last 5 dataset versions, archive older to cold storage.

---

## Training Pipeline Architecture

### Offline Training (Baseline Model — Phase 1/2)

Classical collaborative filtering, runs fully on server:

```
Server-side training (single machine):
  Input: full dataset (all users)
  Algorithm: Matrix Factorization (ALS or SGD)
  Output: user_factors [n_users × 64], item_factors [n_items × 64]
  Storage: saved to DB + MLflow

Duration: ~1–2 hours for 100k users × 50k movies
```

### Federated Training (FedPCL — Phase 3)

Distributed across user devices, coordinated by server:

```
Coordinator: FastAPI FedPCL Module
Clients: user browsers (TensorFlow.js) or background service
Communication: HTTPS REST API
Synchronization: round-based (all clients complete before aggregation)

Duration per round: 3 days (client training window)
Total rounds: 400 (bi-weekly = 1 round per 14 days = 15 years? → run in simulation for initial model)

Practical approach for initial model:
  Simulate FedPCL rounds server-side using historical data
  → Produces E_global + E_clusters quickly
  → Switch to live federated updates once deployed
```

---

## Model Serving

### Inference Architecture

```
User requests /api/recommendations
  │
  ├── Load user's cluster assignment from user_cluster_assignments table
  ├── Load E_global and E_cluster[k] from memory (in-process cache)
  │     → Loaded at startup, refreshed when new model deployed
  │
  ├── Compute E_personal = 0.5 × E_cluster[k] + 0.5 × E_global
  │
  ├── Load user_emb[u] from user_embeddings table (server-side user emb for serving)
  │
  ├── Compute scores:
  │     scores[i] = e_u · E_personal[i]  for all movies i
  │
  ├── Filter: remove already-watched movies
  ├── Sort: descending by score
  ├── Return: top 20 movie IDs
  │
  └── Cache result in Redis: user:recommendations:{user_id}  TTL=15min
```

### Memory Requirements for Serving

E_global for 100k movies × dim=64 × float32 = 25.6 MB in memory
5 cluster tables = 128 MB total
All embeddings fit comfortably in 512 MB RAM.

### Hot Reload Without Downtime

When new model deployed:
```
1. Load new E_global + E_clusters into secondary memory slot
2. Atomic swap: primary slot → secondary (instant)
3. Old model released from memory
4. Clear Redis recommendation caches
5. First user requests regenerate from new model
```

No server restart needed. No downtime.

---

## Monitoring: Model Drift and Performance

### Drift Detection

**Data Drift**: distribution of user interactions changes over time
```
Track monthly:
  Average interactions per user
  Genre distribution of new watches
  New user ratio (% users with < 30 days account age)
  
Alert if: genre distribution shifts > 15% from training distribution
Action: trigger early retraining
```

**Model Drift**: model predictions become stale / less accurate
```
Track weekly:
  HR@10 on rolling held-out test set (updated weekly with new data)
  
Alert if: HR@10 drops below 0.55 (from target 0.60+)
Action: immediate retraining pipeline trigger
```

**Embedding Drift**: model weights diverge unexpectedly
```
Track per round:
  L2 norm of E_global: should stay in stable range
  L2 norm of gradient updates: should decrease over rounds
  
Alert if: gradient norm > 10x previous round
Action: suspect training instability, investigate before next round
```

### Performance Tracking (Business Metrics)

Real-world metrics tracked via Movientum analytics:

| Metric | Definition | Target | Alert Threshold |
|--------|-----------|--------|----------------|
| CTR | Clicks on recommendation / recommendations shown | ≥ 8% | < 5% |
| Watch Completion | Movies started from rec / movies recommended | ≥ 30% | < 20% |
| Session Length | Avg minutes per session for users who saw recs | ≥ 15 min | < 10 min |
| Rec → Rating | % of recommended movies that get rated | ≥ 15% | < 8% |
| Discovery Rate | % recs for movies not in user's preferred genres | 10–20% | > 30% (filter bubble) |

### Monitoring Stack

```
Movientum Backend → emits metrics (Prometheus format)
  → Prometheus scrapes every 30 seconds
  → Grafana dashboards:
       ML Model Dashboard:
         - HR@10 over time
         - NDCG@10 over time
         - Training loss per round
         - Cluster distribution (users per cluster)
         - CTR, watch completion, session length
  → Alertmanager:
       - Alert on HR@10 < 0.55 → email + Slack to ML team
       - Alert on CTR < 5% → email to product team
       - Alert on gradient norm spike → email to ML team
```
