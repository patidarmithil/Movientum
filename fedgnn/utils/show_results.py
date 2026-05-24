"""
show_results2.py
════════════════
Reads saved training logs and displays a clean results summary.
No model re-running needed.

CHANGES vs original:
  1. DATASET STATISTICS shown directly from log (no patch_logs.py needed).
     New training runs save bundle_stats automatically. Old logs without
     it fall back to paper stats with a note.

  2. SCORE DEVIATION shown as both absolute gap AND relative % of paper value.
     e.g. HR@10: ours=54.19%  paper=63.81%  gap=-9.62%  (rel=-15.1% of paper)

  3. LOSS RANGE shown in training curve section with expected convergence band.

  4. Loss curve added to --plot output (3 panels: HR, NDCG, Loss).

Usage:
    python show_results2.py --file stage4_log_ml100k.json
    python show_results2.py --file stage4_log_ml100k.json --plot
    python show_results2.py --file log1.json log2.json log3.json
    python show_results2.py                              # auto-find all logs
    python show_results2.py --dataset ml100k --stage 4
"""

import json
import os
import argparse

LOG_PATTERNS = {
    1: 'central_log_{dataset}.json',
    2: 'fedavg_log_{dataset}.json',
    3: 'stage3_log_{dataset}.json',
    4: 'stage4_log_{dataset}.json',
    5: 'stage5_log_{dataset}.json',
}

STAGE_NAMES = {
    1: 'Stage 1 — Centralized LightGCN',
    2: 'Stage 2 — FedAvg',
    3: 'Stage 3 — FedAvg + Clustering',
    4: 'Stage 4 — FedPCL (Full)',
    5: 'Stage 5 — FedPCL + LDP',
}

DATASETS = ['steam', 'ml100k', 'ml1m', 'filmtrust', 'amazon']

# Paper dataset statistics (Table I, FedPCL paper)
PAPER_DATASET_STATS = {
    'steam':     {'users': 3753,  'items': 5134,  'interactions': 114713},
    'ml100k':    {'users': 943,   'items': 1682,  'interactions': 100000},
    'ml1m':      {'users': 6040,  'items': 3706,  'interactions': 1000209},
    'filmtrust': {'users': 1110,  'items': 1775,  'interactions': 20453},
    'amazon':    {'users': 1435,  'items': 1522,  'interactions': 35931},
}

PAPER_TARGETS = {
    1: {'steam':(80.16,66.03),'ml100k':(64.31,45.57),'ml1m':(64.53,46.78),
        'filmtrust':(21.85,10.53),'amazon':(38.83,26.74)},
    2: {'steam':(71.21,50.22),'ml100k':(42.70,23.87),'ml1m':(44.70,24.90),
        'filmtrust':(10.81,4.83),'amazon':(26.53,14.53)},
    3: {'steam':(76.61,62.63),'ml100k':(61.87,43.51),'ml1m':(61.31,42.83),
        'filmtrust':(15.12,8.01),'amazon':(32.64,21.39)},
    4: {'steam':(80.36,65.55),'ml100k':(63.81,45.03),'ml1m':(62.86,44.12),
        'filmtrust':(16.81,8.61),'amazon':(34.04,22.93)},
    5: {'steam':(80.36,65.55),'ml100k':(63.81,45.03),'ml1m':(62.86,44.12),
        'filmtrust':(16.81,8.61),'amazon':(34.04,22.93)},
}

# Expected total loss at convergence per dataset
LOSS_RANGES = {
    'steam':     (0.01, 0.08),
    'ml100k':    (0.45, 0.58),
    'ml1m':      (0.40, 0.55),
    'filmtrust': (0.08, 0.20),
    'amazon':    (0.25, 0.38),
}

