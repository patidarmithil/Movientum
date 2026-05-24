"""
visualize_kde.py
════════════════
Reproduces paper Figure 6 — KDE (Kernel Density Estimation) plots of
item embedding distributions in 2D space.

Paper quote (Section IV-D):
  "We utilize Gaussian kernel density estimation (KDE) to plot the learned
   embeddings in a 2-D space. The darker the color, the more items in the area."

HOW IT WORKS:
  1. Load saved item embeddings (.npy files from federated_core_stage5.py)
  2. Reduce 64-dim → 2-dim using PCA
  3. Compute 2D Gaussian KDE on the projected embeddings
  4. Plot as filled contour (darker = more items concentrated there)

USAGE:

  # Single plot (one .npy file):
  python visualize_kde.py --files emb_ml100k_round0400.npy

  # Compare two snapshots (early vs final, like the paper):
  python visualize_kde.py \
      --files emb_ml100k_round0001.npy emb_ml100k_round0400.npy \
      --labels "Round 1 (random init)" "Round 400 (trained)"

  # Compare FedPCL final vs an earlier checkpoint (paper Fig.6 style):
  python visualize_kde.py \
      --files emb_ml100k_round0100.npy emb_ml100k_round0400.npy \
      --labels "FedPCL (early)" "FedPCL (final)" \
      --title "ML-100K Item Embedding Distribution"

  # Save to file instead of showing:
  python visualize_kde.py --files emb_steam_round0400.npy --save kde_steam.png

HOW TO GENERATE THE .npy FILES:
  Add save_emb_rounds to your training command in train_stage5.py, or
  set 'save_emb_rounds': [1, 100, 200, 300, 400] in HPARAMS.
  The final round is always saved automatically.

WHAT TO LOOK FOR (per the paper):
  FedPCL trained embeddings:
    - Concentrated in central region (high-density core)
    - More high-density areas than FedGNN
    - Relatively uniform spread across the embedding space
  Random (round 1) / untrained embeddings:
    - Scattered, diffuse, low-density blobs
    - Uniform distribution (no structure)
"""

import argparse
import os
import sys

import numpy as np
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors
from matplotlib.gridspec   import GridSpec
from sklearn.decomposition import PCA
from scipy.stats           import gaussian_kde


# ══════════════════════════════════════════════════════════════════════════════
#  KDE COMPUTATION
# ══════════════════════════════════════════════════════════════════════════════

def pca_to_2d(embeddings: np.ndarray) -> np.ndarray:
    """
    Reduce [n_items, d] embeddings to [n_items, 2] using PCA.

    PCA is fit on the input embeddings and returns the 2 principal components.
    This is the standard approach used in embedding visualisation papers
    (t-SNE is more common but PCA is faster and deterministic).
    """
    pca = PCA(n_components=2, random_state=42)
    projected = pca.fit_transform(embeddings)
    var_ratio  = pca.explained_variance_ratio_
    print(f"  PCA variance explained: PC1={var_ratio[0]*100:.1f}%  "
          f"PC2={var_ratio[1]*100:.1f}%  "
          f"total={sum(var_ratio)*100:.1f}%")
    return projected


def compute_kde(xy_2d: np.ndarray,
                grid_size: int = 200,
                bandwidth: str = 'scott') -> tuple:
    """
    Compute 2D Gaussian KDE on projected item embeddings.

    Args:
        xy_2d:      [n_items, 2]  PCA-projected coordinates
        grid_size:  resolution of the evaluation grid (200 × 200)
        bandwidth:  KDE bandwidth method — 'scott' or 'silverman'

    Returns:
        xx:   [grid_size, grid_size]  x-coordinates of evaluation grid
        yy:   [grid_size, grid_size]  y-coordinates
        zz:   [grid_size, grid_size]  KDE density values
        xlim: (xmin, xmax) of data range (for axis limits)
        ylim: (ymin, ymax) of data range
    """
    x = xy_2d[:, 0]
    y = xy_2d[:, 1]

    # Axis range with small padding
    pad = 0.05
    xrange = x.max() - x.min()
    yrange = y.max() - y.min()
    xlim = (x.min() - pad * xrange, x.max() + pad * xrange)
    ylim = (y.min() - pad * yrange, y.max() + pad * yrange)

    # Evaluation grid
    xi = np.linspace(xlim[0], xlim[1], grid_size)
    yi = np.linspace(ylim[0], ylim[1], grid_size)
    xx, yy = np.meshgrid(xi, yi)

    # Gaussian KDE
    positions = np.vstack([xx.ravel(), yy.ravel()])
    kernel    = gaussian_kde(np.vstack([x, y]), bw_method=bandwidth)
    zz        = kernel(positions).reshape(xx.shape)

    return xx, yy, zz, xlim, ylim


# ══════════════════════════════════════════════════════════════════════════════
#  PLOTTING
# ══════════════════════════════════════════════════════════════════════════════

