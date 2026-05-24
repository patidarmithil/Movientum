# FedPCL System — Movientum Deep Implementation

**Paper Reference:** Wang et al., "Personalized Federated Contrastive Learning for Recommendation," IEEE TCSS Vol.12 No.5, Oct 2025

---

## Overview

FedPCL integrates into Movientum as the advanced, privacy-preserving recommendation engine. This document explains the complete system — from theory to how every component plugs into the Movientum platform.

Three problems FedPCL solves:

| Problem | Cause | FedPCL Solution |
|---------|-------|----------------|
| **Data sparsity** | Each user has tiny interaction graph (~20–100 movies) | Structural contrastive learning using 2-hop neighbours |
| **Non-IID data** | Users have wildly different tastes | K-means clustering + per-cluster item embedding models |
| **Privacy** | Gradients can leak interaction patterns | Local Differential Privacy (LDP) applied before upload |

---

## Core Concepts

### 1. User-Item Interaction Graph

Every user's movie interactions form a **bipartite graph**:

```
        USERS           ITEMS (Movies)
        
User A ────────────► Movie 1
User A ────────────► Movie 3
User B ────────────► Movie 2
User B ────────────► Movie 3
User C ────────────► Movie 1
User C ────────────► Movie 4
```

Edges = interactions (watched + rated). No edge weights needed — existence is signal.

In Movientum:
- Nodes: users (registered accounts) + movies (TMDB catalog)
- Edges: watch_history records + ratings records
- Graph is **locally stored** per user (only their own edges) — never assembled globally

### 2. High-Order Structural Relationships (2-Hop Neighbours)

**1-hop**: Movies a user has watched (direct interaction)
**2-hop**: Users who watched the SAME movies as this user (structural neighbours)

```
User A watched {Movie 1, Movie 3}
User C also watched {Movie 1}
→ User C is a 2-hop structural neighbour of User A

This means:
User A and User C have similar taste signal
User C's embedding informs User A's training
```

Why 2-hop matters: one user's tiny local graph alone is too sparse to train a good model. 2-hop neighbours provide **implicit collaborative signal** without sharing raw data.

### 3. GNN-Based Embedding Generation (LightGCN)

Movientum uses **LightGCN** (Simplified Graph Convolution) as the GNN backbone.

Standard GCN does message passing:
```
e_u^(l+1) = AGGREGATE(e_u^(l), {e_i^(l) for i in user's movies})
e_i^(l+1) = AGGREGATE(e_i^(l), {e_u^(l) for u who interacted with i})
```

LightGCN simplifies: no weight matrices, no activation functions. Just weighted mean:

**Layer 0** (Initialization):
- `e_u^(0)` = randomly initialized user embedding (dim=64)
- `E_i^(0)` = item embedding from global/cluster model (dim=64)

**Layer 1** (1-hop aggregation):
```
e_u^(1) = (1/√|N_u|) × Σ E_i^(0)        for all i in user's movies
E_i^(1) = w_anchor[i] × e_u^(0) + Σ_{v shares item i} W_neigh[i,v] × e_v^(0)
```

**Layer 2** (2-hop aggregation):
```
e_u^(2) = (1/√|N_u|) × Σ E_i^(1)
E_i^(2) = same propagation with layer-1 outputs
```

**Final user representation** = mean of all layers:
```
e_u_agg = (e_u^(0) + e_u^(1) + e_u^(2)) / 3
```

**Why even layers?** Even-layer aggregations naturally capture structurally similar users (2-hop neighbours) — used as self-supervised contrastive signal.

**Precomputed weights for speed:**
- `w_anchor[i]` = 1/sqrt(degree of item i in local graph)
- `W_neigh[i,v]` = 1/sqrt(degree(i) × degree(v in their local graph))
- These are computed ONCE at initialization, not re-computed each epoch

### 4. Contrastive Learning — Positive/Negative Pairs

After GNN propagation, contrastive learning enforces structural consistency.

**User Contrastive Loss (L_Con^U, Paper Eq.5):**

