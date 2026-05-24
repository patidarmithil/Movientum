"""
federated_core_stage4.py
════════════════════════
Stage 4 training loop: FedAvg + Clustering + Structural Contrastive Learning.

Changes from Stage 3:
  1. Server precomputes item2users index for graph expansion
  2. Each selected client receives:
       - E_personal (same as Stage 3)
       - neigh_embs: neighbour user embeddings for contrastive negatives
  3. Client uses expanded LightGCN subgraph (multiple users)
  4. Local loss = L_BPR + β₁(L_Con^U + λ·L_Con^V) + β₂||Θ||²
  5. Warmup: use_cl=False for rounds 1-20, True from round 21 onwards

Paper hyperparameters (Section IV-A):
  β₁=0.1, λ=1.0, τ=0.3, warmup=20 rounds
"""

import math
import random
import time
import json
import torch

from core.data_loader import load_dataset, load_item_names
from core.client_stage4 import ClientStage4
from core.server_stage4 import ServerStage4


# ══════════════════════════════════════════════════════════════════════════════
HPARAMS = {
    # ── Architecture ──────────────────────────────────────────────────────────
    'embed_dim':         64,
    'n_gnn_layers':      2,

    # ── Federated training ────────────────────────────────────────────────────
    'n_rounds':          400,  # CL needs rounds 21-600 = 580 rounds to take effect
    'clients_per_round': 128,
    'local_epochs':      5,

    # ── Personalization (Stage 3, unchanged) ──────────────────────────────────
    'n_clusters':        5,
    'mu1':               0.5,
    'mu2':               0.5,
    'cluster_every':     10,

    # ── Contrastive learning (Stage 4 NEW) ────────────────────────────────────
    'beta1':             0.1,   # weight of contrastive loss (paper β₁=0.1)
    'lam':               1.0,   # item CL weight (paper λ=1.0)
    'tau':               0.2,   # InfoNCE temperature — paper Fig.3 shows best at τ∈{0.175,0.2}.
                                # This is what produced Table I results (80.36% Steam).
    'drop_rate':         0.3,   # item augmentation dropout. With d=64, drops
                                # ~19/64 dims → cosine(views)≈0.70 — meaningful.
                                # 0.1 only drops 6/64 → near-trivial positives.
    'warmup_rounds':     20,    # no CL for first N rounds (paper Section IV-A)
    'max_neigh':         20,    # max 2-hop neighbour users per client
    'max_items_neigh':   10,    # max items per neighbour

    # ── Learning rates ────────────────────────────────────────────────────────
    'lr_item':           0.1,
    'lr_user':           0.001,
    'weight_decay':      1e-6,

    # ── Evaluation ────────────────────────────────────────────────────────────
    'eval_every':        10,
    'top_k':             10,
}

TARGETS = {
    'steam':     {'Stage3': (77.93, 55.79),
                  'PerFedRec': (76.61, 62.63),
                  'FPFR':      (78.43, 64.76),
                  'FedPCL':    (80.36, 65.55)},
    'ml100k':    {'Stage3': (0, 0),
                  'PerFedRec': (61.87, 43.51),
                  'FedPCL':    (63.81, 45.03)},
    'ml1m':      {'Stage3': (0, 0),
                  'PerFedRec': (61.31, 42.83),
                  'FedPCL':    (62.86, 44.12)},
    'filmtrust': {'Stage3': (0, 0),
                  'PerFedRec': (15.12, 8.01),
                  'FedPCL':    (16.81, 8.61)},
    'amazon':    {'Stage3': (0, 0),
                  'PerFedRec': (32.64, 21.39),
                  'FedPCL':    (34.04, 22.93)},
}

DATASET_PATHS = {
    'steam':     'data/steam_processed.json',
    'ml100k':    'data/u.data',
    'ml1m':      'data/ratings.dat',
    'filmtrust': 'data/ratings.txt',
    'amazon':    'data/amazon_processed.json',
}

ITEM_NAME_FILES = {
    'steam':  'data/steam_processed.json',
    'ml100k': 'data/u.item',
    'ml1m':   'data/movies.dat',
}


# ══════════════════════════════════════════════════════════════════════════════
@torch.no_grad()
def evaluate(clients, server, test_dict, neg_dict, n_gnn_layers, top_k=10):
    """HR@K and NDCG@K using personalised embeddings per user."""
    total_hr, total_ndcg, n = 0.0, 0.0, 0

    for uid, test_item in test_dict.items():
        if uid not in clients or uid not in neg_dict:
            continue
        E_personal = server.get_personal_embeddings(uid)
        scores     = clients[uid].get_scores(E_personal, n_gnn_layers)
        candidates = [test_item] + neg_dict[uid]
        cand_sc    = scores[candidates]
        n_higher   = int((cand_sc[1:] > cand_sc[0]).sum())
        rank       = n_higher + 1
        if rank <= top_k:
            total_hr   += 1.0
            total_ndcg += 1.0 / math.log2(rank + 1)
        n += 1

    return {
        f'HR@{top_k}':   total_hr   / max(n, 1),
        f'NDCG@{top_k}': total_ndcg / max(n, 1),
        'n_users': n,
    }


