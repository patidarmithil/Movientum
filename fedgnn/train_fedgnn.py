"""
train_fedgnn.py
═══════════════
Entry point for FedGNN training. The ONLY file you run.

Usage:
    # Amazon (default)
    python train_fedgnn.py --dataset amazon --data_path data/amazon_processed.json

    # Other datasets
    python train_fedgnn.py --dataset ml100k --data_path data/u.data
    python train_fedgnn.py --dataset steam  --data_path data/steam_processed.json

    # Quick test (fewer rounds)
    python train_fedgnn.py --dataset amazon --data_path data/amazon_processed.json --n_rounds 50

    # Disable pseudo sampling (for ablation)
    python train_fedgnn.py --dataset amazon --data_path data/amazon_processed.json --pseudo_m 0
"""

import argparse
import os
import random
import numpy as np
import torch

from core.federated_core_fedgnn import train_fedgnn, DATASET_PATHS

SEED = 42
torch.manual_seed(SEED)
np.random.seed(SEED)
random.seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)


def parse_args():
    parser = argparse.ArgumentParser(
        description='FedGNN: Federated Graph Neural Network for Recommendation'
    )
    parser.add_argument('--dataset',           type=str,   default='amazon',
                        choices=list(DATASET_PATHS.keys()))
    parser.add_argument('--data_path',         type=str,   default=None)

    # Architecture
    parser.add_argument('--embed_dim',         type=int,   default=64)
    parser.add_argument('--n_gnn_layers',      type=int,   default=2)

    # Federated
    parser.add_argument('--n_rounds',          type=int,   default=400)
    parser.add_argument('--clients_per_round', type=int,   default=128)
    parser.add_argument('--local_epochs',      type=int,   default=5)

    # Graph expansion
    parser.add_argument('--warmup_rounds',     type=int,   default=20)
    parser.add_argument('--max_neigh',         type=int,   default=20)

    # Privacy
    parser.add_argument('--pseudo_m',          type=int,   default=100)
    parser.add_argument('--clip_norm',         type=float, default=1.0)
    parser.add_argument('--laplace_lambda',    type=float, default=0.01)

    # Optimisation
    parser.add_argument('--lr_item',           type=float, default=0.1)
    parser.add_argument('--lr_user',           type=float, default=0.01)
    parser.add_argument('--lr_model',          type=float, default=0.01)
    parser.add_argument('--weight_decay',      type=float, default=1e-6)

    # Evaluation
    parser.add_argument('--eval_every',        type=int,   default=10)

    # Misc
    parser.add_argument('--seed',              type=int,   default=42)
    return parser.parse_args()


def main():
    args = parse_args()

    # Seed
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

    hp = {
        'embed_dim':         args.embed_dim,
        'n_gnn_layers':      args.n_gnn_layers,
        'n_rounds':          args.n_rounds,
        'clients_per_round': args.clients_per_round,
        'local_epochs':      args.local_epochs,
        'warmup_rounds':     args.warmup_rounds,
        'max_neigh':         args.max_neigh,
        'pseudo_m':          args.pseudo_m,
        'clip_norm':         args.clip_norm,
        'laplace_lambda':    args.laplace_lambda,
        'lr_item':           args.lr_item,
        'lr_user':           args.lr_user,
        'lr_model':          args.lr_model,
        'weight_decay':      args.weight_decay,
        'eval_every':        args.eval_every,
        'top_k':             10,
    }

    train_fedgnn(args.dataset, data_path, hp, device, verbose=True)


if __name__ == '__main__':
    main()