```
Query   = e_u^(L)  (even-layer aggregated anchor user embedding)
Positive = e_u^(0)  (layer-0 anchor user — "self" anchor)
Negatives = e_v^(0) for all 2-hop neighbours v

Loss = InfoNCE(Query, Positive, Negatives) / temperature τ

Intuition: The anchor user's even-layer embedding should be CLOSE to its own
layer-0 embedding (self-consistency) but FAR from structural neighbours
(preserve uniqueness despite sharing movies).
```

**Item Contrastive Loss (L_Con^V, Paper Eq.6):**

```
Query   = E_i^(L)  (even-layer item embeddings, shape [n_items, d])
Keys    = E_i^(0)  (layer-0 item embeddings, detached from computation graph)

Loss = CrossEntropy on (n×n) cosine similarity matrix
       Diagonal = correct self-pairs → maximize
       Off-diagonal = wrong pairs → minimize

Intuition: Each item's higher-layer representation should be closest to its own
layer-0 seed, not any other item.
```

**Total Loss:**
```
L_total = L_BPR + L_reg + β₁ × (L_Con^U + λ × L_Con^V)

Where:
  β₁ = 0.1  (contrastive weight)
  λ = 1.0   (item CL weight)
  τ = 0.2–0.3 (InfoNCE temperature)
```

Contrastive loss activates after **warmup_rounds=20** (allows BPR to first build stable base embeddings).

### 5. BPR Loss (Bayesian Personalized Ranking)

Core recommendation loss. Pair-wise ranking:

```
For each positive movie i the user watched:
  Sample one negative movie j (random, not watched)
  BPR loss = -log σ(score(u, i) - score(u, j))

Score = e_u_agg · E_personal[movie]

Intuition: push positive movie score above negative movie score.
```

### 6. Data Sparsity Handling

Problem: user watched only 15 movies. Too sparse to train well.

FedPCL solutions:
1. **2-hop neighbour expansion**: incorporate structural neighbours' embeddings into item propagation — effectively "borrows" signal from similar users' data without sharing it
2. **Leave-one-out evaluation**: train on all items except one held-out test item
3. **Negative sampling**: 1 negative per positive → augments sparse training signal
4. **Contrastive regularization**: prevents overfitting on sparse graphs by anchoring to layer-0 embeddings

### 7. Non-IID User Data Problem

Non-IID = Non-Independent and Identically Distributed.

Users have completely different preferences:
- User A: only watches action + sci-fi
- User B: only watches romance + drama
- User C: watches everything

If one global model is trained on all gradient updates averaged together → model becomes a "jack of all trades, master of none." It can't serve action fans OR romance fans well.

**FedPCL Solution: K-means Cluster-Level Models**

```
Server maintains K=5 item embedding tables:
  E_cluster[0] → optimized for cluster 0 (e.g., action/thriller fans)
  E_cluster[1] → optimized for cluster 1 (e.g., drama/romance fans)
  E_cluster[2] → optimized for cluster 2 (e.g., arthouse/indie fans)
  E_cluster[3] → optimized for cluster 3 (e.g., sci-fi/horror fans)
  E_cluster[4] → optimized for cluster 4 (e.g., mixed/casual watchers)

Plus one global model E_global (broad signal for all users)
```

Personalized item table for each user:
```
E_personal = μ₁ × E_cluster[k] + μ₂ × E_global
             (default: μ₁ = μ₂ = 0.5)
```

This blends cluster-specific preferences with global collaborative signal.

### 8. K-means Clustering Logic

Every `cluster_every=10` rounds, server runs K-means on all user embeddings:

```
Input: user embedding vectors {e_u : all users}  shape = [n_users, 64]
Algorithm: K-means (sklearn, K=5, CPU numpy)
Output: cluster assignment {user_id: cluster_id}
```

Privacy note: user embeddings uploaded to server are **LDP-noised** — not raw. Clustering runs on noisy embeddings (sufficient for cluster assignment, not sufficient to reconstruct real preferences).

---

## System Components

### Client Side (User's Browser / Device)

Each Movientum user = one federated client.

**What client stores locally (browser localStorage or IndexedDB):**
- `user_emb`: [64-dim float array] — private user embedding
- `train_items`: list of movie IDs user has interacted with
- `local_model_state`: current local model weights