HP_GROUPS = {
    'Architecture': [
        ('embed_dim',        'Embedding dimension d'),
        ('n_gnn_layers',     'GNN layers K'),
    ],
    'Federated Training': [
        ('n_rounds',         'Communication rounds T'),
        ('clients_per_round','Clients per round'),
        ('local_epochs',     'Local epochs E'),
    ],
    'Learning Rates': [
        ('lr_item',          'Item SGD learning rate η'),
        ('lr_user',          'User Adam learning rate'),
        ('weight_decay',     'L2 regularisation β₂'),
    ],
    'Personalisation (Stage 3+)': [
        ('n_clusters',       'K-means clusters K'),
        ('mu1',              'Cluster model weight μ₁'),
        ('mu2',              'Global model weight μ₂'),
        ('cluster_every',    'Re-cluster every N rounds'),
    ],
    'Contrastive Learning (Stage 4+)': [
        ('beta1',            'CL loss weight β₁'),
        ('lam',              'Item CL weight λ'),
        ('tau',              'Temperature τ'),
        ('drop_rate',        'Item augmentation dropout'),
        ('warmup_rounds',    'Warmup rounds (no CL)'),
        ('max_neigh',        'Max 2-hop neighbours'),
        ('max_items_neigh',  'Max items per neighbour'),
    ],
    'Local Differential Privacy (Stage 5+)': [
        ('use_ldp',          'LDP enabled'),
        ('clip_sigma',       'Clipping bound σ'),
        ('lambda_laplace',   'Laplacian noise scale λ'),
    ],
    'Evaluation': [
        ('top_k',            'Top-K for HR and NDCG'),
        ('eval_every',       'Evaluate every N rounds'),
    ],
}

PAPER_FIXED = {
    'embed_dim': 64, 'n_gnn_layers': 2, 'n_rounds': 400,
    'clients_per_round': 128, 'lr_item': 0.1, 'weight_decay': 1e-6,
    'n_clusters': 5, 'mu1': 0.5, 'mu2': 0.5,
    'beta1': 0.1, 'lam': 1.0, 'tau': 0.3, 'warmup_rounds': 20, 'top_k': 10,
}


# ══════════════════════════════════════════════════════════════════════════════
def detect_stage_dataset(filepath, data):
    fname   = os.path.basename(filepath).lower()
    dataset = data.get('dataset', None)
    if not dataset:
        for ds in DATASETS:
            if ds in fname:
                dataset = ds
                break
    stage = None
    if 'central' in fname or 'stage1' in fname:  stage = 1
    elif 'fedavg' in fname or 'stage2' in fname: stage = 2
    elif 'stage3' in fname:                       stage = 3
    elif 'stage4' in fname:                       stage = 4
    elif 'stage5' in fname:                       stage = 5
    return stage, dataset


def find_logs_auto(stage=None, dataset=None):
    found    = []
    stages   = [stage]   if stage   else [1, 2, 3, 4, 5]
    datasets = [dataset] if dataset else DATASETS
    for s in stages:
        for ds in datasets:
            fname = LOG_PATTERNS[s].format(dataset=ds)
            # Check both results/ subdir and current dir
            for candidate in [os.path.join('results', fname), fname]:
                if os.path.exists(candidate):
                    found.append(candidate)
                    break
    return found


def load_log(filepath):
    with open(filepath) as f:
        return json.load(f)


def format_value(val):
    if isinstance(val, float):
        if val == int(val) and abs(val) < 1000:
            return str(int(val))
        return f'{val:.6g}'
    if isinstance(val, bool):
        return 'Yes' if val else 'No'
    return str(val)


def flag_deviation(key, val):
    if key not in PAPER_FIXED:
        return ''
    paper_val = PAPER_FIXED[key]
    if isinstance(val, float) and isinstance(paper_val, float):
        if abs(val - paper_val) > 1e-9:
            return f'  <- paper: {format_value(paper_val)}'
    elif val != paper_val:
        return f'  <- paper: {format_value(paper_val)}'
    return ''


