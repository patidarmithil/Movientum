# FedPCL — How It Works

**Paper:** Wang et al., "Personalized Federated Contrastive Learning for Recommendation," IEEE TCSS Vol.12 No.5, Oct 2025  
**Reference PDF:** `../reference/fedpcl_paper.pdf`

---

## Big Picture

FedPCL is a **federated recommendation system** where:
- Each **client** = one user. Their interaction data never leaves their device.
- A **server** coordinates training without ever seeing raw interaction data.
- Goal: recommend items to each user by training a personalized GNN collaboratively.

Three problems are solved:
1. **Data sparsity** — one user's local graph is tiny (~20-100 items). Solved by structural contrastive learning using 2-hop neighbours.
2. **Non-IID data** — users have wildly different preferences. Solved by K-means clustering + per-cluster models.
3. **Privacy** — gradients leak information. Solved by Local Differential Privacy (LDP).

---

## Implementation Stages

The code is built in 3 progressive stages. Each stage adds one component on top of the previous.

| Stage | What it adds | Entry point |
|-------|-------------|-------------|
| **3** | FedAvg + K-means clustering + personalized embeddings | `train_stage3.py` |
| **4** | Stage 3 + structural contrastive learning (no LDP) | `train_stage4.py` |
| **5** | Stage 4 + Local Differential Privacy | `train_stage5.py` ← **full FedPCL** |

---

## File-by-File Breakdown

```
fedpcl/
├── train_stage3.py        ← run this for Stage 3
├── train_stage4.py        ← run this for Stage 4
├── train_stage5.py        ← run this for full FedPCL (Stage 5)
│
├── core/                  ← all implementation logic
│   ├── data_loader.py
│   ├── contrastive.py
│   ├── server_stage3.py
│   ├── server_stage4.py
│   ├── server_stage5.py
│   ├── client_stage3.py
│   ├── client_stage4.py
│   ├── client_stage5.py
│   ├── federated_core_stage3.py
│   ├── federated_core_stage4.py
│   └── federated_core_stage5.py
│
├── utils/                 ← analysis and visualization
│   ├── show_results.py
│   ├── run_multiseed.py
│   ├── visualize_kde.py
│   └── plot_training_curves.py
│
├── data/                  ← datasets go here
│   ├── steam_processed.json
│   ├── amazon_processed.json
│   └── ratings.xlsx
│
└── results/               ← training outputs go here (auto-created)
    ├── stage5_log_steam.json
    ├── emb_steam_round0001.npy
    └── ...
```

---

## Data Flow (Stage 5 — Full FedPCL)

### Step 1: Data Loading (`core/data_loader.py`)

`load_dataset(dataset_name, data_path)` returns a `DataBundle` containing:
- `train_dict`: `{uid: [item_ids]}` — each user's interaction history
- `test_dict`: `{uid: item_id}` — one held-out item per user (leave-one-out)
- `neg_dict`: `{uid: [100 item_ids]}` — 100 random negatives per user for evaluation
- `n_users`, `n_items`, adjacency matrices, degree arrays

**Supported datasets:**
- `ml100k` → reads `u.data` (tab-separated: uid, iid, rating, timestamp)
- `ml1m` → reads `ratings.dat` (:: separated)
- `steam` → reads `steam_processed.json` (preprocessed JSON)
- `amazon` → reads `amazon_processed.json` (preprocessed JSON)

---

### Step 2: Server Initialization (`core/server_stage3.py`, `server_stage4.py`)

**ServerStage3** holds:
- `E_global`: `[n_items, d]` — global item embedding table, shared with all clients
- `E_clusters[k]`: `K` copies of `[n_items, d]` — one per cluster
- `assignments`: `{uid: cluster_id}` — which cluster each user belongs to

**ServerStage4** extends ServerStage3 with:
- `item2users`: inverted index `{item_id: [uid, ...]}` — used to find 2-hop neighbours
- `get_neighbours(uid)` → returns users who share items with `uid` (2-hop)
- `get_neigh_embs(uid, clients)` → returns current embeddings of those neighbours

**ServerStage5** = ServerStage4 (LDP is applied client-side, server unchanged)

---

### Step 3: Client Initialization (`core/client_stage4.py`)

Each client (`ClientStage4`) stores:
- `user_emb`: `[d]` — private user embedding (never sent raw, only noisy version)
- `train_items`: their interaction list
- `neighbour_users`: 2-hop neighbours (item lists, not raw interaction data)
- Precomputed LightGCN weights (`_w_anchor`, `_W_neigh`) — computed ONCE in `__init__`

**ClientStage5** extends ClientStage4: adds LDP noise before uploading.

