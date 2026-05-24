"""
run_multiseed.py
════════════════
Run FedPCL training over multiple random seeds for reproducibility.
Computes mean ± std of HR@10 and NDCG@10 across all runs — exactly
the 5-run average the paper reports in Table I.

Works with Stage 4 OR Stage 5.  Just pass --stage 4 or --stage 5.

Usage:
  # 5 seeds, Stage 5, ML100K (paper-style reproducibility):
  python run_multiseed.py \\
      --stage 5 \\
      --dataset ml100k \\
      --data_path u.data \\
      --seeds 42 123 456 789 1234 \\
      --n_rounds 400 \\
      --local_epochs 10 \\
      --tau 0.2 \\
      --beta1 0.1 \\
      --drop_rate 0.3 \\
      --max_neigh 20

  # 5 seeds, Stage 4, Steam (no LDP):
  python run_multiseed.py \\
      --stage 4 \\
      --dataset steam \\
      --data_path steam_processed.json \\
      --seeds 42 123 456 789 1234 \\
      --n_rounds 400 \\
      --local_epochs 10 \\
      --tau 0.2

  # Quick 3-seed test run (fewer rounds):
  python run_multiseed.py \\
      --stage 5 \\
      --dataset ml100k \\
      --data_path u.data \\
      --seeds 42 123 456 \\
      --n_rounds 200

Output:
  - Per-seed logs saved as: stage{N}_log_{dataset}_seed{S}.json
  - Final summary table printed to console
  - Summary also saved as: multiseed_results_{stage}_{dataset}.json
"""

import argparse
import json
import math
import os
import random
import subprocess
import sys
import time

import numpy as np
import torch


# ══════════════════════════════════════════════════════════════════════════════
PAPER_TARGETS = {
    'steam':     {'HR@10': 80.36, 'NDCG@10': 65.55},
    'ml100k':    {'HR@10': 63.81, 'NDCG@10': 45.03},
    'ml1m':      {'HR@10': 62.86, 'NDCG@10': 44.12},
    'filmtrust': {'HR@10': 16.81, 'NDCG@10':  8.61},
    'amazon':    {'HR@10': 34.04, 'NDCG@10': 22.93},
}


# ══════════════════════════════════════════════════════════════════════════════
def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def run_single_seed(args, seed: int, run_idx: int, n_runs: int) -> dict:
    """
    Run one complete training for a given seed.
    Imports the train function directly (same process, re-seeded each run).

    Returns dict with 'best_hr', 'best_ndcg', 'best_round'.
    """
    bar = "-" * 60
    print(f"\n{bar}")
    print(f"  RUN {run_idx}/{n_runs}  |  seed={seed}  |  "
          f"stage={args.stage}  |  dataset={args.dataset.upper()}")
    print(bar)

    # Set seed before every import/execution for reproducibility
    set_seed(seed)

    # ── Hyperparameter dict (same shape as train_stage*.py builds) ────────────
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
        'save_emb_rounds':   [],   # no embedding saving during multi-seed runs
    }

    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')

    if args.stage == 5:
        use_ldp = not args.no_ldp
        hp['use_ldp']        = use_ldp
        hp['clip_sigma']     = args.clip_sigma
        hp['lambda_laplace'] = args.lambda_laplace

        from core.federated_core_stage5 import train_stage5
        result = train_stage5(
            dataset_name = args.dataset,
            data_path    = args.data_path,
            hparams      = hp,
            device       = device,
            verbose      = True,
        )

    elif args.stage == 4:
        from core.federated_core_stage4 import train_stage4
        result = train_stage4(
            dataset_name = args.dataset,
            data_path    = args.data_path,
            hparams      = hp,
            device       = device,
            verbose      = True,
        )

    else:
        raise ValueError(f"Unsupported stage: {args.stage}. Use 4 or 5.")

    # ── Save per-seed log ─────────────────────────────────────────────────────
    log_path = f'stage{args.stage}_log_{args.dataset}_seed{seed}.json'

    # Rename the log that train_stage* already saved
    auto_log = f'results/stage{args.stage}_log_{args.dataset}.json'
    if os.path.exists(auto_log):
        os.rename(auto_log, f'results/{log_path}')
        log_path  = f'results/stage{args.stage}_log_{args.dataset}_seed{seed}.json'

    return {
        'seed':        seed,
        'best_hr':     result.get(f'HR@10',   result.get('best_hr',   0.0)),
        'best_ndcg':   result.get(f'NDCG@10', result.get('best_ndcg', 0.0)),
        'best_round':  result.get('best_round', 0),
        'log_path':    log_path,
    }


