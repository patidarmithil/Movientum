"""
train_stage5.py
═══════════════
Entry point for Stage 5: FedPCL + Local Differential Privacy.
The ONLY file you run.

Usage:
    # Default LDP settings (σ=0.1, λ=0.001)
    python train_stage5.py --dataset steam --data_path steam_processed.json

    # Stronger privacy (smaller λ = more noise)
    python train_stage5.py --dataset steam --data_path steam_processed.json \\
        --lambda_laplace 0.0001

    # Disable LDP entirely (same as Stage 4, useful for comparison)
    python train_stage5.py --dataset steam --data_path steam_processed.json \\
        --no_ldp

    # Save embeddings at round 1 and 400 for KDE comparison plot:
    python train_stage5.py --dataset ml100k --data_path u.data \\
        --save_emb_rounds 1 400

    # Save embeddings at multiple rounds (for animation / evolution plot):
    python train_stage5.py --dataset ml100k --data_path u.data \\
        --save_emb_rounds 1 100 200 300 400

Privacy budget reference:
    ε = clip_sigma / lambda_laplace
    ε = 0.1 / 0.001 = 100   (default — loose privacy)
    ε = 0.1 / 0.01  = 10    (moderate privacy)
    ε = 0.1 / 0.0001 = 1000 (very loose)
    Smaller ε = stronger privacy = larger performance drop
"""

import argparse
import os
import random
import numpy as np
import torch

from core.federated_core_stage5 import train_stage5, DATASET_PATHS

SEED = 42
torch.manual_seed(SEED)
np.random.seed(SEED)
random.seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)


def parse_args():
    parser = argparse.ArgumentParser(
        description='Stage 5: FedPCL + Local Differential Privacy'
    )
    # ── Data ──────────────────────────────────────────────────────────────────
    parser.add_argument('--dataset',   type=str, default='steam',
                        choices=list(DATASET_PATHS.keys()))
    parser.add_argument('--data_path', type=str, default=None)

    # ── Federated ─────────────────────────────────────────────────────────────
    parser.add_argument('--n_rounds',          type=int,   default=400)
    parser.add_argument('--clients_per_round', type=int,   default=128)
    parser.add_argument('--local_epochs',      type=int,   default=10)

    # ── Architecture ──────────────────────────────────────────────────────────
    parser.add_argument('--embed_dim',    type=int, default=64)
    parser.add_argument('--n_gnn_layers', type=int, default=2)

    # ── Personalisation ───────────────────────────────────────────────────────
    parser.add_argument('--n_clusters',    type=int,   default=5)
    parser.add_argument('--mu1',           type=float, default=0.5)
    parser.add_argument('--mu2',           type=float, default=0.5)
    parser.add_argument('--cluster_every', type=int,   default=10)

    # ── Contrastive ───────────────────────────────────────────────────────────
    parser.add_argument('--beta1',          type=float, default=0.1)
    parser.add_argument('--lam',            type=float, default=1.0)
    parser.add_argument('--tau',            type=float, default=0.3)
    parser.add_argument('--drop_rate',      type=float, default=0.3)
    parser.add_argument('--warmup_rounds',  type=int,   default=20)
    parser.add_argument('--max_neigh',      type=int,   default=20)

    # ── LDP ───────────────────────────────────────────────────────────────────
    parser.add_argument('--no_ldp',          action='store_true',
                        help='Disable LDP (identical to Stage 4)')
    parser.add_argument('--clip_sigma',      type=float, default=0.1,
                        help='σ: per-coordinate clipping bound (default: 0.1)')
    parser.add_argument('--lambda_laplace',  type=float, default=0.001,
                        help='λ: Laplacian noise scale (default: 0.001)')

    # ── Optimisation ──────────────────────────────────────────────────────────
    parser.add_argument('--lr_item',      type=float, default=0.1)
    parser.add_argument('--lr_user',      type=float, default=0.001)
    parser.add_argument('--weight_decay', type=float, default=1e-6)
    parser.add_argument('--eval_every',   type=int,   default=10)

    # ── Embedding saving for KDE (NEW) ────────────────────────────────────────
    # Pass any number of round numbers to save E_global snapshots.
    # The final round is ALWAYS saved automatically regardless of this flag.
    # Example: --save_emb_rounds 1 100 200 300 400
    parser.add_argument('--save_emb_rounds', type=int, nargs='*', default=[],
                        metavar='ROUND',
                        help='Rounds at which to save item embeddings (.npy) '
                             'for KDE visualisation. Final round always saved. '
                             'Example: --save_emb_rounds 1 100 200 300 400')

    # ── Seed ──────────────────────────────────────────────────────────────────
    parser.add_argument('--seed', type=int, default=42,
                        help='Random seed')

    return parser.parse_args()


def main():
    args = parse_args()

    # Set seed immediately
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    random.seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    print(f"[Seed] {args.seed}")
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f"[Device] {device}")

    data_path = args.data_path or DATASET_PATHS.get(args.dataset)
    if not data_path or not os.path.exists(data_path):
        print(f"Error: data file not found. Use --data_path <path>")
        return

    use_ldp = not args.no_ldp
    if use_ldp:
        epsilon = args.clip_sigma / args.lambda_laplace
        print(f"[LDP] σ={args.clip_sigma}  λ={args.lambda_laplace}  ε={epsilon:.1f}")
    else:
        print(f"[LDP] Disabled")

    save_rounds = sorted(set(args.save_emb_rounds or []))
    if save_rounds:
        print(f"[Emb] Will save embeddings at rounds: {save_rounds} + final")

    hp = {
        'embed_dim':         args.embed_dim,
        'n_gnn_layers':      args.n_gnn_layers,
        'n_rounds':          args.n_rounds,
        'clients_per_round': args.clients_per_round,
        'local_epochs':      args.local_epochs,
        'n_clusters':        args.n_clusters,
        'mu1':               args.mu1,
        'mu2':               args.mu2,
        'cluster_every':     args.cluster_every,
        'beta1':             args.beta1,
        'lam':               args.lam,
        'tau':               args.tau,
        'drop_rate':         args.drop_rate,
        'warmup_rounds':     args.warmup_rounds,
        'max_neigh':         args.max_neigh,
        'max_items_neigh':   10,
        'lr_item':           args.lr_item,
        'lr_user':           args.lr_user,
        'weight_decay':      args.weight_decay,
        'eval_every':        args.eval_every,
        'top_k':             10,
        # LDP
        'use_ldp':           use_ldp,
        'clip_sigma':        args.clip_sigma,
        'lambda_laplace':    args.lambda_laplace,
        # Embedding saving
        'save_emb_rounds':   save_rounds,
    }

    train_stage5(args.dataset, data_path, hp, device, verbose=True)


if __name__ == '__main__':
    main()