---

### Step 4: Training Loop (`core/federated_core_stage5.py → train_stage5()`)

Each communication round:

```
1. Server selects 128 random clients (N=128, paper default)

2. For each selected client uid:
   a. Server computes: E_personal = μ1 * E_cluster[k] + μ2 * E_global
      (personalised item embedding table for this user)
   
   b. If CL is active (round > warmup=20):
      Server fetches neighbour embeddings: neigh_embs = {v: user_emb[v]}
   
   c. Client runs local_train():
      - Runs 10 local epochs of BPR + contrastive loss
      - Returns: item_deltas, avg_loss, user_emb

3. Stage 5 only: Client applies LDP before returning:
   delta_noisy = clip(delta, σ) + Laplace(0, λ)
   user_emb_noisy = clip(user_emb, σ) + Laplace(0, λ)

4. Server aggregates:
   E_global[i] += weighted_avg(all deltas for item i)
   E_clusters[k][i] += weighted_avg(cluster-k client deltas for item i)

5. Every 10 rounds: K-means on ALL user embeddings → update cluster assignments
```

---

### Step 5: Local Training — What Happens Inside a Client (`core/client_stage4.py`)

Each local epoch:

```python
# 1. Sample one negative item j per positive item (BPR)
neg_ids = [random item not in train_items]

# 2. Run expanded LightGCN on local subgraph (anchor user + 2-hop neighbours)
layers_u, layers_i, e_u_agg = _lightgcn_expanded(e_u, E_pos, neigh_e0, n_layers=2)
# e_u_agg = mean of all layer embeddings = final user representation

# 3. BPR loss (pair-wise ranking)
loss_bpr = -logsigmoid(score(u,pos) - score(u,neg)).mean()

# 4. Structural Contrastive Loss (paper Eq.7, after warmup round 20)
# User CL (Eq.5): even-layer user emb should be close to layer-0 (self), far from neighbours
# Item CL (Eq.6): even-layer item emb should be close to layer-0 (self), far from other items
loss_cl = β1 * (L_Con^U + λ * L_Con^V)

# 5. Total loss
loss = loss_bpr + loss_reg + loss_cl

# 6. Gradient update:
# Items: SGD on local copy (lr_item=0.1)
# User: Adam (lr_user=0.001)
```

**Key insight:** Clients never touch the raw E_global. They receive `E_personal`, train on a local copy, compute deltas, and return only the deltas (+ noisy user embedding for clustering).

---

### Step 6: Structural Contrastive Learning (`core/contrastive.py`)

**User CL (Eq.5):**
- Query = `e_u^(L)` (even-layer embedding of anchor user, L=2)
- Positive = `e_u^(0)` (layer-0 anchor user)
- Negatives = `e_v^(0)` for all 2-hop neighbour users v
- Loss = InfoNCE / temperature τ

**Item CL (Eq.6):**
- Query = `E_v^(L)` (even-layer item embeddings, shape `[n,d]`)  
- Keys = `E_v^(0)` (layer-0 item embeddings, detached)
- Loss = cross-entropy on `n×n` cosine similarity matrix (diagonal = correct pairs)
- Variance guard: if all even-layer embeddings identical (no shared items), skip item CL

**Why even layers?** LightGCN's even-layer aggregation naturally captures structurally similar users (users connected through shared items). This is the "self-supervised" signal.

---

### Step 7: Local Differential Privacy (`core/client_stage5.py`)

Applied AFTER local training, BEFORE uploading:

```python
def apply_ldp(g, sigma, lam):
    return clamp(g, -sigma, sigma) + Laplace(0, lam)
```

- `sigma (σ=0.1)`: clip bound — limits sensitivity of each gradient coordinate
- `lambda_laplace (λ=0.001)`: Laplacian noise scale
- Privacy budget: `ε = σ/λ = 0.1/0.001 = 100` (default = loose privacy)
- Smaller ε → more privacy → bigger performance drop

Both `item_deltas` and `user_emb` are privatized before being sent to server.

---

### Step 8: Evaluation (`evaluate()` in federated_core_stage5.py)

For each test user:
1. Compute `E_personal` from server
2. Run LightGCN on their local items → get `e_u_agg`
3. Score = `e_u_agg · E_personal[all_items]` → ranking scores
4. Rank test item against 100 negatives
5. If rank ≤ 10: HR@10 += 1, NDCG@10 += 1/log2(rank+1)

**Leave-one-out split:** most recent (or random) item held as test. Train on rest.

---

## LightGCN — Expanded Subgraph (Stage 4)

