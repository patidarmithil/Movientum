# FedGNN — How It Works

**Paper reference:** `../fedgnn/FedGNN.pdf`  
**Comparison target:** FedPCL (`../fedpcl/`) — see `differences.md` for full diff table

---

## What is FedGNN?

FedGNN is a **federated recommendation baseline** using:
- **GAT** (Graph Attention Network) instead of LightGCN
- **Simple FedAvg** — no clustering, no personalization
- **Graph expansion** — one-time privacy-preserving neighbour discovery
- **Pseudo item sampling** — fake gradients mixed with real ones for privacy

Used as a **comparison baseline** against FedPCL. Lower complexity, different privacy mechanism.

---

## File Structure

```
fedgnn/
├── train_fedgnn.py              <- Entry point. Run this.
│
├── core/
│   ├── gat.py                   <- GAT module (NEW — not in FedPCL)
│   ├── client_fedgnn.py         <- Client: BPR + GAT + pseudo sampling
│   ├── server_fedgnn.py         <- Server: FedAvg + graph expansion
│   ├── federated_core_fedgnn.py <- Training loop + evaluation
│   └── data_loader.py           <- Exact copy from FedPCL (unchanged)
│
├── utils/
│   ├── show_results.py
│   ├── run_multiseed.py
│   └── plot_training_curves.py
│
├── data/
│   ├── amazon_processed.json    <- Primary target dataset
│   └── steam_processed.json
│
├── results/                     <- Auto-created. Logs go here.
│   └── fedgnn_log_{dataset}.json
│
└── how_it_works.md              <- This file
```

---

## Key Differences vs FedPCL

| Aspect | FedPCL | FedGNN |
|--------|--------|--------|
| GNN | LightGCN | GAT (attention weights) |
| Personalization | K-means + cluster models | None — single E_global |
| Contrastive loss | Yes (structural CL) | No |
| Graph expansion | No | Yes — once after warmup |
| Pseudo sampling | No | Yes — M=1000 fake items |
| Server complexity | High (clustering, K tables) | Simple (one E_global) |

---

## Data Flow

### Step 1: Load Dataset (`core/data_loader.py`)

**Identical to FedPCL** — zero changes. Returns `DataBundle` with:
- `train_dict`: `{uid: [item_ids]}`
- `test_dict`: `{uid: item_id}` (leave-one-out)
- `neg_dict`: `{uid: [100 negative item_ids]}`

---

### Step 2: Server Init (`core/server_fedgnn.py`)

`ServerFedGNN` holds:
- `E_global`: `[n_items, d]` — single item embedding table (no cluster tables)
- `_item2users`: `{item_id: [uid, ...]}` — inverted index for graph expansion
- `_neighbours`: `{uid: [neigh_uid, ...]}` — populated ONCE after warmup

---

### Step 3: Client Init (`core/client_fedgnn.py`)

Each `ClientFedGNN` stores:
- `user_emb`: `[d]` — private user embedding
- `train_items`: their interaction list
- `_gat`: `LocalGAT` instance (stateless — no learnable params)
- `_neigh_embs`: `[m, d]` — frozen neighbour embeddings (set once after warmup)

---

### Step 4: Training Loop (`core/federated_core_fedgnn.py`)

```
For each round 1..400:

  ── GRAPH EXPANSION (runs ONCE at round > warmup=20) ──────────────────
  Server finds neighbours for each client:
    For each item in client's train_items:
      Collect users who also interacted with that item (item2users index)
    Sample up to max_neigh=20 unique neighbour UIDs
    Push their current user_emb to each client (frozen permanently)

  ── CLIENT SELECTION ──────────────────────────────────────────────────
  Server samples 128 random clients

  ── LOCAL TRAINING (each client) ──────────────────────────────────────
  1. Receive E_global from server
  2. Run local_train():
     - For local_epochs=5 steps:
       a. Sample 1 neg item per pos item (BPR)
       b. GAT forward: e_u_agg = GAT(e_u, E_pos, E_neigh_frozen)
       c. BPR loss: -logsigmoid(score(u,pos) - score(u,neg)).mean()
       d. L2 reg on e_u and E_pos
       e. Backprop: SGD on E_pos, Adam on e_u
     - Compute deltas = E_local_final - E_global[pos_items]
     - Pseudo sampling: add M=1000 fake item deltas (Gaussian noise)
  3. Return: {item_id: delta} (real + fake mixed)

  ── SERVER AGGREGATION ────────────────────────────────────────────────
  E_global[i] += weighted_avg(m_u * delta_u[i]) / sum(m_u)
  where m_u = |train_items[u]|  (larger users have more influence)

  ── EVALUATION (every 10 rounds) ──────────────────────────────────────
  For each test user:
    scores = e_u_agg . E_global[all_items]
    rank test item against 100 negatives
    HR@10 += 1 if rank <= 10
    NDCG@10 += 1/log2(rank+1)
```

---

## GAT Module (`core/gat.py`)

### Architecture

