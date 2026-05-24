"""
plot_training_curves.py
════════════════════════
Generates publication-quality training curve figures for the FedPCL
results draft. Reads directly from saved JSON log files or uses the
hardcoded data from logs.md as a fallback.

Usage:
    # From saved JSON logs (preferred):
    python plot_training_curves.py --from_logs

    # From hardcoded data (no JSON files needed):
    python plot_training_curves.py

Outputs:
    training_curves.pdf     — 3-panel figure (HR@10, NDCG@10, Loss)
    training_curves_hr.pdf  — HR@10 only (for embedding in LaTeX)
    training_curves.png     — PNG version (for quick preview)
"""

import os
import json
import argparse
import numpy as np
import matplotlib
matplotlib.use('Agg')   # headless — no display needed
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.lines import Line2D

# ─────────────────────────────────────────────────────────────────────────────
#  HARDCODED DATA FROM logs.md  (fallback if JSON files absent)
# ─────────────────────────────────────────────────────────────────────────────

HARDCODED_DATA = {
    'ML-100K': {
        'color': '#1f77b4',   # blue
        'marker': 'o',
        'paper_hr':   63.81,
        'paper_ndcg': 45.03,
        'loss_range': (0.45, 0.58),
        'warmup': 20,
        'best_round': 330,
        'curve': [
            # round, HR@10, NDCG@10, Loss
            (1,    9.01,  3.89,  0.65595),
            (40,  11.35,  5.43,  0.79681),
            (80,  16.65,  8.49,  0.76465),
            (120, 25.66, 13.13,  0.70912),
            (160, 39.13, 20.08,  0.66535),
            (200, 45.92, 23.41,  0.58193),
            (240, 48.67, 25.66,  0.54623),
            (280, 53.02, 27.78,  0.53759),
            (320, 53.98, 28.52,  0.52897),
            (360, 52.70, 27.88,  0.53342),
            (400, 51.33, 27.46,  0.54068),
        ],
    },
    'ML-1M': {
        'color': '#d62728',   # red
        'marker': 's',
        'paper_hr':   62.86,
        'paper_ndcg': 44.12,
        'loss_range': (0.40, 0.55),
        'warmup': 20,
        'best_round': 400,
        'curve': [
            (1,    10.10,  4.55,  0.66264),
            (40,   10.55,  4.88,  0.82006),
            (80,   11.41,  5.43,  0.81751),
            (120,  13.36,  6.39,  0.80990),
            (160,  16.72,  7.85,  0.79748),
            (200,  20.32,  9.73,  0.79291),
            (240,  24.57, 11.92,  0.74823),
            (280,  29.17, 14.33,  0.72525),
            (320,  33.10, 16.43,  0.67878),
            (360,  36.36, 18.11,  0.66599),
            (400,  38.96, 19.56,  0.65564),
        ],
    },
    'Steam': {
        'color': '#2ca02c',   # green
        'marker': '^',
        'paper_hr':   80.36,
        'paper_ndcg': 65.55,
        'loss_range': (0.01, 0.08),
        'warmup': 20,
        'best_round': 390,
        'curve': [
            (1,    9.48,  4.64,  0.58900),
            (40,  25.26, 15.04,  0.56761),
            (80,  50.76, 35.25,  0.46097),
            (120, 66.54, 47.45,  0.38519),
            (160, 73.84, 52.51,  0.28282),
            (200, 76.02, 53.90,  0.29395),
            (240, 76.98, 54.59,  0.25165),
            (280, 77.99, 55.03,  0.23093),
            (320, 78.28, 55.27,  0.20545),
            (360, 79.16, 55.62,  0.20172),
            (400, 79.13, 55.61,  0.22797),
        ],
    },
    'Amazon': {
        'color': '#ff7f0e',   # orange
        'marker': 'D',
        'paper_hr':   34.04,
        'paper_ndcg': 22.93,
        'loss_range': (0.25, 0.38),
        'warmup': 20,
        'best_round': 280,
        'curve': [
            (1,    10.71,  4.97,  0.62434),
            (40,   11.84,  5.56,  0.62579),
            (80,   15.76,  7.69,  0.58171),
            (120,  20.41, 10.43,  0.51800),
            (160,  25.53, 13.75,  0.45422),
            (200,  29.12, 15.54,  0.39083),
            (240,  30.59, 16.30,  0.36582),
            (280,  31.78, 16.62,  0.33374),
            (320,  30.65, 16.12,  0.30500),
            (360,  29.45, 15.76,  0.30715),
            (400,  30.05, 16.20,  0.30645),
        ],
    },
}