# ══════════════════════════════════════════════════════════════════════════════
def print_dataset_stats(bundle_stats, dataset):
    """
    Print DataBundle statistics.
    Uses bundle_stats from the log (saved by new training code).
    Falls back to paper stats if log was generated before this feature.
    """
    print(f"\n  DATASET STATISTICS:")
    paper = PAPER_DATASET_STATS.get(dataset, {}) if dataset else {}

    def match_sym(ours, theirs):
        if theirs == '?' or ours == '?': return '?'
        return 'OK' if ours == theirs else 'DIFF'

    if bundle_stats:
        # New format — stats captured at training time
        n_users = bundle_stats.get('n_users', '?')
        n_items = bundle_stats.get('n_items', '?')
        n_total = bundle_stats.get('n_total', '?')
        n_train = bundle_stats.get('n_train', '?')
        n_test  = bundle_stats.get('n_test',  '?')
        density = bundle_stats.get('density', '?')
        kcore   = bundle_stats.get('kcore',   '?')
        split   = bundle_stats.get('split',   '?')

        p_users = paper.get('users',        '?')
        p_items = paper.get('items',        '?')
        p_total = paper.get('interactions', '?')

        print(f"  {'Field':<30} {'Yours':>12}  {'Paper':>12}  Match")
        print(f"  {'-'*60}")
        print(f"  {'Users':<30} {str(n_users):>12}  {str(p_users):>12}  "
              f"{match_sym(n_users, p_users)}")
        print(f"  {'Items':<30} {str(n_items):>12}  {str(p_items):>12}  "
              f"{match_sym(n_items, p_items)}")
        print(f"  {'Total interactions':<30} {str(n_total):>12}  {str(p_total):>12}  "
              f"{match_sym(n_total, p_total)}")
        print(f"  {'Train interactions':<30} {str(n_train):>12}  {'(excl. test)':>12}")
        print(f"  {'Test interactions':<30} {str(n_test):>12}  {'1 per user':>12}")
        print(f"  {'Density (%)':<30} {str(density):>12}")
        print(f"  {'K-core filtering':<30} {str(kcore):>12}")
        print(f"  {'Split method':<30} {str(split):>12}")

        mismatches = []
        if p_users != '?' and n_users != p_users:
            mismatches.append(f"Users: yours={n_users}, paper={p_users}")
        if p_items != '?' and n_items != p_items:
            mismatches.append(f"Items: yours={n_items}, paper={p_items}")
        if p_total != '?' and n_total != '?' and n_total != p_total:
            mismatches.append(f"Interactions: yours={n_total}, paper={p_total}")
        if mismatches:
            print(f"\n  WARNING — Data mismatch detected:")
            for m in mismatches:
                print(f"    {m}")
        else:
            print(f"\n  Dataset matches paper exactly.")

    elif paper:
        # Old log — show paper stats as reference with note
        print(f"  (Log predates auto-capture. Showing paper reference values.)")
        print(f"  {'Field':<30} {'Paper value':>14}")
        print(f"  {'-'*46}")
        print(f"  {'Users':<30} {paper.get('users','?'):>14}")
        print(f"  {'Items':<30} {paper.get('items','?'):>14}")
        print(f"  {'Total interactions':<30} {paper.get('interactions','?'):>14}")
        print(f"  Re-run training to capture your actual dataset stats.")
    else:
        print(f"  No statistics available.")


