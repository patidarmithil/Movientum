"""
federated_core_stage3.py
════════════════════════
Stage 3 training loop — FedAvg + K-means Clustering + Personalization.

BUGS FIXED vs original uploaded version:
  FIX 1 — DATASET_PATHS: amazon now points to amazon_processed.json
           (the preprocessed JSON used by all other stages).
           The raw CSV cannot be loaded by data_loader.py.

  FIX 2 — CLUSTERING BUG: server.update_clusters() now receives ALL
           clients' embeddings, not just the 128 selected this round.
           Passing only selected clients caused K-means to run on a
           random 3-4% of the population, producing unstable cluster
           assignments that could flip completely every 10 rounds.
           This matches the fix already present in Stage 4 and Stage 5.

  FIX 3 — TIMING: total wall-clock time is recorded and saved in the
           JSON log so training duration can be reported in the paper.
           Per-round time is also logged.

Changes from Stage 2 (what this stage adds):
  1. Server builds E_personal = mu1*E_cluster + mu2*E_global per user
  2. Client trains on E_personal instead of raw E_global
  3. Client returns (item_deltas, loss, user_emb) for K-means
  4. Server runs K-means every cluster_every rounds on ALL embeddings
  5. Server aggregates deltas into BOTH E_global and E_clusters[k]
  6. Evaluation uses E_personal per user (not E_global)

Ablation role:
  This stage = paper ablation "FedPCL w/o Contrastive Learning".
  It adds clustering personalization over FedAvg but has no
  L_Con^U or L_Con^V terms.
"""

import math
import random
import time
import json
import torch

from core.data_loader import load_dataset, load_item_names
from core.client_stage3 import ClientStage3
from core.server_stage3 import ServerStage3


# ══════════════════════════════════════════════════════════════════════════════
HPARAMS = {
    'embed_dim':         64,
    'n_gnn_layers':      2,
    'n_rounds':          400,
    'clients_per_round': 128,
    'local_epochs':      5,
    'n_clusters':        5,
    'mu1':               0.5,
    'mu2':               0.5,
    'cluster_every':     10,
    'lr_item':           0.1,
    'lr_user':           0.001,
    'weight_decay':      1e-6,
    'eval_every':        10,
    'top_k':             10,
}

TARGETS = {
    'steam':     {'FedAvg': (71.21, 50.22), 'PerFedRec': (76.61, 62.63),
                  'FedPCL': (80.36, 65.55)},
    'ml100k':    {'FedAvg': (42.70, 23.87), 'PerFedRec': (61.87, 43.51),
                  'FedPCL': (63.81, 45.03)},
    'ml1m':      {'FedAvg': (44.70, 24.90), 'PerFedRec': (61.31, 42.83),
                  'FedPCL': (62.86, 44.12)},
    'filmtrust': {'FedAvg': (10.81, 4.83),  'PerFedRec': (15.12, 8.01),
                  'FedPCL': (16.81, 8.61)},
    'amazon':    {'FedAvg': (26.53, 14.53), 'PerFedRec': (32.64, 21.39),
                  'FedPCL': (34.04, 22.93)},
}