# ══════════════════════════════════════════════════════════════════════════════
def print_summary(all_results: list, args):
    """Print final mean ± std table matching paper Table I format."""
    hrs   = [r['best_hr']   for r in all_results]
    ndcgs = [r['best_ndcg'] for r in all_results]
    k     = 10

    mean_hr   = float(np.mean(hrs))
    std_hr    = float(np.std(hrs,  ddof=1)) if len(hrs)   > 1 else 0.0
    mean_ndcg = float(np.mean(ndcgs))
    std_ndcg  = float(np.std(ndcgs, ddof=1)) if len(ndcgs) > 1 else 0.0

    tgt = PAPER_TARGETS.get(args.dataset, {})

    bar = "=" * 65
    print(f"\n{bar}")
    print(f"  MULTI-SEED RESULTS — Stage {args.stage} — {args.dataset.upper()}")
    print(f"  Seeds: {[r['seed'] for r in all_results]}")
    print(bar)

    # Per-seed breakdown
    print(f"\n  {'Seed':>6} | {'HR@10':>8} | {'NDCG@10':>9} | {'Best Rnd':>9}")
    print(f"  {'-'*42}")
    for r in all_results:
        print(f"  {r['seed']:>6} | {r['best_hr']:>7.3f}% | "
              f"{r['best_ndcg']:>8.3f}% | {r['best_round']:>9}")

    print(f"  {'-'*42}")
    print(f"  {'Mean':>6} | {mean_hr:>7.3f}% | {mean_ndcg:>8.3f}%")
    print(f"  {'Std':>6} | {std_hr:>7.3f}% | {std_ndcg:>8.3f}%")
    print(f"  {'Final':>6} | {mean_hr:.2f}±{std_hr:.2f}% | "
          f"{mean_ndcg:.2f}±{std_ndcg:.2f}%")

    if tgt:
        hr_gap   = mean_hr   - tgt['HR@10']
        ndcg_gap = mean_ndcg - tgt['NDCG@10']
        print(f"\n  Paper target:  HR@10={tgt['HR@10']:.2f}%   NDCG@10={tgt['NDCG@10']:.2f}%")
        print(f"  Our mean:      HR@10={mean_hr:.2f}%   NDCG@10={mean_ndcg:.2f}%")
        print(f"  Gap:           HR@10={hr_gap:+.2f}%   NDCG@10={ndcg_gap:+.2f}%")

    print(bar)

    return {
        'stage':      args.stage,
        'dataset':    args.dataset,
        'seeds':      [r['seed'] for r in all_results],
        'per_seed':   all_results,
        'mean_hr':    round(mean_hr,   3),
        'std_hr':     round(std_hr,    3),
        'mean_ndcg':  round(mean_ndcg, 3),
        'std_ndcg':   round(std_ndcg,  3),
        'summary':    f"HR@10={mean_hr:.2f}±{std_hr:.2f}%  "
                      f"NDCG@10={mean_ndcg:.2f}±{std_ndcg:.2f}%",
    }


# ══════════════════════════════════════════════════════════════════════════════
def parse_args():
    parser = argparse.ArgumentParser(
        description='Run FedPCL over multiple seeds — reproducibility study',
        formatter_class=argparse.RawTextHelpFormatter,
    )

    # ── Core ──────────────────────────────────────────────────────────────────
    parser.add_argument('--stage',   type=int, default=5, choices=[4, 5],
                        help='Stage to run: 4 (no LDP) or 5 (with LDP)')
    parser.add_argument('--dataset', type=str, default='ml100k',
                        choices=['steam','ml100k','ml1m','filmtrust','amazon'])
    parser.add_argument('--data_path', type=str, required=True,
                        help='Path to the dataset file')
    parser.add_argument('--seeds',   type=int, nargs='+',
                        default=[42, 123, 456, 789, 1234],
                        help='List of seeds. Default: 42 123 456 789 1234')

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
    parser.add_argument('--beta1',         type=float, default=0.1)
    parser.add_argument('--lam',           type=float, default=1.0)
    parser.add_argument('--tau',           type=float, default=0.2)
    parser.add_argument('--drop_rate',     type=float, default=0.3)
    parser.add_argument('--warmup_rounds', type=int,   default=20)
    parser.add_argument('--max_neigh',     type=int,   default=20)

    # ── LDP (Stage 5 only) ────────────────────────────────────────────────────
    parser.add_argument('--no_ldp',         action='store_true')
    parser.add_argument('--clip_sigma',     type=float, default=0.1)
    parser.add_argument('--lambda_laplace', type=float, default=0.001)

    # ── Optimisation ──────────────────────────────────────────────────────────
    parser.add_argument('--lr_item',      type=float, default=0.1)
    parser.add_argument('--lr_user',      type=float, default=0.001)
    parser.add_argument('--weight_decay', type=float, default=1e-6)
    parser.add_argument('--eval_every',   type=int,   default=10)

    return parser.parse_args()


# ══════════════════════════════════════════════════════════════════════════════
def main():
    args = parse_args()

    print(f"\n{'='*65}")
    print(f"  FedPCL Multi-Seed Reproducibility Study")
    print(f"  Stage {args.stage}  |  Dataset: {args.dataset.upper()}")
    print(f"  Seeds: {args.seeds}  ({len(args.seeds)} runs)")
    print(f"  Rounds: {args.n_rounds}  |  Epochs: {args.local_epochs}")
    if args.stage == 5 and not args.no_ldp:
        eps = args.clip_sigma / args.lambda_laplace
        print(f"  LDP: σ={args.clip_sigma}  λ={args.lambda_laplace}  ε={eps:.1f}")
    else:
        print(f"  LDP: disabled")
    print(f"{'='*65}")

    t_start     = time.time()
    all_results = []

    for run_idx, seed in enumerate(args.seeds, 1):
        t0  = time.time()
        res = run_single_seed(args, seed, run_idx, len(args.seeds))
        dt  = time.time() - t0
        res['wall_time_min'] = round(dt / 60, 1)
        all_results.append(res)
        print(f"\n  ✓ Run {run_idx}/{len(args.seeds)} done  "
              f"HR@10={res['best_hr']:.3f}%  "
              f"NDCG@10={res['best_ndcg']:.3f}%  "
              f"({dt/60:.1f} min)")

    # ── Summary ───────────────────────────────────────────────────────────────
    summary = print_summary(all_results, args)
    summary['total_time_min'] = round((time.time() - t_start) / 60, 1)

    # Save summary JSON
    out_path = f'results/multiseed_results_stage{args.stage}_{args.dataset}.json'
    with open(out_path, 'w') as f:
        json.dump(summary, f, indent=2)
    print(f"\n  Summary → {out_path}")
    print(f"  Total time: {summary['total_time_min']} min")


if __name__ == '__main__':
    main()
