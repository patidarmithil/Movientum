"""
federated_core_stage5.py
════════════════════════
Stage 5 training loop: Stage 4 + Local Differential Privacy (LDP).

CHANGES vs original:
  BUG FIX  — Clustering uses ALL clients every cluster_every rounds.

  NEW 1 — Dataset stats (n_users, n_items, density, etc.) are captured
           from the DataBundle and saved into the JSON log automatically.
           No patch_logs.py needed any more.

  NEW 2 — Score deviation from paper target is printed at end of training,
           both as raw absolute gap and as relative % of the paper value.

  NEW 3 — Loss range summary printed at end of training with expected
           convergence range per dataset.

  NEW 4 — Embeddings for round 1 and round 400 (final) are ALWAYS saved
           automatically. Additional rounds via save_emb_rounds hparam.
"""

import math
import os
import time
import json
import numpy as np
import torch

from core.data_loader   import load_dataset, load_item_names
from core.client_stage5 import ClientStage5
from core.server_stage5 import ServerStage5


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
    'beta1':             0.1,
    'lam':               1.0,
    'tau':               0.2,
    'drop_rate':         0.3,
    'warmup_rounds':     20,
    'max_neigh':         20,
    'max_items_neigh':   10,
    'lr_item':           0.1,
    'lr_user':           0.001,
    'weight_decay':      1e-6,
    'use_ldp':           True,
    'clip_sigma':        0.1,
    'lambda_laplace':    0.001,
    'eval_every':        10,
    'top_k':             10,
    'save_emb_rounds':   [],   # round 1 and final always added automatically
}

STAGE4_RESULTS = {
    'steam':     {'HR@10': 78.84, 'NDCG@10': 55.28},
    'ml100k':    {'HR@10':  0.0,  'NDCG@10':  0.0},
    'ml1m':      {'HR@10':  0.0,  'NDCG@10':  0.0},
    'filmtrust': {'HR@10':  0.0,  'NDCG@10':  0.0},
    'amazon':    {'HR@10':  0.0,  'NDCG@10':  0.0},
}

PAPER_TARGETS = {
    'steam':     {'HR@10': 80.36, 'NDCG@10': 65.55},
    'ml100k':    {'HR@10': 63.81, 'NDCG@10': 45.03},
    'ml1m':      {'HR@10': 62.86, 'NDCG@10': 44.12},
    'filmtrust': {'HR@10': 16.81, 'NDCG@10':  8.61},
    'amazon':    {'HR@10': 34.04, 'NDCG@10': 22.93},
}

