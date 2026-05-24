"""
train_stage3.py
═══════════════
Entry point for Stage 3: FedAvg + Clustering + Personalization.
The ONLY file you run.

Usage:
    python train_stage3.py --dataset steam --data_path steam_processed.json
    python train_stage3.py --dataset ml100k --data_path u.data
"""

import argparse
import os
import random
import numpy as np
import torch

from core.federated_core_stage3 import train_stage3, DATASET_PATHS

SEED = 42
torch.manual_seed(SEED); np.random.seed(SEED); random.seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)


def parse_args():
    parser = argparse.ArgumentParser(
        description='Stage 3: FedAvg + K-means Clustering + Personalization'
    )
    parser.add_argument('--dataset',           type=str,   default='steam',
                        choices=list(DATASET_PATHS.keys()))
    parser.add_argument('--data_path',         type=str,   default=None)
    parser.add_argument('--n_rounds',          type=int,   default=400)
    parser.add_argument('--clients_per_round', type=int,   default=128)
    parser.add_argument('--embed_dim',         type=int,   default=64)
    parser.add_argument('--n_gnn_layers',      type=int,   default=2)
    parser.add_argument('--local_epochs',      type=int,   default=10)
    parser.add_argument('--n_clusters',        type=int,   default=5)
    parser.add_argument('--mu1',               type=float, default=0.5)
    parser.add_argument('--mu2',               type=float, default=0.5)
    parser.add_argument('--cluster_every',     type=int,   default=10)
    parser.add_argument('--lr_item',           type=float, default=0.1)
    parser.add_argument('--lr_user',           type=float, default=0.001)
    parser.add_argument('--weight_decay',      type=float, default=1e-6)
    parser.add_argument('--eval_every',        type=int,   default=10)

    parser.add_argument('--seed', type=int, default=42,
                        help='Random seed')
    return parser.parse_args()


def main():
    args   = parse_args()
    # Set seed immediately after parsing args
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
        'n_clusters':        args.n_clusters,
        'mu1':               args.mu1,
        'mu2':               args.mu2,
        'cluster_every':     args.cluster_every,
        'lr_item':           args.lr_item,
        'lr_user':           args.lr_user,
        'weight_decay':      args.weight_decay,
        'eval_every':        args.eval_every,
        'top_k':             10,
    }

    train_stage3(args.dataset, data_path, hp, device, verbose=True)


if __name__ == '__main__':
    main()
