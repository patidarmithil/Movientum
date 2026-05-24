"""
federated_core_fedgnn.py
════════════════════════
FedGNN training loop — TRUE FedGNN implementation.
Matches paper: gradient sharing, trainable GAT, LDP, pseudo sampling.
"""

import math
import os
import time
import json
import torch

from core.data_loader   import load_dataset
from core.client_fedgnn import ClientFedGNN
from core.server_fedgnn import ServerFedGNN


HPARAMS = {
    'embed_dim':         64,
    'n_gnn_layers':      2,
    'n_rounds':          400,
    'clients_per_round': 128,
    
    # Graph expansion
    'warmup_rounds':     20,
    'max_neigh':         20,
    
    # Privacy
    'pseudo_m':          100,
    'clip_norm':         1.0,
    'laplace_lambda':    0.01,
    
    # Optimisation
    'lr_item':           0.1,
    'lr_user':           0.01,
    'lr_model':          0.01,
    'weight_decay':      1e-6,
    
    'eval_every':        10,
    'top_k':             10,
}

DATASET_PATHS = {
    'amazon':    'data/amazon_processed.json',
    'steam':     'data/steam_processed.json',
    'ml100k':    'data/u.data',
    'ml1m':      'data/ratings.dat',
    'filmtrust': 'data/ratings.txt',
}

FEDPCL_TARGETS = {
    'amazon':    {'HR@10': 34.04, 'NDCG@10': 22.93},
    'steam':     {'HR@10': 80.36, 'NDCG@10': 65.55},
    'ml100k':    {'HR@10': 63.81, 'NDCG@10': 45.03},
    'ml1m':      {'HR@10': 62.86, 'NDCG@10': 44.12},
}

@torch.no_grad()
def evaluate(clients, server, test_dict, neg_dict, top_k=10):
    total_hr, total_ndcg, n = 0.0, 0.0, 0
    E_global = server.get_embeddings()
    gat_state = server.get_gat_state()

    for uid, test_item in test_dict.items():
        if uid not in clients or uid not in neg_dict:
            continue
        scores = clients[uid].get_scores(E_global, gat_state)
        candidates = [test_item] + neg_dict[uid]
        cand_sc = scores[candidates]
        n_higher = int((cand_sc[1:] > cand_sc[0]).sum())
        rank = n_higher + 1
        if rank <= top_k:
            total_hr += 1.0
            total_ndcg += 1.0 / math.log2(rank + 1)
        n += 1

    return {
        f'HR@{top_k}':   total_hr   / max(n, 1),
        f'NDCG@{top_k}': total_ndcg / max(n, 1),
        'n_users': n,
    }