**What client receives from server each round:**
- `E_personal`: personalized item embedding table (cluster blend)
- `neigh_embs`: dict of 2-hop neighbour embeddings (for contrastive loss)
- Training config: lr, epochs, beta, tau, sigma, lambda

**Local Training Loop (per round):**

```
1. Receive E_personal from server
2. Initialize local item embeddings from E_personal
3. Get neighbour embeddings neigh_embs from server

4. For each local epoch (E=10):
   a. Sample negative items (1 per positive)
   b. Run LightGCN on expanded subgraph:
      - Anchor user e_u^(0)
      - Positive items from train_items
      - Neighbour users' embeddings (neigh_embs)
   c. Compute e_u_agg (mean of 2 LightGCN layers)
   d. Compute BPR loss (ranking loss)
   e. If round > warmup=20: compute contrastive loss
   f. Total loss = BPR + reg + β₁ × (L_Con^U + λ × L_Con^V)
   g. Backward pass:
      - Items: SGD update (lr_item=0.1)
      - User: Adam update (lr_user=0.001)

5. Compute item deltas:
   item_deltas[i] = E_local[i] - E_personal[i]   (for all items user interacted with)

6. Apply Local Differential Privacy:
   item_deltas_noisy = clip(item_deltas, σ=0.1) + Laplace(0, λ=0.001)
   user_emb_noisy = clip(user_emb, σ=0.1) + Laplace(0, λ=0.001)

7. Send to server:
   → item_deltas_noisy  (sparse: only for items in train_items)
   → user_emb_noisy     (for cluster reassignment)
   → m_u = len(train_items)  (dataset size, for weighted aggregation)

RAW DATA NEVER LEAVES CLIENT.
```

### Server Side (Movientum Backend — FedPCL Module)

**What server stores:**
- `E_global`: [n_movies × 64] — global item embedding table
- `E_clusters[k]`: K × [n_movies × 64] — one per cluster
- `user_assignments`: {user_id: cluster_id} — current cluster assignments
- `user_embs_noisy`: {user_id: [64]} — latest (noisy) user embeddings for K-means
- `item2users`: {movie_id: [user_ids]} — inverted index for finding 2-hop neighbours

**Server operations per round:**

```
1. SELECT K=128 eligible clients

2. For each selected client u:
   a. Compute E_personal[u]:
      k = user_assignments[u]
      E_personal = μ₁ × E_clusters[k] + μ₂ × E_global
   
   b. Find 2-hop neighbours of u:
      shared_movies = train_items[u]
      neigh_users = item2users[shared_movies]  (all users sharing any movie with u)
      neigh_embs = {v: user_embs_noisy[v] for v in neigh_users}
   
   c. Send {E_personal, neigh_embs, config} to client u
   d. Receive {item_deltas_noisy, user_emb_noisy, m_u} from client u

3. Aggregate — Global update (FedAvg weighted by dataset size):
   For each movie i:
     E_global[i] += Σ_clients (m_u × delta_u[i]) / Σ m_u

4. Aggregate — Cluster update (only from clients in cluster k):
   For each cluster k:
     For each movie i:
       E_clusters[k][i] += Σ_{u in cluster k} (m_u × delta_u[i]) / Σ m_u

5. Store user_emb_noisy for each client
   (Used for K-means in step 6)

6. Every 10 rounds: Re-run K-means
   All user embeddings → sklearn KMeans(n_clusters=5)
   Update user_assignments dict
```

---

## Personalization: How Each User Gets Their Custom Model

Full personalization chain:

```
USER BEHAVIOR (Movientum DB)
  → watch_history + ratings
  → train_items list for this user
  
CLUSTER ASSIGNMENT
  → user_emb (64-dim) uploaded (with LDP noise)
  → K-means assigns user to cluster k
  → cluster k = group of users with similar taste profile
  
CLUSTER MODEL (E_cluster[k])
  → trained by aggregating gradients from ALL users in cluster k
  → represents "taste archetype" of cluster
  
GLOBAL MODEL (E_global)
  → trained by aggregating gradients from ALL users
  → represents broad collaborative signal

PERSONALIZED EMBEDDING TABLE
  E_personal = 0.5 × E_cluster[k] + 0.5 × E_global
  
LOCAL USER EMBEDDING (e_u)
  → private, only on client, never shared raw
  → updated each round via Adam optimizer
  → represents this specific user's taste vector

RECOMMENDATION SCORING
  score(movie j) = e_u_agg · E_personal[j]
  → user embedding dot product with personalized movie embedding
  → sort movies by score → top-N = recommendations
```

