Here's the fully updated document reflecting your decisions:

---

## 2. Differences Between FedPCL and FedGNN

|Aspect|FedPCL (existing code)|FedGNN (to implement)|
|---|---|---|
|**Task**|Ranking (implicit feedback)|Ranking (implicit feedback) — same|
|**Loss**|BPR + Structural Contrastive Loss|BPR only|
|**Metric**|HR@10, NDCG@10|HR@10, NDCG@10 — same|
|**GNN backbone**|LightGCN|GAT (Graph Attention Network)|
|**Contrastive Learning**|Yes — structural CL pulling 2-hop neighbors|None|
|**Personalization**|Yes — cluster model + global model|None — single global model via simple FedAvg|
|**Server clustering**|K-means every C rounds|No clustering at all|
|**Graph expansion**|Not present|Yes — privacy-preserving neighbour discovery (simulated server-side)|
|**Pseudo item sampling**|Not present|Yes — M fake item gradients mixed with real ones|
|**Data type**|Implicit (click/no-click)|Implicit (click/no-click) — same|
|**Dataset**|Amazon|Amazon — same|
|**Neighbour embeddings**|2-hop from LightGCN propagation|Direct neighbouring user embeddings (fixed after warmup)|
|**Warmup phase**|CL disabled for first 20 rounds|Neighbour embeddings excluded for first T epochs|
|**Aggregation**|Weighted FedAvg at cluster + global level|Simple FedAvg only|

---

## 3. What You Already Have vs What FedGNN Needs

### ✅ Already have in FedPCL that FedGNN also needs:

- **Federated training loop skeleton** — client selection, round-based training, server-client communication pattern (federated_core_stageX.py structure is directly reusable)
- **data_loader.py** — exact same file, no changes needed; Amazon implicit feedback, train_dict, test_dict, neg_dict, adjacency matrices, degree arrays all carry over
- **BPR loss** — same loss function, just without the contrastive term
- **HR@10 / NDCG@10 evaluation** — identical evaluation logic, reuse directly
- **Item embedding delta aggregation** — server aggregates item embedding updates from clients, same pattern
- **Local GNN forward pass concept** — local subgraph + GNN propagation + embedding update, same design
- **show_results.py, run_multiseed.py, plot_training_curves.py** — copy directly from FedPCL utils

### ❌ What FedGNN needs that FedPCL does NOT have:

1. **GAT (Graph Attention Network) module** — FedPCL uses LightGCN; FedGNN requires attention-based GNN that computes attention weights between user-item nodes on the local subgraph
    
2. **Pseudo interacted item sampler** — sample M items the user has not interacted with, generate random gradients from a Gaussian with same mean/covariance as real item gradients, and mix them together. M must be strictly greater than K (actual interactions) for privacy; paper uses M=1000
    
3. **Privacy-preserving graph expansion module** — simulated server-side in code:
    
    - Server matches users who share common interacted items (using hashed item IDs)
    - Distributes neighbouring user embeddings anonymously back to clients
    - Clients expand their local subgraph to include these neighbour user nodes
    - Runs **only once** after warmup epochs, not every round
4. **Neighbouring user embedding handling** — clients receive fixed embeddings of anonymous neighbour users, include them in local subgraph during GAT forward pass, these are **frozen** after graph expansion and not updated in subsequent rounds
    
5. **No clustering logic** — remove all K-means, cluster model, cluster assignment, personalized embedding blending from server
    
6. **No contrastive loss** — no structural CL module, no positive/negative pair construction, no InfoNCE
    

---

## 4. File Structure for FedGNN

```
fedgnn/
├── train_fedgnn.py              ← entry point (parse args, set hyperparams, call train)
│
├── core/                        ← all implementation logic
│   ├── data_loader.py           ← EXACT COPY from FedPCL (zero changes)
│   ├── gat.py                   ← GAT model (replaces LightGCN)
│   ├── server_fedgnn.py         ← server logic (simple FedAvg, no clustering)
│   ├── client_fedgnn.py         ← client logic (BPR loss, GAT forward, return deltas)
│   └── federated_core_fedgnn.py ← main training loop + HR@10/NDCG@10 evaluation
│
├── utils/                       ← direct copy from FedPCL utils
│   ├── show_results.py
│   ├── run_multiseed.py
│   └── plot_training_curves.py
│
├── data/                        ← same data folder
│   └── amazon_processed.json
│
└── results/                     ← auto-created on first run
    ├── fedgnn_log_amazon.json
    └── ...
```

---

## Key Implementation Decisions

- **data_loader.py is identical** — no rating values needed, Amazon implicit feedback works as-is
- **gat.py is the only genuinely new module** — everything else maps 1-to-1 with FedPCL files
- **client_fedgnn.py mirrors client_stage3.py most closely** — BPR only, no CL, no LDP in this first version
- **server_fedgnn.py is simpler than any FedPCL server stage** — just FedAvg on item deltas, no cluster tables, no K-means
- **Graph expansion runs once** after warmup T epochs, then neighbour embeddings are frozen permanently
- **Pseudo item sampling** — M=1000 fake items, gradients drawn from Gaussian matching real gradient statistics
- **Evaluation** — HR@10 and NDCG@10, same negative sampling and ranking logic as FedPCL, runs every eval_every rounds
- **LDP (for later)** — same clip + Laplace formula as FedPCL Stage 5, δ=0.1, λ=0.001, add when base scores are confirmed