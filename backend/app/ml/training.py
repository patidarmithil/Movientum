"""
Movientum — Nightly XGBRanker Retraining Pipeline (Phase 7)

Assembles training data from `interaction_log` (last 30 days),
applies exponential time-decay to labels, trains an XGBRanker,
serialises the model artifact, and invalidates caches.

Called by the Celery beat task in app/tasks/retrain_ranker.py at 3:30 AM IST.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


# ── Feature column order (must match build_feature_matrix in advanced_recs.py) ──

FEATURE_COLUMNS = [
    "ppr_score",
    "ppr_rank_norm",
    "vote_average",
    "vote_count_log",
    "popularity_log",
    "recency_score",
    "user_genre_score",
    "user_cast_score",
    "user_crew_score",
    "user_keyword_score",
    "user_era_score",
    "user_language_mult",
    "genre_overlap_count",
    "cast_overlap_count",
    "same_language",
    "same_era",
]

_MIN_ROWS_TO_TRAIN = 100   # Skip retrain if insufficient data
_LOOKBACK_DAYS     = 30    # Training window
_VAL_FRACTION      = 0.15  # Last 15% of rows used for validation


# ── Training data assembly ────────────────────────────────────────

async def build_training_data(db: AsyncSession):
    """
    Pulls interaction_log rows from last 30 days.
    Assembles feature matrix, raw integer labels, and decay weights (for sample weighting).

    Returns:
        X       — float32 ndarray of shape (N, 16)
        y       — int32 ndarray of shape (N,) raw integer labels
        w       — float32 ndarray of shape (N,) decay-based sample weights
        groups  — int ndarray, number of rows per user (for XGBRanker)
        n_rows  — int total rows
    """
    from app.db.orm_models import InteractionLog
    from app.services.feedback_service import time_decay_weight

    cutoff = datetime.now(timezone.utc) - timedelta(days=_LOOKBACK_DAYS)

    result = await db.execute(
        select(InteractionLog)
        .where(InteractionLog.timestamp >= cutoff)
        .order_by(InteractionLog.user_id, InteractionLog.timestamp)
    )
    logs = result.scalars().all()

    if not logs:
        return None, None, None, None, 0

    rows_x = []
    rows_y = []
    rows_w = []
    user_counts: dict = {}

    for log in logs:
        snap = log.feature_snapshot or {}
        # Skip rows with no feature snapshot (logged before Phase 6 was live)
        if not snap:
            continue

        decay = time_decay_weight(log.timestamp)
        raw_label = int(log.label or 0)

        feature_row = [float(snap.get(col, 0.0)) for col in FEATURE_COLUMNS]
        rows_x.append(feature_row)
        rows_y.append(raw_label)
        rows_w.append(decay)

        uid = str(log.user_id)
        user_counts[uid] = user_counts.get(uid, 0) + 1

    n_rows = len(rows_x)
    if n_rows == 0:
        return None, None, None, None, 0

    X = np.array(rows_x, dtype=np.float32)
    y = np.array(rows_y, dtype=np.int32)
    w = np.array(rows_w, dtype=np.float32)
    groups = np.array(list(user_counts.values()), dtype=np.int32)

    return X, y, w, groups, n_rows


# ── Retraining procedure ──────────────────────────────────────────

async def run_nightly_retrain(db: AsyncSession) -> dict:
    """
    Full nightly retraining pipeline.

    Steps:
    1. Assemble decay-weighted training data from interaction_log (last 30 days).
    2. Validate data volume (skip if < 100 rows).
    3. Train XGBRanker with rank:ndcg objective.
    4. Save model artifact to ranker.json.
    5. Hot-reload in-memory model singleton.
    6. Invalidate in-memory graph cache (forces rebuild on next request,
       incorporating any new catalog items added since last retrain).

    Returns: summary dict with training stats.
    """
    from app.ml.ranker import MODEL_PATH, reload_ranker

    logger.info("[Retrain] Starting nightly XGBRanker retrain...")

    # ── Step 1: Assemble training data ───────────────────────────
    X, y, w, groups, n_rows = await build_training_data(db)

    if n_rows < _MIN_ROWS_TO_TRAIN:
        msg = f"[Retrain] Insufficient data ({n_rows} rows with snapshots). Minimum = {_MIN_ROWS_TO_TRAIN}. Skipping."
        logger.warning(msg)
        return {"status": "skipped", "reason": "insufficient_data", "rows": n_rows}

    logger.info("[Retrain] Assembled %d training rows across %d users.", n_rows, len(groups))

    # ── Step 2: Train / val split (split by user groups to preserve ranking queries) ──
    n_groups = len(groups)
    val_groups_count = max(1, int(n_groups * _VAL_FRACTION))
    train_groups_count = n_groups - val_groups_count

    # Calculate row boundary
    cumsum_groups = np.cumsum(groups)
    split_row = cumsum_groups[train_groups_count - 1]

    X_train, y_train, w_train = X[:split_row], y[:split_row], w[:split_row]
    X_val,   y_val            = X[split_row:], y[split_row:]

    train_groups = groups[:train_groups_count]
    val_groups   = groups[train_groups_count:]

    # ── Step 3: Fit XGBRanker ────────────────────────────────────
    try:
        from xgboost import XGBRanker
    except ImportError:
        logger.error("[Retrain] xgboost not installed — cannot retrain.")
        return {"status": "error", "reason": "xgboost_not_installed"}

    ranker = XGBRanker(
        objective        = "rank:ndcg",
        n_estimators     = 300,
        max_depth        = 6,
        learning_rate    = 0.05,
        subsample        = 0.8,
        colsample_bytree = 0.8,
        tree_method      = "hist",
        eval_metric      = "ndcg@10",
        early_stopping_rounds = 20,
        verbosity        = 0,
    )

    try:
        # Aggregate row-wise weights into group-level weights
        group_weights = []
        start_idx = 0
        for g_size in train_groups:
            group_w = w_train[start_idx:start_idx + g_size]
            group_weights.append(float(np.mean(group_w)) if len(group_w) > 0 else 1.0)
            start_idx += g_size
        group_weights = np.array(group_weights, dtype=np.float32)

        ranker.fit(
            X_train, y_train,
            group = train_groups,
            sample_weight = group_weights,
            eval_set = [(X_val, y_val)],
            eval_group = [val_groups],
            verbose = False,
        )
    except Exception as e:
        logger.error("[Retrain] XGBRanker.fit() failed: %s", e)
        return {"status": "error", "reason": str(e)}

    best_iter = getattr(ranker, "best_iteration", ranker.n_estimators)
    logger.info("[Retrain] Training complete. Best iteration: %s", best_iter)

    # ── Step 4: Save model artifact ──────────────────────────────
    try:
        ranker.save_model(MODEL_PATH)
        logger.info("[Retrain] Model saved → %s", MODEL_PATH)
    except Exception as e:
        logger.error("[Retrain] Failed to save model: %s", e)
        return {"status": "error", "reason": f"save_failed: {e}"}

    # ── Step 5: Hot-reload in-memory ranker ──────────────────────
    reload_ranker()
    logger.info("[Retrain] In-memory XGBRanker reloaded.")

    # ── Step 6: Invalidate graph cache ───────────────────────────
    try:
        from app.services.graph_cache import invalidate_graph
        invalidate_graph()
        logger.info("[Retrain] Graph cache invalidated — will rebuild on next request.")
    except Exception as e:
        logger.warning("[Retrain] Graph invalidation failed (non-fatal): %s", e)

    logger.info("[Retrain] Nightly retrain complete.")
    return {
        "status": "ok",
        "rows_trained": int(len(X_train)),
        "rows_validated": int(len(X_val)),
        "best_iteration": int(best_iter) if best_iter is not None else None,
        "model_path": MODEL_PATH,
    }