# Paper uses blue gradient with filled contours — darker = denser.
# We replicate this with the Blues_r colormap (reversed so dark = high density).
CMAP = plt.cm.Blues_r

# Number of contour levels (paper appears to use ~8–12)
N_LEVELS = 12


def plot_single_kde(ax, xx, yy, zz, xlim, ylim,
                    title: str = '', n_items: int = 0):
    """
    Draw one KDE subplot — filled contours + contour lines, blue theme.

    Matches paper Fig.6 visual style:
      - Filled colour contours (darker = higher density)
      - Black contour lines for depth cues
      - Clean axes with grid
    """
    # Filled contour (the blue gradient background)
    cf = ax.contourf(xx, yy, zz, levels=N_LEVELS, cmap=CMAP, alpha=0.85)

    # Black contour lines on top for structure
    ax.contour(xx, yy, zz, levels=N_LEVELS,
               colors='black', linewidths=0.4, alpha=0.5)

    # Axis formatting
    ax.set_xlim(xlim)
    ax.set_ylim(ylim)
    ax.set_xlabel('PC 1', fontsize=10)
    ax.set_ylabel('PC 2', fontsize=10)

    if title:
        label = f"{title}\n({n_items} items)" if n_items else title
        ax.set_title(label, fontsize=11, fontweight='bold', pad=8)

    ax.tick_params(labelsize=8)
    ax.grid(True, linestyle='--', alpha=0.3, linewidth=0.5)

    return cf


def make_kde_figure(files: list, labels: list,
                    title: str = '',
                    save_path: str = None,
                    grid_size: int = 200,
                    bandwidth: str = 'scott'):
    """
    Main plotting function: load files, compute KDE, render figure.

    Args:
        files:      list of .npy file paths (1–4 files)
        labels:     list of subplot titles (same length as files)
        title:      overall figure title
        save_path:  if given, save to this path instead of plt.show()
        grid_size:  KDE evaluation grid resolution
        bandwidth:  KDE bandwidth method
    """
    n_plots = len(files)
    if n_plots == 0:
        print("Error: no files provided.")
        return

    # ── Figure layout ──────────────────────────────────────────────────────────
    # 1 file: single plot (8×6)
    # 2 files: side-by-side (14×6), matching paper
    # 3-4 files: 2×2 grid (12×10)
    if n_plots == 1:
        fig, axes = plt.subplots(1, 1, figsize=(7, 6))
        axes = [axes]
    elif n_plots == 2:
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))
        axes = list(axes)
    else:
        rows = (n_plots + 1) // 2
        fig, axes = plt.subplots(rows, 2, figsize=(13, rows * 5.5))
        axes = list(axes.ravel())

    if title:
        fig.suptitle(title, fontsize=14, fontweight='bold', y=1.01)

    # ── Shared PCA across all files for comparable axes ────────────────────────
    # Fit PCA on the UNION of all embeddings so all plots use the same axes.
    # This makes density comparisons meaningful (same scale).
    print("\n  Loading embeddings and computing shared PCA...")
    all_embs_list = []
    for fp in files:
        emb = np.load(fp).astype(np.float32)
        all_embs_list.append(emb)
        print(f"    {os.path.basename(fp)}: shape={emb.shape}")

    all_embs_concat = np.vstack(all_embs_list)
    pca = PCA(n_components=2, random_state=42)
    pca.fit(all_embs_concat)
    var_ratio = pca.explained_variance_ratio_
    print(f"  Shared PCA variance: PC1={var_ratio[0]*100:.1f}%  "
          f"PC2={var_ratio[1]*100:.1f}%  total={sum(var_ratio)*100:.1f}%")

    # ── Compute shared axis limits from ALL data ───────────────────────────────
    all_projected = [pca.transform(e) for e in all_embs_list]
    all_xy = np.vstack(all_projected)
    pad = 0.05
    xr  = all_xy[:, 0].max() - all_xy[:, 0].min()
    yr  = all_xy[:, 1].max() - all_xy[:, 1].min()
    shared_xlim = (all_xy[:, 0].min() - pad*xr,
                   all_xy[:, 0].max() + pad*xr)
    shared_ylim = (all_xy[:, 1].min() - pad*yr,
                   all_xy[:, 1].max() + pad*yr)

    # ── Plot each file ─────────────────────────────────────────────────────────
    for idx, (emb, xy, ax) in enumerate(zip(all_embs_list, all_projected, axes)):
        label = labels[idx] if idx < len(labels) else os.path.basename(files[idx])
        print(f"\n  [{idx+1}/{n_plots}] Computing KDE for: {label}")

        xx, yy, zz, _, _ = compute_kde(xy, grid_size=grid_size,
                                        bandwidth=bandwidth)

        # Override limits with shared limits for comparability
        xlim = shared_xlim
        ylim = shared_ylim

        cf = plot_single_kde(ax, xx, yy, zz, xlim, ylim,
                             title=label, n_items=emb.shape[0])

        # Colourbar per subplot
        cbar = plt.colorbar(cf, ax=ax, shrink=0.85, pad=0.02)
        cbar.set_label('Density', fontsize=8)
        cbar.ax.tick_params(labelsize=7)

    # Hide any unused axes (if odd number of plots in 2-col layout)
    for ax in axes[n_plots:]:
        ax.set_visible(False)

    plt.tight_layout()

    # ── Save or show ───────────────────────────────────────────────────────────
    if save_path:
        plt.savefig(save_path, dpi=150, bbox_inches='tight')
        print(f"\n  Saved → {save_path}")
    else:
        plt.show()
        print("\n  Done.")