# ─────────────────────────────────────────────────────────────────────────────
#  LOAD FROM JSON LOGS
# ─────────────────────────────────────────────────────────────────────────────

LOG_MAP = {
    'ML-100K': 'results/stage5_log_ml100k.json',
    'ML-1M':   'results/stage5_log_ml1m.json',
    'Steam':   'results/stage5_log_steam.json',
    'Amazon':  'results/stage5_log_amazon.json',
}

def load_from_json(dataset_name, filepath, meta):
    """Load training curve from a stage5 JSON log file."""
    with open(filepath) as f:
        d = json.load(f)
    log = d.get('log', [])
    curve = []
    for row in log:
        rnd  = row.get('round', 0)
        hr   = row.get('HR@10',   row.get('hr10',   0))
        ndcg = row.get('NDCG@10', row.get('ndcg10', 0))
        loss = row.get('loss', 0)
        curve.append((rnd, hr, ndcg, loss))
    meta['curve']      = curve
    meta['best_round'] = d.get('best_round', 0)
    return meta

# ─────────────────────────────────────────────────────────────────────────────
#  MAIN PLOT FUNCTION
# ─────────────────────────────────────────────────────────────────────────────

def make_figure(data: dict, save_prefix: str = 'training_curves'):
    """
    Generate a 3-row publication figure:
      Row 1 — HR@10 (%)
      Row 2 — NDCG@10 (%)
      Row 3 — Training Loss

    Each dataset is one line.  Paper targets shown as dashed horizontals.
    Expected loss range shown as shaded band.
    Warmup end marked as vertical dotted line.
    """
    fig, axes = plt.subplots(3, 1, figsize=(9, 10), sharex=True)
    ax_hr, ax_ndcg, ax_loss = axes

    ax_hr.set_ylabel('HR@10 (%)',   fontsize=12)
    ax_ndcg.set_ylabel('NDCG@10 (%)', fontsize=12)
    ax_loss.set_ylabel('Training Loss', fontsize=12)
    ax_loss.set_xlabel('Communication Round', fontsize=12)

    ax_hr.set_title('FedPCL Training Curves — All Datasets', fontsize=13,
                    fontweight='bold', pad=10)

    for ds_name, meta in data.items():
        curve      = meta['curve']
        color      = meta['color']
        marker     = meta['marker']
        best_round = meta.get('best_round', 0)

        rounds = [r[0] for r in curve]
        hrs    = [r[1] for r in curve]
        ndcgs  = [r[2] for r in curve]
        losses = [r[3] for r in curve]

        lw  = 2.0
        ms  = 5
        kw  = dict(color=color, linewidth=lw, marker=marker,
                   markersize=ms, markevery=2, label=ds_name)

        ax_hr.plot(rounds, hrs,    **kw)
        ax_ndcg.plot(rounds, ndcgs, **kw)
        ax_loss.plot(rounds, losses, **kw)

        # Paper target — dashed horizontal
        phr  = meta['paper_hr']
        pndcg= meta['paper_ndcg']
        x_max= max(rounds)
        ax_hr.axhline(phr,   color=color, linestyle='--', linewidth=1.0,
                      alpha=0.55)
        ax_ndcg.axhline(pndcg, color=color, linestyle='--', linewidth=1.0,
                         alpha=0.55)

        # Star at best round
        best_idx = next((i for i, r in enumerate(rounds) if r == best_round), None)
        if best_idx is None:
            # approximate: pick index with max HR
            best_idx = int(np.argmax(hrs))
        ax_hr.plot(rounds[best_idx], hrs[best_idx],
                   marker='*', markersize=14, color=color,
                   markeredgecolor='black', markeredgewidth=0.5, zorder=5)

        # Expected loss band
        lo, hi = meta['loss_range']
        ax_loss.axhspan(lo, hi, alpha=0.08, color=color)

    # Warmup line (same for all datasets — round 20)
    for ax in axes:
        ax.axvline(20, color='grey', linestyle=':', linewidth=1.2,
                   alpha=0.7, label='_nolegend_')

    # Annotations
    ax_hr.text(22, ax_hr.get_ylim()[0] + 1, 'warmup\nends',
               fontsize=7.5, color='grey', va='bottom')

    # Legend — datasets
    legend_lines = [
        Line2D([0], [0], color=meta['color'], linewidth=2,
               marker=meta['marker'], markersize=6, label=ds_name)
        for ds_name, meta in data.items()
    ]
    legend_extras = [
        Line2D([0], [0], color='grey', linestyle='--', linewidth=1.2,
               label='Paper target'),
        Line2D([0], [0], color='grey', linestyle=':', linewidth=1.2,
               label='CL warmup end'),
        Line2D([0], [0], color='grey', marker='*', markersize=11,
               linestyle='None', label='Best checkpoint'),
    ]
    ax_hr.legend(handles=legend_lines + legend_extras,
                 loc='upper left', fontsize=8.5,
                 ncol=2, framealpha=0.9)

    for ax in axes:
        ax.grid(True, linestyle='--', alpha=0.35, linewidth=0.6)
        ax.tick_params(labelsize=9)
        for spine in ax.spines.values():
            spine.set_linewidth(0.8)

    plt.tight_layout(h_pad=1.2)

    # Save PDF + PNG
    pdf_path = f'{save_prefix}.pdf'
    png_path = f'{save_prefix}.png'
    fig.savefig(pdf_path, dpi=200, bbox_inches='tight')
    fig.savefig(png_path, dpi=150, bbox_inches='tight')
    print(f'  Saved: {pdf_path}')
    print(f'  Saved: {png_path}')
    return fig