def train_fedgnn(dataset_name, data_path,
                 hparams=None, device=None, verbose=True):
    if hparams is None:
        hparams = {}
    hp = {**HPARAMS, **hparams}

    if device is None:
        device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    os.makedirs('results', exist_ok=True)
    bar = "=" * 72
    k = hp['top_k']
    t_total_start = time.time()

    if verbose:
        print(bar)
        print(f"  FedGNN — {dataset_name.upper()}")
        print(bar)
        print(f"  device={device}  d={hp['embed_dim']}  GAT_layers={hp['n_gnn_layers']}")
        print(f"  rounds={hp['n_rounds']}  clients/round={hp['clients_per_round']}")
        print(f"  lr_item={hp['lr_item']}  lr_model={hp['lr_model']}  lr_user={hp['lr_user']}")
        print(f"  warmup={hp['warmup_rounds']}  max_neigh={hp['max_neigh']}")
        print(f"  pseudo_M={hp['pseudo_m']}  clip={hp['clip_norm']}  noise={hp['laplace_lambda']}")
        tgt = FEDPCL_TARGETS.get(dataset_name, {})
        if tgt:
            print(f"  FedPCL target: HR@10={tgt['HR@10']:.2f}%  NDCG@10={tgt['NDCG@10']:.2f}%")
        print(bar)

    bundle = load_dataset(dataset_name, data_path)

    server = ServerFedGNN(
        n_items    = bundle.n_items,
        embed_dim  = hp['embed_dim'],
        train_dict = bundle.train_dict,
        device     = device,
        n_layers   = hp['n_gnn_layers']
    )

    clients = {}
    sizes   = {}
    for uid, items in bundle.train_dict.items():
        if len(items) < 1:
            continue
        clients[uid] = ClientFedGNN(
            uid         = uid,
            train_items = items,
            n_items     = bundle.n_items,
            embed_dim   = hp['embed_dim'],
            device      = device,
            n_layers    = hp['n_gnn_layers'],
        )
        sizes[uid] = len(items)

    all_ids = list(clients.keys())

    if verbose:
        print(f"  Clients: {len(clients)}")
        print(bar)
        print(f"\n  {'Round':>6} | {'Loss':>8} | {'HR@10':>7} | {'NDCG@10':>8} | {'GExp':>5} | {'Time':>6}")
        print(f"  {'-'*55}")

    best_hr, best_ndcg, best_rnd = 0.0, 0.0, 0
    log = []
    round_times = []
    graph_expanded = False

    for rnd in range(1, hp['n_rounds'] + 1):
        t0 = time.time()

        if rnd > hp['warmup_rounds'] and not graph_expanded:
            server.run_graph_expansion(clients, max_neigh=hp['max_neigh'])
            for uid, client in clients.items():
                neigh_embs = server.get_neigh_embeddings(uid, clients)
                client.set_neigh_embeddings(neigh_embs)
            graph_expanded = True
            if verbose:
                print(f"  [Round {rnd}] Graph expansion done. Neighbours frozen.")

        sel_ids = server.select_clients(all_ids, hp['clients_per_round'])
        
        g_m_list = []
        g_e_list = []
        losses = []

        E_global = server.get_embeddings()
        gat_state = server.get_gat_state()

        for uid in sel_ids:
            g_m, g_e, loss = clients[uid].local_train(
                E_global         = E_global,
                global_gat_state = gat_state,
                lr_user          = hp['lr_user'],
                weight_decay     = hp['weight_decay'],
                pseudo_m         = hp['pseudo_m'],
                clip_norm        = hp['clip_norm'],
                laplace_lambda   = hp['laplace_lambda']
            )
            if g_m is not None:
                g_m_list.append(g_m)
                g_e_list.append(g_e)
                losses.append(loss)

        server.aggregate_gradients(
            selected_ids = sel_ids,
            g_m_list     = g_m_list,
            g_e_list     = g_e_list,
            sizes        = sizes,
            lr_item      = hp['lr_item'],
            lr_model     = hp['lr_model']
        )

        avg_loss = sum(losses) / max(len(losses), 1)
        dt = time.time() - t0
        round_times.append(dt)

        if rnd % hp['eval_every'] == 0 or rnd == 1 or rnd == hp['n_rounds']:
            metrics = evaluate(clients, server, bundle.test_dict, bundle.neg_dict, k)
            hr   = metrics[f'HR@{k}']
            ndcg = metrics[f'NDCG@{k}']

            if hr > best_hr:
                best_hr, best_ndcg, best_rnd = hr, ndcg, rnd

            if verbose:
                marker   = " *" if rnd == best_rnd else ""
                gexp_tag = "YES" if graph_expanded else "no "
                print(f"  {rnd:>6} | {avg_loss:>8.4f} | "
                      f"{hr*100:>6.2f}% | {ndcg*100:>7.2f}% | "
                      f"{gexp_tag} | {dt:>4.1f}s{marker}")

            log.append({
                'round':          rnd,
                'loss':           round(avg_loss, 5),
                f'HR@{k}':        round(hr * 100, 3),
                f'NDCG@{k}':      round(ndcg * 100, 3),
                'graph_expanded': graph_expanded,
                'round_time_s':   round(dt, 2),
            })

    total_wall_s = time.time() - t_total_start
    total_wall_m = total_wall_s / 60.0
    avg_round_s  = sum(round_times) / max(len(round_times), 1)

    tgt = FEDPCL_TARGETS.get(dataset_name, {})
    if verbose:
        print(f"\n{bar}")
        print(f"  RESULT  ({dataset_name.upper()})")
        print(f"  Best HR@{k}:          {best_hr*100:.2f}%  (round {best_rnd})")
        print(f"  Best NDCG@{k}:        {best_ndcg*100:.2f}%")
        print(f"  Total time:           {total_wall_m:.1f} min")
        if tgt:
            print(f"  vs FedPCL: HR@10 {best_hr*100-tgt['HR@10']:+.2f}%")
        print(bar)

    log_path = f'results/fedgnn_log_{dataset_name}.json'
    with open(log_path, 'w') as f:
        json.dump({'best_hr': round(best_hr * 100, 3), 'log': log}, f, indent=2)

    return {'HR@10': best_hr, 'NDCG@10': best_ndcg}