# FIX 1: amazon_processed.json — not the raw CSV
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
    """HR@K and NDCG@K using personalised E_personal per user."""
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
def train_stage3(dataset_name, data_path,
                 hparams=None, device=None, verbose=True):
    """
    Stage 3: FedAvg + K-means Clustering + Personalized Embeddings.
    Ablation variant: FedPCL without contrastive loss.
    """
    if hparams is None:
        hparams = {}
    hp = {**HPARAMS, **hparams}

    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    bar = "=" * 72
    k   = hp['top_k']
    t_total_start = time.time()   # FIX 3: record total start

    if verbose:
        print(bar)
        print(f"  Stage 3 (Ablation: w/o CL) — {dataset_name.upper()}")
        print(bar)
        print(f"  device={device}  d={hp['embed_dim']}  K_gnn={hp['n_gnn_layers']}")
        print(f"  lr_item={hp['lr_item']}  lr_user={hp['lr_user']}  "
              f"wd={hp['weight_decay']}  local_epochs={hp['local_epochs']}")
        print(f"  rounds={hp['n_rounds']}  clients/round={hp['clients_per_round']}")
        print(f"  clusters K={hp['n_clusters']}  mu1={hp['mu1']}  mu2={hp['mu2']}  "
              f"cluster_every={hp['cluster_every']}")
        tgts = TARGETS.get(dataset_name, {})
        if tgts:
            pr = tgts.get('PerFedRec', (0, 0))
            fp = tgts.get('FedPCL',    (0, 0))
            print(f"  PerFedRec target (Stage-3-like): "
                  f"HR@10={pr[0]:.2f}%  NDCG@10={pr[1]:.2f}%")
            print(f"  FedPCL target:                  "
                  f"HR@10={fp[0]:.2f}%  NDCG@10={fp[1]:.2f}%")
        print(bar)

    bundle = load_dataset(dataset_name, data_path)

    server = ServerStage3(
        n_items    = bundle.n_items,
        embed_dim  = hp['embed_dim'],
        n_clusters = hp['n_clusters'],
        mu1        = hp['mu1'],
        mu2        = hp['mu2'],
        device     = device,
    )

    clients = {}
    sizes   = {}
    for uid, items in bundle.train_dict.items():
        if len(items) < 1:
            continue
        clients[uid] = ClientStage3(
            uid         = uid,
            train_items = items,
            n_items     = bundle.n_items,
            embed_dim   = hp['embed_dim'],
            device      = device,
        )
        sizes[uid] = len(items)

    all_ids = list(clients.keys())

    if verbose:
        print(f"  Clients: {len(clients)}")
        print(bar)
        print(f"\n  {'Round':>6} | {'Loss':>8} | "
              f"{'HR@10':>7} | {'NDCG@10':>8} | {'Time/rnd':>8}")
        print(f"  {'-'*52}")

    # Initial clustering — ALL clients
    all_uid_embs = [(uid, c.user_emb.detach().clone())
                    for uid, c in clients.items()]
    server.update_clusters(all_uid_embs)

    best_hr, best_ndcg, best_rnd = 0.0, 0.0, 0
    log         = []
    round_times = []

    for rnd in range(1, hp['n_rounds'] + 1):
        t0 = time.time()

        sel_ids    = server.select_clients(all_ids, hp['clients_per_round'])
        delta_list = []
        losses     = []

        for uid in sel_ids:
            E_personal = server.get_personal_embeddings(uid)
            item_deltas, loss, user_emb = clients[uid].local_train(
                E_personal   = E_personal,
                n_layers     = hp['n_gnn_layers'],
                local_epochs = hp['local_epochs'],
                lr_item      = hp['lr_item'],
                lr_user      = hp['lr_user'],
                weight_decay = hp['weight_decay'],
            )
            delta_list.append(item_deltas)
            if math.isfinite(loss):
                losses.append(loss)

        server.aggregate(sel_ids, delta_list, sizes)

        # FIX 2: cluster on ALL clients, not just selected
        if rnd % hp['cluster_every'] == 0:
            all_uid_embs = [(uid, c.user_emb.detach().clone())
                            for uid, c in clients.items()]
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
                marker = " ★" if rnd == best_rnd else ""
                print(f"  {rnd:>6} | {avg_loss:>8.4f} | "
                      f"{hr*100:>6.2f}% | {ndcg*100:>7.2f}% | "
                      f"{dt:>6.1f}s{marker}")
            log.append({
                'round':        rnd,
                'loss':         round(avg_loss, 5),
                f'HR@{k}':     round(hr * 100, 3),
                f'NDCG@{k}':   round(ndcg * 100, 3),
                'round_time_s': round(dt, 2),
            })

    # FIX 3: timing summary
    total_wall_s = time.time() - t_total_start
    total_wall_m = total_wall_s / 60.0
    avg_round_s  = sum(round_times) / max(len(round_times), 1)

    tgts = TARGETS.get(dataset_name, {})
    if verbose:
        print(f"\n{bar}")
        print(f"  RESULT  ({dataset_name.upper()} — Stage 3, w/o Contrastive)")
        print(f"  Best HR@{k}:          {best_hr*100:.2f}%  (round {best_rnd})")
        print(f"  Best NDCG@{k}:        {best_ndcg*100:.2f}%")
        print(f"  Total training time:  {total_wall_m:.1f} min")
        print(f"  Avg time per round:   {avg_round_s:.2f}s")
        print()
        for method, (hr_t, ndcg_t) in tgts.items():
            print(f"  vs {method:<10}: "
                  f"HR@10 {best_hr*100-hr_t:+.2f}%  "
                  f"NDCG@10 {best_ndcg*100-ndcg_t:+.2f}%")
        stats = server.get_stats()
        if stats.get('cluster_sizes'):
            print(f"  Cluster sizes: {stats['cluster_sizes']}")
        print(bar)

    log_path = f'results/stage3_log_{dataset_name}.json'
    with open(log_path, 'w') as f:
        json.dump({
            'dataset':    dataset_name,
            'hparams':    hp,
            'best_hr':    round(best_hr * 100, 3),
            'best_ndcg':  round(best_ndcg * 100, 3),
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
        print(f"  Log saved → {log_path}")

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
        'dataset':              dataset_name,
        f'HR@{k}':             round(best_hr * 100, 3),
        f'NDCG@{k}':           round(best_ndcg * 100, 3),
        'best_round':           best_rnd,
        'total_wall_minutes':   round(total_wall_m, 2),
        'server':               server,
        'clients':              clients,
        'bundle':               bundle,
    }