# ══════════════════════════════════════════════════════════════════════════════
def print_hyperparameters(hp, stage):
    if not hp:
        print("  No hyperparameters found in log.")
        return

    print(f"\n  HYPERPARAMETERS USED:")

    for group_name, params in HP_GROUPS.items():
        if 'Stage 3' in group_name and stage and stage < 3: continue
        if 'Stage 4' in group_name and stage and stage < 4: continue
        if 'Stage 5' in group_name and stage and stage < 5: continue

        group_params = [(k, desc) for k, desc in params if k in hp]
        if not group_params:
            continue

        print(f"\n  +-- {group_name}")
        for key, desc in group_params:
            val     = hp[key]
            val_str = format_value(val)
            note    = flag_deviation(key, val)
            print(f"  |   {desc:<35} {val_str}{note}")
        print(f"  +--")

    known_keys = {k for params in HP_GROUPS.values() for k, _ in params}
    extra = {k: v for k, v in hp.items() if k not in known_keys}
    # Filter out save_emb_rounds from "Other" to reduce noise
    extra = {k: v for k, v in extra.items() if k != 'save_emb_rounds'}
    if extra:
        print(f"\n  +-- Other")
        for k, v in extra.items():
            print(f"  |   {k:<35} {format_value(v)}")
        print(f"  +--")

    deviations = [k for k in hp if flag_deviation(k, hp[k])]
    if deviations:
        print(f"\n  NOTE: {len(deviations)} parameter(s) differ from paper defaults:")
        for k in deviations:
            print(f"    {k} = {format_value(hp[k])}  "
                  f"(paper: {format_value(PAPER_FIXED[k])})")
    else:
        print(f"\n  All hyperparameters match paper defaults.")