# ══════════════════════════════════════════════════════════════════════════════
def train_stage4(dataset_name, data_path,
                 hparams=None, device=None, verbose=True):
    """
    Stage 4: FedAvg + Clustering + Structural Contrastive Learning.
    Runs exactly n_rounds rounds.
    """
    if hparams is None:
        hparams = {}
    hp = {**HPARAMS, **hparams}

    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    bar = "=" * 72
    k   = hp['top_k']
    t_total_start = time.time()   # total wall-clock start

    if verbose:
        print(bar)
        print(f"  Stage 4: FedPCL — {dataset_name.upper()}")
        print(bar)
        print(f"  device={device}  d={hp['embed_dim']}  K_gnn={hp['n_gnn_layers']}")
        print(f"  lr_item={hp['lr_item']}  lr_user={hp['lr_user']}  "
              f"wd={hp['weight_decay']}  local_epochs={hp['local_epochs']}")
        print(f"  rounds={hp['n_rounds']}  clients/round={hp['clients_per_round']}")
        print(f"  clusters K={hp['n_clusters']}  μ1={hp['mu1']}  μ2={hp['mu2']}")
        print(f"  β₁={hp['beta1']}  λ={hp['lam']}  τ={hp['tau']}  "
              f"warmup={hp['warmup_rounds']}  drop={hp['drop_rate']}")
        tgts = TARGETS.get(dataset_name, {})
        if 'FedPCL' in tgts:
            fp = tgts['FedPCL']
            print(f"  FedPCL target: HR@10={fp[0]:.2f}%  NDCG@10={fp[1]:.2f}%")
        print(bar)

    bundle = load_dataset(dataset_name, data_path)

    # ── Server (Stage 4 — has item2users index) ───────────────────────────────
    server = ServerStage4(
        n_items         = bundle.n_items,
        embed_dim       = hp['embed_dim'],
        train_dict      = bundle.train_dict,
        n_clusters      = hp['n_clusters'],
        mu1             = hp['mu1'],
        mu2             = hp['mu2'],
        max_neigh       = hp['max_neigh'],
        max_items_neigh = hp['max_items_neigh'],
        device          = device,
    )

    # ── Clients (Stage 4 — knows their neighbours) ────────────────────────────
    clients = {}
    sizes   = {}
    if verbose:
        print("  Building clients + computing 2-hop neighbourhoods...")

    for uid, items in bundle.train_dict.items():
        if len(items) < 1:
            continue
        neighbours = server.get_neighbours(uid)
        clients[uid] = ClientStage4(
            uid             = uid,
            train_items     = items,
            neighbour_users = neighbours,
            n_items         = bundle.n_items,
            embed_dim       = hp['embed_dim'],
            device          = device,
        )
        sizes[uid] = len(items)

    all_ids = list(clients.keys())

    # ── Initial clustering (same as Stage 3) ──────────────────────────────────
    all_uid_embs = [(uid, c.user_emb.detach().clone())
                    for uid, c in clients.items()]
    server.update_clusters(all_uid_embs)

    if verbose:
        avg_neigh = sum(len(c.neigh_uids) for c in clients.values()) / max(len(clients), 1)
        print(f"  Clients: {len(clients)}  |  Avg neighbours: {avg_neigh:.1f}")
        print(bar)
        print(f"\n  {'Round':>6} | {'Loss':>8} | "
              f"{'HR@10':>7} | {'NDCG@10':>8} | {'CL':>5} | {'Time':>6}")
        print(f"  {'-'*58}")

    best_hr, best_ndcg, best_rnd = 0.0, 0.0, 0
    log         = []
    round_times = []

    # ── Training loop ─────────────────────────────────────────────────────────
    for rnd in range(1, hp['n_rounds'] + 1):
        t0     = time.time()
        use_cl = (rnd > hp['warmup_rounds'])   # warmup: no CL for first 20 rounds

        sel_ids    = server.select_clients(all_ids, hp['clients_per_round'])
        delta_list = []
        losses     = []
        uid_embs   = []

        for uid in sel_ids:
            E_personal = server.get_personal_embeddings(uid)

            # Neighbour embeddings for contrastive negatives
            neigh_embs = server.get_neigh_embs(uid, clients) if use_cl else {}

            item_deltas, loss, user_emb = clients[uid].local_train(
                E_personal   = E_personal,
                neigh_embs   = neigh_embs,
                n_layers     = hp['n_gnn_layers'],
                local_epochs = hp['local_epochs'],
                lr_item      = hp['lr_item'],
                lr_user      = hp['lr_user'],
                weight_decay = hp['weight_decay'],
                use_cl       = use_cl,
                beta1        = hp['beta1'],
                lam          = hp['lam'],
                tau          = hp['tau'],
                drop_rate    = hp['drop_rate'],
            )
            delta_list.append(item_deltas)
            uid_embs.append((uid, user_emb))
            if math.isfinite(loss):
                losses.append(loss)

        # Aggregation (global + per-cluster, same as Stage 3)
        server.aggregate(sel_ids, delta_list, sizes)

        # Re-cluster every cluster_every rounds
        if rnd % hp['cluster_every'] == 0:
            all_uid_embs = [(uid, c.user_emb.detach().clone())
                            for uid, c in clients.items()]   # ✅ all clients
            server.update_clusters(all_uid_embs)

        avg_loss = sum(losses) / max(len(losses), 1)
        dt       = time.time() - t0
        round_times.append(dt)

        if rnd % hp['eval_every'] == 0 or rnd == 1 or rnd == hp['n_rounds']:
            metrics = evaluate(
                clients      = clients,
                server       = server,
                test_dict    = bundle.test_dict,
                neg_dict     = bundle.neg_dict,
                n_gnn_layers = hp['n_gnn_layers'],
                top_k        = k,
            )
            hr   = metrics[f'HR@{k}']
            ndcg = metrics[f'NDCG@{k}']

            if hr > best_hr:
                best_hr, best_ndcg, best_rnd = hr, ndcg, rnd

            if verbose:
                marker   = " ★" if rnd == best_rnd else ""
                cl_label = "ON " if use_cl else "off"
                print(f"  {rnd:>6} | {avg_loss:>8.4f} | "
                      f"{hr*100:>6.2f}% | {ndcg*100:>7.2f}% | "
                      f"{cl_label} | {dt:>4.1f}s{marker}")

            log.append({
                'round':        rnd,
                'loss':         round(avg_loss, 5),
                f'HR@{k}':     round(hr*100, 3),
                f'NDCG@{k}':   round(ndcg*100, 3),
                'cl_active':    use_cl,
                'round_time_s': round(dt, 2),
            })

    # ── Timing summary ────────────────────────────────────────────────────────
    total_wall_s = time.time() - t_total_start
    total_wall_m = total_wall_s / 60.0
    avg_round_s  = sum(round_times) / max(len(round_times), 1)

    # ── Results ───────────────────────────────────────────────────────────────
    tgts = TARGETS.get(dataset_name, {})
    if verbose:
        print(f"\n{bar}")
        print(f"  RESULT  ({dataset_name.upper()})")
        print(f"  Best HR@{k}:          {best_hr*100:.2f}%  (round {best_rnd})")
        print(f"  Best NDCG@{k}:        {best_ndcg*100:.2f}%")
        print(f"  Total training time:  {total_wall_m:.1f} min")
        print(f"  Avg time per round:   {avg_round_s:.2f}s")
        print()
        for method, (hr_t, ndcg_t) in tgts.items():
            if hr_t == 0:
                continue
            print(f"  vs {method:<10}: "
                  f"HR@10 {best_hr*100-hr_t:+.2f}%  "
                  f"NDCG@10 {best_ndcg*100-ndcg_t:+.2f}%")
        print(bar)

    log_path = f'results/stage4_log_{dataset_name}.json'
    with open(log_path, 'w') as f:
        json.dump({
            'dataset':    dataset_name,
            'hparams':    hp,
            'best_hr':    round(best_hr*100, 3),
            'best_ndcg':  round(best_ndcg*100, 3),
            'best_round': best_rnd,
            'timing': {
                'total_wall_seconds': round(total_wall_s, 1),
                'total_wall_minutes': round(total_wall_m, 2),
                'avg_round_seconds':  round(avg_round_s, 3),
                'n_rounds':           hp['n_rounds'],
            },
            'log': log,
        }, f, indent=2)
    if verbose:
        print(f"  Log → {log_path}")

    # ── Recommendations for user 0 ────────────────────────────────────────────
    if verbose and 0 in clients:
        import os
        names_file = ITEM_NAME_FILES.get(dataset_name)
        id2name = {}
        if names_file and os.path.exists(names_file):
            id2name = load_item_names(
                dataset_name, names_file,
                item2id=getattr(bundle, '_item2id', None)
            )
        E_personal = server.get_personal_embeddings(0)
        scores     = clients[0].get_scores(E_personal, hp['n_gnn_layers'])
        seen       = set(bundle.train_dict.get(0, []))
        scores[list(seen)] = -1e9
        topk = torch.topk(scores, k).indices.tolist()
        cluster_id = server.assignments.get(0, '?')
        print(f"\n  TOP-10 FOR USER 0  (cluster {cluster_id}):")
        for rank, iid in enumerate(topk, 1):
            name = id2name.get(iid, f'item_{iid}')
            print(f"    {rank:2d}. {str(name)[:55]:<55}  "
                  f"score={float(scores[iid]):.4f}")
        if 0 in bundle.test_dict:
            held = bundle.test_dict[0]
            print(f"\n  Held-out: {id2name.get(held, f'item_{held}')}")

    return {
        'dataset':            dataset_name,
        f'HR@{k}':           round(best_hr*100, 3),
        f'NDCG@{k}':         round(best_ndcg*100, 3),
        'best_round':         best_rnd,
        'total_wall_minutes': round(total_wall_m, 2),
        'server':             server,
        'clients':            clients,
        'bundle':             bundle,
    }