---

## Local Differential Privacy (LDP)

Applied client-side BEFORE any data leaves the device.

**Mechanism:**
```
1. Clip gradients to bound sensitivity:
   g_clipped = clamp(g, -σ, σ)   (σ = clip_sigma = 0.1)

2. Add Laplacian noise:
   g_private = g_clipped + Laplace(0, λ)   (λ = lambda_laplace = 0.001)

Privacy budget: ε = σ/λ = 0.1/0.001 = 100
```

**Trade-off table:**

| ε (epsilon) | Privacy | Accuracy |
|-------------|---------|----------|
| 100 (default) | Loose but fast to converge | High (≈non-private) |
| 10 | Moderate | Slight drop |
| 1 | Strong | Noticeable drop |
| 0.1 | Very strong | Significant drop |

Start with ε=100, tighten as platform matures and compliance requires.

---

## Training Round Lifecycle (Full Movientum Flow)

```
Round N starts (bi-weekly cron trigger):
  │
  ├── Server: SELECT 128 eligible users from users table
  │     Eligible = is_active=True AND len(watch_history) ≥ 10
  │
  ├── Server: For each selected user:
  │     ├── Compute E_personal (cluster blend)
  │     ├── Fetch neigh_embs (2-hop neighbours)
  │     └── Package: {E_personal, neigh_embs, hyperparams}
  │           → POST to /api/fedpcl/round/dispatch/{user_id}
  │
  ├── Client (user's browser — triggers on next active session or background):
  │     ├── Load local data from localStorage:
  │     │     train_items = [movie_ids from local watch cache]
  │     ├── Run 10 local epochs (LightGCN + BPR + CL)
  │     ├── Compute deltas
  │     ├── Apply LDP noise
  │     └── POST /api/fedpcl/update:
  │           {item_deltas_noisy, user_emb_noisy, m_u, round_id}
  │
  ├── Server: Collect updates (window: 3 days)
  │     ├── FedAvg aggregate → E_global updated
  │     ├── Cluster FedAvg → E_clusters[k] updated
  │     ├── Store user_emb_noisy
  │     └── Every 10 rounds: K-means recluster
  │
  ├── Server: Validate new model
  │     → Run evaluation on held-out test set (small public validation set)
  │     → Compare HR@10, NDCG@10 vs previous round
  │     → If degraded > 5%: rollback to previous E_global
  │
  └── Round N complete. Improved E_global + E_clusters deployed.
        All users' next recommendation request uses updated model.
```

---

## Movientum Integration: Where Data Comes From

### Data Sources for FedPCL Training

| Source Table | Data Used | Purpose |
|-------------|-----------|---------|
| `watch_history` | `(user_id, movie_id)` pairs | Primary interaction edges for user-item graph |
| `ratings` | `(user_id, movie_id, overall_score)` | Weighted interactions (score ≥ 6 = strong positive) |
| `watchlist` | `(user_id, movie_id)` | Weak positive signal |

**Data threshold for eligibility:** User must have ≥ 10 interactions total (watch + rate).

### When Training Triggers

| Trigger | Action |
|---------|--------|
| User rates a movie | Store interaction locally, flag for next round |
| User marks watched | Store interaction locally, flag for next round |
| Bi-weekly cron (server) | Start new training round, select eligible clients |
| User reaches 10 interactions | Auto-enroll in next round |
| Admin manual trigger | Force immediate round start |

### Local Data Storage (Client-Side)

What stored in browser IndexedDB:
```
fedpcl_data = {
  user_emb: Float32Array(64),          // private user embedding
  train_items: [123, 456, 789, ...],   // movie IDs interacted with
  last_round_id: "round_042",          // to avoid double-submission
  model_version: "v1.8"               // current global model version
}
```