# ══════════════════════════════════════════════════════════════════════════════
def print_summary(filepath, data, stage, dataset):
    bar = "=" * 65
    stage_label   = STAGE_NAMES.get(stage, f'Stage {stage}') if stage else 'Unknown Stage'
    dataset_label = dataset.upper() if dataset else 'Unknown Dataset'

    print(f"\n{bar}")
    print(f"  {stage_label}  --  {dataset_label}")
    print(f"  File: {os.path.basename(filepath)}")
    print(bar)

    best_hr   = data.get('best_hr',    0)
    best_ndcg = data.get('best_ndcg',  0)
    best_rnd  = data.get('best_round', '?')
    epsilon   = data.get('epsilon',    None)

    print(f"\n  RESULTS:")
    print(f"  {'Best HR@10':<30} {best_hr:.3f}%   (round {best_rnd})")
    print(f"  {'Best NDCG@10':<30} {best_ndcg:.3f}%")
    if epsilon is not None:
        if epsilon == float('inf') or epsilon is None:
            print(f"  {'Privacy budget ε':<30} inf  (LDP disabled)")
        else:
            print(f"  {'Privacy budget ε = σ/λ':<30} {epsilon:.1f}")

    # ── Score deviation — absolute AND relative ───────────────────────────────
    tgt = PAPER_TARGETS.get(stage, {}).get(dataset) if (stage and dataset) else None
    if tgt:
        hr_abs   = best_hr   - tgt[0]
        ndcg_abs = best_ndcg - tgt[1]
        hr_rel   = hr_abs   / tgt[0] * 100 if tgt[0] else 0
        ndcg_rel = ndcg_abs / tgt[1] * 100 if tgt[1] else 0

        print(f"\n  COMPARISON TO PAPER:")
        print(f"  {'Metric':<10} {'Ours':>8}  {'Paper':>8}  "
              f"{'Abs gap':>9}  {'Rel gap':>10}")
        print(f"  {'-'*54}")
        print(f"  {'HR@10':<10} {best_hr:>7.2f}%  {tgt[0]:>7.2f}%"
              f"  {hr_abs:>+8.2f}%  {hr_rel:>+9.1f}%")
        print(f"  {'NDCG@10':<10} {best_ndcg:>7.2f}%  {tgt[1]:>7.2f}%"
              f"  {ndcg_abs:>+8.2f}%  {ndcg_rel:>+9.1f}%")

        if hr_abs >= -2.0:   status = "✓ Matches paper (within 2%)"
        elif hr_abs >= -5.0: status = "~ Close to paper (within 5%)"
        else:                status = "✗ Below paper (gap > 5%)"
        print(f"\n  Status: {status}")

    # ── Dataset statistics (inline, no patch_logs needed) ────────────────────
    bundle_stats = data.get('bundle_stats', None)
    print_dataset_stats(bundle_stats, dataset)

    # ── Hyperparameters ───────────────────────────────────────────────────────
    hp = data.get('hparams', {})
    print_hyperparameters(hp, stage)

    # ── Training curve with loss range ───────────────────────────────────────
    log = data.get('log', [])
    if log:
        exp_lo, exp_hi = LOSS_RANGES.get(dataset, (None, None))
        loss_summary   = data.get('loss_summary', {})
        final_loss     = loss_summary.get('final', log[-1].get('loss', 0))
        in_range       = loss_summary.get('in_range', None)

        print(f"\n  TRAINING CURVE  (sampled every ~10% of rounds):")
        if exp_lo is not None:
            print(f"  Expected convergence loss range: {exp_lo:.2f} – {exp_hi:.2f}")
        if in_range is not None:
            status_loss = "within range" if in_range else "OUTSIDE range"
            print(f"  Final loss: {final_loss:.5f}  ({status_loss})")

        print(f"\n  {'Round':>6}  {'HR@10':>7}  {'NDCG@10':>8}  {'Loss':>9}")
        print(f"  {'-'*38}")
        n       = len(log)
        step    = max(1, n // 10)
        indices = sorted(set(list(range(0, n, step)) + [n - 1]))
        for idx in indices:
            row  = log[idx]
            rnd  = row.get('round', '?')
            hr   = row.get('HR@10',   row.get('hr10',  0))
            ndcg = row.get('NDCG@10', row.get('ndcg10', 0))
            loss = row.get('loss', 0)
            mark = " *" if rnd == best_rnd else ""
            # Flag loss outside expected range
            if exp_lo is not None and not (exp_lo <= loss <= exp_hi * 1.5):
                loss_flag = " ↑" if loss > exp_hi * 1.5 else ""
            else:
                loss_flag = ""
            print(f"  {rnd:>6}  {hr:>6.2f}%  {ndcg:>7.2f}%  "
                  f"{loss:>9.5f}{loss_flag}{mark}")

        if exp_lo is not None:
            print(f"  (↑ = loss above expected range at this stage)")

    print(f"\n{bar}")


# ══════════════════════════════════════════════════════════════════════════════
def print_comparison_table(results):
    if len(results) < 2:
        return
    print("\n" + "=" * 80)
    print("  COMPARISON TABLE — all loaded results")
    print("=" * 80)
    print(f"  {'File':<38} {'HR@10':>7}  {'Abs gap':>8}  "
          f"{'Rel gap':>8}  {'NDCG@10':>8}  {'Round':>6}")
    print(f"  {'-'*75}")
    for filepath, data, stage, dataset in results:
        fname = os.path.basename(filepath)
        hr    = data.get('best_hr',    0)
        ndcg  = data.get('best_ndcg',  0)
        rnd   = data.get('best_round', '?')
        tgt   = PAPER_TARGETS.get(stage, {}).get(dataset) if (stage and dataset) else None
        if tgt:
            abs_gap = hr   - tgt[0]
            rel_gap = abs_gap / tgt[0] * 100 if tgt[0] else 0
            gap_str = f"{abs_gap:+.1f}%"
            rel_str = f"{rel_gap:+.1f}%"
        else:
            gap_str = "     —"
            rel_str = "     —"
        print(f"  {fname:<38} {hr:>6.2f}%  {gap_str:>8}  "
              f"{rel_str:>8}  {ndcg:>7.2f}%  {rnd:>6}")
    print("=" * 80)


# ══════════════════════════════════════════════════════════════════════════════
def plot_curves(results):
    try:
        import matplotlib.pyplot as plt
    except ImportError:
        print("\n  [Plot] matplotlib not installed. Run: pip install matplotlib")
        return

    # 3 panels: HR@10, NDCG@10, Loss
    fig, axes = plt.subplots(1, 3, figsize=(18, 5))
    fig.suptitle('FedPCL Training Curves', fontsize=14)
    colors = ['#e41a1c', '#377eb8', '#4daf4a', '#984ea3',
              '#ff7f00', '#a65628', '#f781bf', '#999999']

    for idx, (filepath, data, stage, dataset) in enumerate(results):
        log = data.get('log', [])
        if not log:
            continue
        label  = os.path.basename(filepath).replace('.json', '')
        color  = colors[idx % len(colors)]
        rounds = [r.get('round', 0) for r in log]
        hrs    = [r.get('HR@10',   r.get('hr10',  0)) for r in log]
        ndcgs  = [r.get('NDCG@10', r.get('ndcg10', 0)) for r in log]
        losses = [r.get('loss', 0) for r in log]

        axes[0].plot(rounds, hrs,   label=label, color=color, linewidth=1.8)
        axes[1].plot(rounds, ndcgs, label=label, color=color, linewidth=1.8)
        axes[2].plot(rounds, losses, label=label, color=color, linewidth=1.8)

        tgt = PAPER_TARGETS.get(stage, {}).get(dataset) if (stage and dataset) else None
        if tgt:
            axes[0].axhline(tgt[0], linestyle='--', color=color,
                            alpha=0.4, label=f'Paper ({label})')
            axes[1].axhline(tgt[1], linestyle='--', color=color, alpha=0.4)

        # Draw expected loss band on loss plot
        if dataset in LOSS_RANGES:
            lo, hi = LOSS_RANGES[dataset]
            axes[2].axhspan(lo, hi, alpha=0.08, color=color,
                            label=f'Expected ({label})')

    for ax, title in [(axes[0], 'HR@10 (%)'),
                      (axes[1], 'NDCG@10 (%)'),
                      (axes[2], 'Total Loss')]:
        ax.set_title(title)
        ax.set_xlabel('Round')
        ax.set_ylabel(title)
        ax.legend(fontsize=7)
        ax.grid(alpha=0.3)

    # Mark warmup end
    axes[2].axvline(20, linestyle=':', color='grey', alpha=0.6,
                    label='Warmup ends')

    plt.tight_layout()
    outfile = 'training_curves.png'
    plt.savefig(outfile, dpi=150, bbox_inches='tight')
    print(f"\n  [Plot] Saved → {outfile}")
    plt.show()


# ══════════════════════════════════════════════════════════════════════════════
def main():
    parser = argparse.ArgumentParser(
        description='Show FedPCL training results from saved JSON log files',
        formatter_class=argparse.RawTextHelpFormatter,
    )
    parser.add_argument('--file',    nargs='+', default=None, metavar='FILE')
    parser.add_argument('--dataset', type=str,  default=None, choices=DATASETS)
    parser.add_argument('--stage',   type=int,  default=None, choices=[1,2,3,4,5])
    parser.add_argument('--plot',    action='store_true',
                        help='Plot HR@10, NDCG@10, and Loss curves')
    args = parser.parse_args()

    if args.file:
        filepaths = args.file
        missing = [f for f in filepaths if not os.path.exists(f)]
        if missing:
            for m in missing:
                print(f"  File not found: {m}")
            return
    else:
        filepaths = find_logs_auto(stage=args.stage, dataset=args.dataset)
        if not filepaths:
            print("\n  No log files found in current directory.")
            print("  Use --file to specify a log file directly.")
            return
        print(f"\n  Auto-found {len(filepaths)} log file(s):")
        for f in filepaths:
            print(f"    {f}")

    results = []
    for fp in filepaths:
        data = load_log(fp)
        stage, dataset = detect_stage_dataset(fp, data)
        print_summary(fp, data, stage, dataset)
        results.append((fp, data, stage, dataset))

    if len(results) > 1:
        print_comparison_table(results)

    if args.plot:
        plot_curves(results)


if __name__ == '__main__':
    main()