# ══════════════════════════════════════════════════════════════════════════════
#  CONVENIENCE: auto-find embedding files for a dataset
# ══════════════════════════════════════════════════════════════════════════════

def find_emb_files(dataset: str, directory: str = '.') -> list:
    """
    Auto-find all saved embedding files for a given dataset.

    Looks for files matching:  emb_{dataset}_round*.npy

    Returns list sorted by round number.
    """
    prefix  = f'emb_{dataset}_round'
    matches = [
        f for f in os.listdir(directory)
        if f.startswith(prefix) and f.endswith('.npy')
    ]
    matches.sort()
    return [os.path.join(directory, f) for f in matches]


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════

def parse_args():
    parser = argparse.ArgumentParser(
        description='KDE visualisation of FedPCL item embeddings (paper Fig.6)',
        formatter_class=argparse.RawTextHelpFormatter,
        epilog="""
Examples:
  # Single file:
  python visualize_kde.py --files emb_ml100k_round0400.npy

  # Two files side-by-side (paper style):
  python visualize_kde.py \\
      --files emb_ml100k_round0001.npy emb_ml100k_round0400.npy \\
      --labels "Round 1 (init)" "Round 400 (trained)"

  # Auto-find all snapshots for a dataset and plot first + last:
  python visualize_kde.py --dataset ml100k --auto_first_last

  # Save output:
  python visualize_kde.py --files emb_steam_round0400.npy --save kde_steam.png
        """
    )
    parser.add_argument('--files',  nargs='+', default=None,
                        help='One or more .npy embedding files')
    parser.add_argument('--labels', nargs='+', default=None,
                        help='Subplot labels (same count as --files)')
    parser.add_argument('--title',  type=str, default='',
                        help='Overall figure title')
    parser.add_argument('--save',   type=str, default=None,
                        help='Save plot to this path (e.g. kde.png)')
    parser.add_argument('--dataset', type=str, default=None,
                        help='Dataset name for --auto_first_last')
    parser.add_argument('--auto_first_last', action='store_true',
                        help='Auto-find first and last embedding snapshots for --dataset')
    parser.add_argument('--dir',     type=str, default='.',
                        help='Directory to search for .npy files')
    parser.add_argument('--grid',    type=int, default=200,
                        help='KDE grid resolution (default 200)')
    parser.add_argument('--bw',      type=str, default='scott',
                        choices=['scott', 'silverman'],
                        help='KDE bandwidth method (default: scott)')
    return parser.parse_args()


def main():
    args = parse_args()

    files  = args.files or []
    labels = args.labels or []

    # ── Auto-find mode ────────────────────────────────────────────────────────
    if args.auto_first_last:
        if not args.dataset:
            print("Error: --auto_first_last requires --dataset <name>")
            sys.exit(1)
        all_files = find_emb_files(args.dataset, args.dir)
        if len(all_files) == 0:
            print(f"No embedding files found for dataset '{args.dataset}' in '{args.dir}'")
            sys.exit(1)
        elif len(all_files) == 1:
            files  = all_files
            labels = [os.path.basename(all_files[0])]
        else:
            files  = [all_files[0], all_files[-1]]
            labels = [
                os.path.basename(all_files[0]).replace('.npy', ''),
                os.path.basename(all_files[-1]).replace('.npy', ''),
            ]
        print(f"  Auto-selected: {files}")

    if not files:
        print("Error: provide --files or use --dataset + --auto_first_last")
        print("Run with --help for usage examples.")
        sys.exit(1)

    # ── Validate files ────────────────────────────────────────────────────────
    for fp in files:
        if not os.path.exists(fp):
            print(f"Error: file not found: {fp}")
            sys.exit(1)

    # ── Pad labels if not provided ────────────────────────────────────────────
    while len(labels) < len(files):
        labels.append(os.path.basename(files[len(labels)]).replace('.npy', ''))

    title = args.title or f"Item Embedding Distribution (KDE)"

    # ── Run ───────────────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  FedPCL Embedding KDE Visualisation")
    print(f"  Files: {len(files)}")
    for fp, lb in zip(files, labels):
        print(f"    {lb:30s}  ← {fp}")
    print(f"{'='*60}")

    make_kde_figure(
        files      = files,
        labels     = labels,
        title      = title,
        save_path  = args.save,
        grid_size  = args.grid,
        bandwidth  = args.bw,
    )


if __name__ == '__main__':
    main()