# Expected total loss at convergence (round 400) per dataset
# Based on dataset diversity and sparsity analysis
LOSS_RANGES = {
    'steam':     (0.01, 0.08),
    'ml100k':    (0.45, 0.58),
    'ml1m':      (0.40, 0.55),
    'filmtrust': (0.08, 0.20),
    'amazon':    (0.25, 0.38),
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
def save_embeddings(server, dataset_name: str, rnd: int) -> str:
    """Save server.E_global as numpy array for KDE visualisation."""
    emb_np    = server.E_global.detach().cpu().numpy().astype(np.float32)
    npy_path  = f'results/emb_{dataset_name}_round{rnd:04d}.npy'
    meta_path = f'results/emb_{dataset_name}_round{rnd:04d}_meta.json'
    np.save(npy_path, emb_np)
    with open(meta_path, 'w') as f:
        json.dump({'dataset': dataset_name, 'round': rnd,
                   'n_items': int(emb_np.shape[0]),
                   'embed_dim': int(emb_np.shape[1])}, f, indent=2)
    return npy_path


def bundle_stats_dict(bundle, dataset_name: str) -> dict:
    """
    Capture DataBundle statistics into a dict for saving in the JSON log.
    Replaces patch_logs.py — stats are now captured automatically at
    training time and stored alongside results.
    """
    n_train = sum(len(v) for v in bundle.train_dict.values())
    n_test  = len(bundle.test_dict)
    n_total = n_train + n_test
    density = round(n_total / max(bundle.n_users * bundle.n_items, 1) * 100, 4)
    from core.data_loader import KCORE
    kcore_val = KCORE.get(dataset_name.lower(), 0)
    return {
        'n_users':  bundle.n_users,
        'n_items':  bundle.n_items,
        'n_train':  n_train,
        'n_test':   n_test,
        'n_total':  n_total,
        'density':  density,
        'kcore':    kcore_val if kcore_val >= 2 else 'off',
        'split':    'random',
    }


# ══════════════════════════════════════════════════════════════════════════════
@torch.no_grad()
def evaluate(clients, server, test_dict, neg_dict, n_gnn_layers, top_k=10):
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
def train_stage5(dataset_name, data_path,
                 hparams=None, device=None, verbose=True):
    if hparams is None:
        hparams = {}
    hp = {**HPARAMS, **hparams}

    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    bar = "=" * 72
    k   = hp['top_k']
    t_total_start = time.time()   # total wall-clock start

    if hp['use_ldp'] and hp['lambda_laplace'] > 0:
        epsilon = hp['clip_sigma'] / hp['lambda_laplace']
    else:
        epsilon = float('inf')

    # Always save round 1 and final round; add any extras from hparam
    save_rounds = set(hp.get('save_emb_rounds', []))
    save_rounds.add(1)
    save_rounds.add(hp['n_rounds'])

    if verbose:
        print(bar)
        print(f"  Stage 5: FedPCL + LDP — {dataset_name.upper()}")
        print(bar)
        print(f"  device={device}  d={hp['embed_dim']}  K_gnn={hp['n_gnn_layers']}")
        print(f"  rounds={hp['n_rounds']}  clients/round={hp['clients_per_round']}")
        print(f"  local_epochs={hp['local_epochs']}  lr_item={hp['lr_item']}")
        print(f"  clusters K={hp['n_clusters']}  mu1={hp['mu1']}  mu2={hp['mu2']}")
        print(f"  beta1={hp['beta1']}  lam={hp['lam']}  tau={hp['tau']}")
        print()
        if hp['use_ldp']:
            print(f"  LDP ENABLED: σ={hp['clip_sigma']}  "
                  f"λ={hp['lambda_laplace']}  ε={epsilon:.1f}")
        else:
            print(f"  LDP DISABLED")
        exp_lo, exp_hi = LOSS_RANGES.get(dataset_name, (0.0, 1.0))
        print(f"  Expected convergence loss: {exp_lo:.2f} – {exp_hi:.2f}")
        tgt = PAPER_TARGETS.get(dataset_name, {})
        if tgt:
            print(f"  Paper target: "
                  f"HR@10={tgt['HR@10']:.2f}%  NDCG@10={tgt['NDCG@10']:.2f}%")
        print(f"  Embedding snapshots will be saved at: "
              f"{sorted(save_rounds)}")
        print(bar)

    bundle = load_dataset(dataset_name, data_path)

    # Capture dataset stats right after loading
    bstats = bundle_stats_dict(bundle, dataset_name)

    server = ServerStage5(
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

    clients = {}
    sizes   = {}
    if verbose:
        print("  Building clients + 2-hop neighbourhoods ...")

    for uid, items in bundle.train_dict.items():
        if len(items) < 1:
            continue
        neighbours = server.get_neighbours(uid)
        clients[uid] = ClientStage5(
            uid             = uid,
            train_items     = items,
            neighbour_users = neighbours,
            n_items         = bundle.n_items,
            embed_dim       = hp['embed_dim'],
            device          = device,
        )
        sizes[uid] = len(items)

    all_ids = list(clients.keys())

    # Initial clustering — ALL clients (FIX applied)
    all_uid_embs = [(uid, c.user_emb.detach().clone())
                    for uid, c in clients.items()]
    server.update_clusters(all_uid_embs)

    if verbose:
        avg_neigh = (sum(len(c.neigh_uids) for c in clients.values())
                     / max(len(clients), 1))
        ldp_tag   = (f"LDP(σ={hp['clip_sigma']},λ={hp['lambda_laplace']})"
                     if hp['use_ldp'] else "LDP=OFF")
        print(f"  Clients: {len(clients)}  |  "
              f"Avg neighbours: {avg_neigh:.1f}  |  {ldp_tag}")
        print(f"  Dataset stats: users={bstats['n_users']}  "
              f"items={bstats['n_items']}  "
              f"interactions={bstats['n_total']}  "
              f"density={bstats['density']}%  "
              f"kcore={bstats['kcore']}")
        print(bar)
        print(f"\n  {'Round':>6} | {'Loss':>8} | "
              f"{'HR@10':>7} | {'NDCG@10':>8} | "
              f"{'CL':>5} | {'LDP':>5} | {'Time':>6}")
        print(f"  {'-'*62}")

    best_hr, best_ndcg, best_rnd = 0.0, 0.0, 0
    log        = []
    all_losses = []
    round_times = []

    for rnd in range(1, hp['n_rounds'] + 1):
        t0     = time.time()
        use_cl = (rnd > hp['warmup_rounds'])

        sel_ids    = server.select_clients(all_ids, hp['clients_per_round'])
        delta_list = []
        losses     = []

        for uid in sel_ids:
            E_personal = server.get_personal_embeddings(uid)
            neigh_embs = server.get_neigh_embs(uid, clients) if use_cl else {}

            item_deltas, loss, user_emb = clients[uid].local_train(
                E_personal     = E_personal,
                neigh_embs     = neigh_embs,
                n_layers       = hp['n_gnn_layers'],
                local_epochs   = hp['local_epochs'],
                lr_item        = hp['lr_item'],
                lr_user        = hp['lr_user'],
                weight_decay   = hp['weight_decay'],
                use_cl         = use_cl,
                beta1          = hp['beta1'],
                lam            = hp['lam'],
                tau            = hp['tau'],
                drop_rate      = hp['drop_rate'],
                use_ldp        = hp['use_ldp'],
                clip_sigma     = hp['clip_sigma'],
                lambda_laplace = hp['lambda_laplace'],
            )
            delta_list.append(item_deltas)
            if math.isfinite(loss):
                losses.append(loss)

        server.aggregate(sel_ids, delta_list, sizes)

        # FIX: cluster using ALL clients, not just selected
        if rnd % hp['cluster_every'] == 0:
            all_uid_embs = [(uid, c.user_emb.detach().clone())
                            for uid, c in clients.items()]
            server.update_clusters(all_uid_embs)

        # Save embeddings at round 1, final, and any extra requested rounds
        if rnd in save_rounds:
            saved_path = save_embeddings(server, dataset_name, rnd)
            if verbose:
                print(f"  [Emb saved] round={rnd:>4d}  →  {saved_path}")

        avg_loss = sum(losses) / max(len(losses), 1)
        all_losses.append(avg_loss)
        dt = time.time() - t0
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
                marker    = " ★" if rnd == best_rnd else ""
                cl_label  = "ON " if use_cl else "off"
                ldp_label = "ON " if hp['use_ldp'] else "off"
                print(f"  {rnd:>6} | {avg_loss:>8.4f} | "
                      f"{hr*100:>6.2f}% | {ndcg*100:>7.2f}% | "
                      f"{cl_label} | {ldp_label} | {dt:>4.1f}s{marker}")

            log.append({
                'round':        rnd,
                'loss':         round(avg_loss, 5),
                f'HR@{k}':     round(hr * 100, 3),
                f'NDCG@{k}':   round(ndcg * 100, 3),
                'cl_active':    use_cl,
                'ldp_active':   hp['use_ldp'],
                'round_time_s': round(dt, 2),
            })

    # ── Timing summary ────────────────────────────────────────────────────────
    total_wall_s = time.time() - t_total_start
    total_wall_m = total_wall_s / 60.0
    avg_round_s  = sum(round_times) / max(len(round_times), 1)

    # ── Post-training reporting ───────────────────────────────────────────────
    tgt = PAPER_TARGETS.get(dataset_name, {})
    s4  = STAGE4_RESULTS.get(dataset_name, {})

    final_loss     = all_losses[-1] if all_losses else 0.0
    min_loss       = min(all_losses) if all_losses else 0.0
    min_loss_round = all_losses.index(min_loss) + 1
    exp_lo, exp_hi = LOSS_RANGES.get(dataset_name, (0.0, 1.0))
    loss_in_range  = exp_lo <= final_loss <= exp_hi

    if verbose:
        print(f"\n{bar}")
        print(f"  RESULT  ({dataset_name.upper()})")
        print(f"  Best HR@{k}:          {best_hr*100:.2f}%  (round {best_rnd})")
        print(f"  Best NDCG@{k}:        {best_ndcg*100:.2f}%")
        print(f"  Total training time:  {total_wall_m:.1f} min")
        print(f"  Avg time per round:   {avg_round_s:.2f}s")
        print()

        # ── Loss range summary ────────────────────────────────────────────────
        status_loss = ("within expected range"
                       if loss_in_range else "OUTSIDE expected range")
        print(f"  LOSS SUMMARY:")
        print(f"  {'Round 1 loss':<34} {all_losses[0]:.5f}")
        print(f"  {'Minimum loss':<34} "
              f"{min_loss:.5f}  (round {min_loss_round})")
        print(f"  {'Final loss (round ' + str(hp['n_rounds']) + ')':<34} "
              f"{final_loss:.5f}")
        print(f"  {'Expected range at convergence':<34} "
              f"{exp_lo:.2f} – {exp_hi:.2f}")
        print(f"  {'Convergence status':<34} {status_loss}")
        print()

        # ── Score deviation from paper ────────────────────────────────────────
        if tgt:
            hr_abs   = best_hr*100 - tgt['HR@10']
            ndcg_abs = best_ndcg*100 - tgt['NDCG@10']
            hr_rel   = hr_abs   / tgt['HR@10']   * 100
            ndcg_rel = ndcg_abs / tgt['NDCG@10'] * 100
            print(f"  SCORE DEVIATION FROM PAPER:")
            print(f"  {'Metric':<10} {'Ours':>8}  {'Paper':>8}  "
                  f"{'Abs gap':>9}  {'Rel gap (% of paper)':>22}")
            print(f"  {'-'*65}")
            print(f"  {'HR@10':<10} {best_hr*100:>7.2f}%  {tgt['HR@10']:>7.2f}%"
                  f"  {hr_abs:>+8.2f}%  {hr_rel:>+21.1f}%")
            print(f"  {'NDCG@10':<10} {best_ndcg*100:>7.2f}%  {tgt['NDCG@10']:>7.2f}%"
                  f"  {ndcg_abs:>+8.2f}%  {ndcg_rel:>+21.1f}%")
            print()
            if hr_abs >= -2.0:
                verdict = "✓ Matches paper (within 2%)"
            elif hr_abs >= -5.0:
                verdict = "~ Close to paper (within 5%)"
            else:
                verdict = "✗ Below paper (gap > 5%)"
            print(f"  Verdict: {verdict}")
            print()

        # ── Privacy-utility table ─────────────────────────────────────────────
        if tgt:
            print(f"  PRIVACY-UTILITY TABLE:")
            print(f"  {'Method':<28} {'HR@10':>8}  {'NDCG@10':>9}")
            print(f"  {'-'*48}")
            print(f"  {'Paper FedPCL':<28} {tgt['HR@10']:>7.2f}%  "
                  f"{tgt['NDCG@10']:>8.2f}%")
            if s4 and s4['HR@10'] > 0:
                print(f"  {'Stage 4 (no LDP)':<28} {s4['HR@10']:>7.2f}%  "
                      f"{s4['NDCG@10']:>8.2f}%")
            ldp_label = (f"Stage 5 (LDP ε={epsilon:.0f})"
                         if hp['use_ldp'] else "Stage 5 (LDP off)")
            print(f"  {ldp_label:<28} {best_hr*100:>7.2f}%  "
                  f"{best_ndcg*100:>8.2f}%")
        print(bar)

    # ── Save log ──────────────────────────────────────────────────────────────
    log_path = f'results/stage5_log_{dataset_name}.json'
    with open(log_path, 'w') as f:
        json.dump({
            'dataset':      dataset_name,
            'hparams':      hp,
            'best_hr':      round(best_hr * 100, 3),
            'best_ndcg':    round(best_ndcg * 100, 3),
            'best_round':   best_rnd,
            'epsilon':      round(epsilon, 3) if epsilon != float('inf') else None,
            'bundle_stats': bstats,
            'timing': {
                'total_wall_seconds': round(total_wall_s, 1),
                'total_wall_minutes': round(total_wall_m, 2),
                'avg_round_seconds':  round(avg_round_s, 3),
                'n_rounds':           hp['n_rounds'],
            },
            'loss_summary': {
                'round1':      round(all_losses[0], 5) if all_losses else None,
                'min':         round(min_loss,       5),
                'min_round':   min_loss_round,
                'final':       round(final_loss,     5),
                'expected_lo': exp_lo,
                'expected_hi': exp_hi,
                'in_range':    loss_in_range,
            },
            'log': log,
        }, f, indent=2)
    if verbose:
        print(f"  Log → {log_path}")

    # ── Recommendations for user 0 ────────────────────────────────────────────
    if verbose and 0 in clients:
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
        f'HR@{k}':           round(best_hr * 100, 3),
        f'NDCG@{k}':         round(best_ndcg * 100, 3),
        'best_round':         best_rnd,
        'total_wall_minutes': round(total_wall_m, 2),
        'epsilon':            epsilon,
        'server':             server,
        'clients':            clients,
        'bundle':             bundle,
    }