def make_hr_only_figure(data: dict, save_prefix: str = 'training_curves_hr'):
    """
    Single-panel HR@10 figure — cleaner for embedding in a paper column.
    """
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.set_ylabel('HR@10 (%)', fontsize=12)
    ax.set_xlabel('Communication Round', fontsize=12)
    ax.set_title('HR@10 Training Curves — FedPCL (Stage 5)', fontsize=12,
                 fontweight='bold')

    for ds_name, meta in data.items():
        curve      = meta['curve']
        color      = meta['color']
        marker     = meta['marker']
        best_round = meta.get('best_round', 0)

        rounds = [r[0] for r in curve]
        hrs    = [r[1] for r in curve]

        ax.plot(rounds, hrs, color=color, linewidth=2.0,
                marker=marker, markersize=5, markevery=2, label=ds_name)
        ax.axhline(meta['paper_hr'], color=color, linestyle='--',
                   linewidth=1.0, alpha=0.5)

        best_idx = next((i for i, r in enumerate(rounds) if r == best_round),
                        int(np.argmax(hrs)))
        ax.plot(rounds[best_idx], hrs[best_idx],
                marker='*', markersize=13, color=color,
                markeredgecolor='black', markeredgewidth=0.4, zorder=5)

    ax.axvline(20, color='grey', linestyle=':', linewidth=1.1, alpha=0.7)
    ax.text(22, ax.get_ylim()[0] + 0.5, 'warmup', fontsize=7.5,
            color='grey', va='bottom')

    legend_lines = [
        Line2D([0], [0], color=meta['color'], linewidth=2,
               marker=meta['marker'], markersize=5, label=ds_name)
        for ds_name, meta in data.items()
    ]
    extras = [
        Line2D([0], [0], color='grey', linestyle='--', linewidth=1.2,
               label='Paper target (dashed)'),
        Line2D([0], [0], color='grey', marker='*', markersize=10,
               linestyle='None', label='Best checkpoint'),
    ]
    ax.legend(handles=legend_lines + extras, loc='upper left',
              fontsize=8.5, ncol=2, framealpha=0.9)
    ax.grid(True, linestyle='--', alpha=0.35, linewidth=0.6)
    ax.tick_params(labelsize=9)
    plt.tight_layout()

    pdf_path = f'{save_prefix}.pdf'
    png_path = f'{save_prefix}.png'
    fig.savefig(pdf_path, dpi=200, bbox_inches='tight')
    fig.savefig(png_path, dpi=150, bbox_inches='tight')
    print(f'  Saved: {pdf_path}')
    print(f'  Saved: {png_path}')
    return fig