### Embedding Storage (Server-Side)

Server stores in PostgreSQL:
```
fedpcl_models table:
  version   TEXT          -- "v1.8"
  E_global  BYTEA         -- serialized numpy array (n_movies × 64 × 4 bytes)
  created_at TIMESTAMPTZ
  hr10      FLOAT         -- validation HR@10
  ndcg10    FLOAT         -- validation NDCG@10

fedpcl_clusters table:
  version    TEXT
  cluster_id INTEGER
  E_cluster  BYTEA        -- one per cluster

user_cluster_assignments:
  user_id    UUID
  cluster_id INTEGER
  updated_at TIMESTAMPTZ
```

**Size estimate:**
- E_global for 100k movies, dim=64: 100,000 × 64 × 4 bytes = **25.6 MB**
- 5 cluster embeddings: 5 × 25.6 MB = **128 MB**
- Keep last 3 versions: ~500 MB total for model storage

---

## Model Hyperparameters (Movientum Defaults)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `embed_dim` d | 64 | Balance quality vs storage/compute |
| `n_gnn_layers` | 2 | 2-hop = sufficient for collaborative signal |
| `n_rounds` T | 400 | Paper default; convergence by ~200 rounds |
| `clients_per_round` N | 128 | Paper default; adjust by user base size |
| `local_epochs` E | 10 | Enough local steps without divergence |
| `n_clusters` K | 5 | Paper default; tune for user diversity |
| `mu1, mu2` | 0.5, 0.5 | Equal blend cluster + global |
| `cluster_every` | 10 | Re-cluster every 10 rounds |
| `warmup_rounds` | 20 | Let BPR stabilize before CL activates |
| `beta1` β₁ | 0.1 | Contrastive loss weight |
| `lam` λ | 1.0 | Item CL weight |
| `tau` τ | 0.2 | InfoNCE temperature |
| `lr_item` | 0.1 | Item embedding SGD |
| `lr_user` | 0.001 | User embedding Adam |
| `clip_sigma` σ | 0.1 | LDP clip bound |
| `lambda_laplace` | 0.001 | LDP noise scale |
| `epsilon` ε | 100 | Privacy budget |

---

## Evaluation Metrics

| Metric | Formula | Meaning |
|--------|---------|---------|
| HR@10 | % of test users where test movie in top-10 | Hit rate |
| NDCG@10 | Discounted cumulative gain at 10 | Ranking quality |

**Leave-one-out evaluation:**
- Train on all interactions except most recent
- Test: rank held-out movie against 100 random negatives
- If held-out movie in top 10 of 101 → HR@10 hit

**Paper results (benchmark):**

| Dataset | HR@10 | NDCG@10 |
|---------|-------|---------|
| Steam | 80.36% | 65.55% |
| ML-100K | 63.81% | 45.03% |
| ML-1M | 62.86% | 44.12% |
| Amazon | 34.04% | 22.93% |

Movientum targets HR@10 ≥ 60% by end of first 400 rounds.

---

## FedPCL vs Alternative Systems

| Aspect | Centralized CF | FedAvg | FedPCL (Movientum) |
|--------|---------------|--------|-------------------|
| Privacy | None | Partial | Strong (LDP) |
| Personalization | Good | Poor (non-IID problem) | Strong (cluster models) |
| Data sparsity handling | Poor | Poor | Strong (2-hop CL) |
| Communication cost | Low | Medium | Medium (sparse deltas only) |
| Compliance (GDPR) | Difficult | Moderate | Easiest |
| Accuracy | Highest | Lower | Near-centralized |

---

## Future Enhancements

- **Secure Aggregation**: Cryptographic masking so server can't inspect individual gradients even during aggregation
- **Adaptive ε**: Tighten LDP noise over time as model converges (more accuracy early, more privacy later)
- **Cross-Session Continuity**: Sync user_emb across user's devices via encrypted cloud backup
- **On-Device Inference**: Full recommendation inference in browser after model download — zero server calls
- **Asynchronous FedPCL**: Remove round structure — clients submit whenever they have new data
- **More Clusters**: K=10 or K=20 for platforms with diverse international audience