Standard LightGCN uses the full bipartite user-item graph. In federated setting, client only has local data. FedPCL expands this locally using 2-hop neighbours:

```
Layer 0:  e_u^(0), E_items^(0)
Layer 1:  e_u^(1) = (1/√n) * ΣE_items^(0)
          E_i^(1) = w_anchor[i]*e_u^(0) + Σ_{v shares i} W_neigh[i,v]*e_v^(0)
Layer 2:  same propagation using layer 1 outputs
```

Weights precomputed in `__init__` for speed (no Python loops during training).

---

## Personalisation Formula (Paper Eq.8)

```
E_personal = μ1 * E_cluster[k] + μ2 * E_global
```

- Default: μ1 = μ2 = 0.5
- `k` = cluster assignment from K-means (K=5 clusters, run every 10 rounds on ALL users)
- K-means runs on 64-dim user embeddings (in CPU numpy via sklearn)

---

## Aggregation (Paper Eq.10–13)

FedAvg-style weighted average by dataset size:

```python
# Global update
E_global[i] += Σ_clients (m_u * delta_u[i]) / Σ m_u

# Cluster update (only for clients in cluster k)
E_clusters[k][i] += Σ_{u in cluster k} (m_u * delta_u[i]) / Σ m_u
```

Where `m_u = len(train_items[u])` — larger users have more influence.

---

## How to Run

```bash
cd fedpcl

# Full FedPCL (Stage 5)
python train_stage5.py --dataset steam --data_path data/steam_processed.json

# Without LDP (Stage 4 equivalent)
python train_stage5.py --dataset ml100k --data_path data/u.data --no_ldp

# Ablation: clustering only, no contrastive (Stage 3)
python train_stage3.py --dataset ml100k --data_path data/u.data

# View results
python utils/show_results.py --file results/stage5_log_steam.json

# Multi-seed reproducibility (5 seeds)
python utils/run_multiseed.py --stage 5 --dataset ml100k --data_path data/u.data --seeds 42 123 456 789 1234

# KDE visualization
python utils/visualize_kde.py --files results/emb_ml100k_round0001.npy results/emb_ml100k_round0400.npy
```

---

## Key Hyperparameters

| Parameter | Default | Role |
|-----------|---------|------|
| `embed_dim` d | 64 | Embedding dimension |
| `n_gnn_layers` | 2 | LightGCN propagation depth |
| `n_rounds` T | 400 | Communication rounds |
| `clients_per_round` N | 128 | Clients sampled per round |
| `local_epochs` E | 10 | Local SGD steps per round |
| `n_clusters` K | 5 | K-means clusters |
| `mu1`, `mu2` | 0.5, 0.5 | Cluster/global blend weights |
| `cluster_every` | 10 | Re-run K-means every N rounds |
| `warmup_rounds` | 20 | Rounds before CL is activated |
| `beta1` β₁ | 0.1 | Contrastive loss weight |
| `lam` λ | 1.0 | Item CL weight |
| `tau` τ | 0.2–0.3 | InfoNCE temperature |
| `lr_item` | 0.1 | Item embedding SGD lr |
| `lr_user` | 0.001 | User embedding Adam lr |
| `clip_sigma` σ | 0.1 | LDP clip bound |
| `lambda_laplace` λ | 0.001 | LDP noise scale |
| `epsilon` ε | 100 | Privacy budget (σ/λ) |

---

## Paper Results (Table I)

| Dataset | HR@10 | NDCG@10 |
|---------|-------|---------|
| Steam | 80.36% | 65.55% |
| ML-100K | 63.81% | 45.03% |
| ML-1M | 62.86% | 44.12% |
| Amazon | 34.04% | 22.93% |

---

## Output Files

After training, `results/` will contain:
- `stage5_log_{dataset}.json` — full training log (loss, HR, NDCG per round + hyperparams + dataset stats)
- `emb_{dataset}_round0001.npy` — item embeddings at round 1 (random init)
- `emb_{dataset}_round0400.npy` — item embeddings at round 400 (trained)
- `emb_{dataset}_round{XXXX}_meta.json` — metadata for each embedding snapshot

---

## Implementing a New Baseline

To add e.g. FedAvg (no clustering, no CL) as a baseline:

1. Create `core/client_baseline.py` — copy `client_stage3.py`, remove clustering return
2. Create `core/server_baseline.py` — only keep `E_global`, basic `aggregate()`
3. Create `core/federated_core_baseline.py` — standard FedAvg loop
4. Create `train_baseline.py` — entry point
5. Results go to `results/baseline_log_{dataset}.json`

The `data_loader.py` and evaluation logic (`evaluate()`) can be reused directly.