def make_loss_figure(data: dict, save_prefix: str = 'training_curves_loss'):
    """
    Single-panel Loss figure with expected convergence bands.
    """
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.set_ylabel('Training Loss', fontsize=12)
    ax.set_xlabel('Communication Round', fontsize=12)
    ax.set_title('Training Loss Convergence — FedPCL (Stage 5)', fontsize=12,
                 fontweight='bold')

    for ds_name, meta in data.items():
        curve = meta['curve']
        color = meta['color']
        marker= meta['marker']
        rounds = [r[0] for r in curve]
        losses = [r[3] for r in curve]

        ax.plot(rounds, losses, color=color, linewidth=2.0,
                marker=marker, markersize=5, markevery=2, label=ds_name)

        lo, hi = meta['loss_range']
        ax.axhspan(lo, hi, alpha=0.10, color=color,
                   label=f'Expected range ({ds_name})')

    ax.axvline(20, color='grey', linestyle=':', linewidth=1.1, alpha=0.7)
    ax.text(22, ax.get_ylim()[0] + 0.005, 'warmup', fontsize=7.5,
            color='grey', va='bottom')

    legend_lines = [
        Line2D([0], [0], color=meta['color'], linewidth=2,
               marker=meta['marker'], markersize=5, label=ds_name)
        for ds_name, meta in data.items()
    ]
    ax.legend(handles=legend_lines, loc='upper right',
              fontsize=8.5, framealpha=0.9)
    ax.grid(True, linestyle='--', alpha=0.35, linewidth=0.6)
    ax.tick_params(labelsize=9)
    plt.tight_layout()

    pdf_path = f'{save_prefix}.pdf'
    png_path = f'{save_prefix}.png'
    fig.savefig(pdf_path, dpi=200, bbox_inches='tight')
    fig.savefig(png_path, dpi=150, bbox_inches='tight')
    print(f'  Saved: {pdf_path}')
    print(f'  Saved: {png_path}')
    return fig


# ─────────────────────────────────────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Generate FedPCL training curve figures'
    )
    parser.add_argument('--from_logs', action='store_true',
                        help='Load data from stage5_log_*.json files')
    parser.add_argument('--outdir', type=str, default='.',
                        help='Output directory for saved figures')
    args = parser.parse_args()

    print('\n' + '='*60)
    print('  FedPCL Training Curve Generator')
    print('='*60)

    # Load data
    data = {}
    for ds_name, meta in HARDCODED_DATA.items():
        data[ds_name] = dict(meta)   # copy so we don't mutate original

    if args.from_logs:
        print('  Loading from JSON log files...')
        for ds_name, log_file in LOG_MAP.items():
            if os.path.exists(log_file):
                data[ds_name] = load_from_json(ds_name, log_file, data[ds_name])
                print(f'    {ds_name}: loaded {len(data[ds_name]["curve"])} '
                      f'points from {log_file}')
            else:
                print(f'    {ds_name}: {log_file} not found — using hardcoded data')
    else:
        print('  Using hardcoded data from logs.md')

    os.makedirs(args.outdir, exist_ok=True)
    prefix = lambda name: os.path.join(args.outdir, name)

    print('\n  Generating figures...')

    # Figure 1: 3-panel (HR, NDCG, Loss) — main figure for the paper
    make_figure(data, save_prefix=prefix('training_curves'))

    # Figure 2: HR@10 only — clean single-column figure
    make_hr_only_figure(data, save_prefix=prefix('training_curves_hr'))

    # Figure 3: Loss only — convergence analysis figure
    make_loss_figure(data, save_prefix=prefix('training_curves_loss'))

    print('\n  Done.  Files saved:')
    for f in ['training_curves.pdf', 'training_curves.png',
              'training_curves_hr.pdf', 'training_curves_hr.png',
              'training_curves_loss.pdf', 'training_curves_loss.png']:
        fp = os.path.join(args.outdir, f)
        if os.path.exists(fp):
            print(f'    {fp}')


if __name__ == '__main__':
    main()