```
Input: e_u [d], E_pos [n, d], E_neigh [m, d] (optional)

For each layer l = 1..L:
  1. Attention scores:
     all_neighbours = concat(E_pos, E_neigh)    # [n+m, d]
     raw_scores = (all_neighbours @ e_u) / sqrt(d)  # [n+m]
     alpha = softmax(LeakyReLU(raw_scores))         # [n+m]

  2. User aggregation:
     e_u_new = sum(alpha_j * neighbour_j)           # [d]

  3. Item update (items attend only over anchor user):
     E_pos_new = e_u.expand(n, -1)                  # [n, d]

Output: e_u_agg = mean([e_u^(0), e_u^(1), ..., e_u^(L)])  # [d]
```

**Design choice:** No learnable projection matrices (W) — keeps communication overhead identical to FedPCL. Attention computed via dot product with temperature sqrt(d).

### Why GAT over LightGCN?

LightGCN uses **fixed normalized weights** (1/sqrt(deg_u * deg_i)). GAT computes **data-dependent attention weights** — each item's contribution to the user representation is proportional to how relevant that item is to the current query user embedding. This captures heterogeneous interaction strengths better.

---

## Graph Expansion (`server_fedgnn.py → run_graph_expansion()`)

**When:** Called once after `warmup_rounds=20` rounds.

**How:**
1. Server has `_item2users` index: `{item_id: [uid, ...]}`
2. For each client, finds all users sharing at least one item
3. Samples up to `max_neigh=20` unique neighbour UIDs
4. Sends their current `user_emb` vectors to the client
5. Client stores these as `_neigh_embs` — **permanently frozen**

**Why frozen?** After expansion, neighbour embeddings are never updated in subsequent rounds. This prevents privacy leakage from repeated embedding updates being tracked by the server.

**Privacy property:** Server sends embedding vectors, not user IDs. Client cannot identify which users the embeddings belong to.

---

## Pseudo Item Sampling (`client_fedgnn.py → _add_pseudo_items()`)

After local training, client's delta dict = `{real_item_id: delta}`.  
Server could count non-zero items → infer which items user interacted with.

**Solution:** Add M=1000 fake item deltas:

```python
# Compute stats of real gradients
mu  = mean(real_deltas)     # [d]
std = std(real_deltas)      # [d]

# For M random items NOT in train_items:
fake_delta = Normal(mu, std)   # [d]
combined[fake_item_id] = fake_delta
```

Server sees `K_real + M_fake` items (K << M), so probability of identifying any real item ≈ K/M ≈ very small.

---

## Evaluation (identical to FedPCL)

Leave-one-out: most recent item held as test item.

```python
# For each test user:
scores = e_u_agg · E_global[all_items]    # dot product ranking
candidates = [test_item] + [100 negatives]
rank = 1 + count(neg_scores > test_score)
HR@10   += 1 if rank <= 10
NDCG@10 += 1/log2(rank+1) if rank <= 10
```

Same 100 negatives sampling as FedPCL. Metrics are directly comparable.

---

## How to Run

```bash
cd fedgnn

# Full run — Amazon (400 rounds)
python train_fedgnn.py --dataset amazon --data_path data/amazon_processed.json

# Full run — Steam
python train_fedgnn.py --dataset steam --data_path data/steam_processed.json

# Quick test (few rounds)
python train_fedgnn.py --dataset steam --data_path data/steam_processed.json --n_rounds 50 --eval_every 5

# Ablation: no pseudo sampling
python train_fedgnn.py --dataset steam --data_path data/steam_processed.json --pseudo_m 0

# Ablation: no graph expansion (set warmup > n_rounds)
python train_fedgnn.py --dataset steam --data_path data/steam_processed.json --warmup_rounds 9999

# View results
python utils/show_results.py --file results/fedgnn_log_steam.json

# Multi-seed reproducibility
python utils/run_multiseed.py --stage 4 --dataset steam --data_path data/steam_processed.json --seeds 42 123 456
```

---

## Key Hyperparameters

| Parameter | Default | Role |
|-----------|---------|------|
| `embed_dim` d | 64 | Embedding dimension |
| `n_gnn_layers` | 2 | GAT propagation depth |
| `n_rounds` | 400 | Communication rounds |
| `clients_per_round` | 128 | Clients per round |
| `local_epochs` | 5 | Local SGD steps |
| `warmup_rounds` | 20 | Graph expansion trigger |
| `max_neigh` | 20 | Max neighbour users |
| `pseudo_m` M | 1000 | Fake items per upload |
| `lr_item` | 0.1 | Item embedding SGD lr |
| `lr_user` | 0.001 | User embedding Adam lr |
| `weight_decay` | 1e-6 | L2 regularization |

---

## Output

After training, `results/` contains:
- `fedgnn_log_{dataset}.json` — full log (loss, HR@10, NDCG@10 per eval round, hyperparams, FedPCL target comparison)

---

## Comparison Table (FedPCL paper targets)

| Dataset | FedPCL HR@10 | FedPCL NDCG@10 | FedGNN Goal |
|---------|-------------|----------------|-------------|
| Amazon  | 34.04%      | 22.93%         | Competitive baseline |
| Steam   | 80.36%      | 65.55%         | Competitive baseline |
| ML-100K | 63.81%      | 45.03%         | Competitive baseline |

FedGNN is expected to score **lower than FedPCL** (no clustering, no contrastive learning) but higher than plain FedAvg due to GAT + graph expansion.
