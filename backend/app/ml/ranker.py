"""
Movientum — XGBRanker Wrapper (Phase 3)

Loads (or initialises) an XGBRanker model from disk.
Provides rank_candidates() for inference and reload_ranker() for
hot-swapping the model after nightly retraining.

Model file:  backend/app/ml/ranker.json   (written by training job)

Cold-start behaviour:
    If ranker.json does not exist, rank_candidates() falls back to
    the raw PPR score (column 0 of the feature matrix), so the
    system is fully functional before any training data exists.
"""
import logging
import os
from typing import Optional

import numpy as np
from xgboost import XGBRanker

logger = logging.getLogger(__name__)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "ranker.json")

_ranker: Optional[XGBRanker] = None
_model_trained: bool = False   # True only if a saved model was loaded


def load_ranker() -> XGBRanker:
    """
    Load XGBRanker from disk.
    Initialise with default hyperparameters if ranker.json is absent
    (cold-start / first-run).
    """
    global _ranker, _model_trained

    if _ranker is not None:
        return _ranker

    model = XGBRanker(
        objective="rank:ndcg",       # NDCG objective optimises top-K quality
        n_estimators=200,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method="hist",          # fast histogram method, CPU-friendly
        eval_metric="ndcg@10",       # evaluate top-10 ranking quality
        early_stopping_rounds=20,
    )

    if os.path.exists(MODEL_PATH):
        try:
            model.load_model(MODEL_PATH)
            _model_trained = True
            logger.info("XGBRanker model loaded from %s", MODEL_PATH)
        except Exception as e:
            logger.warning("Failed to load XGBRanker model: %s — using cold-start fallback", e)
            _model_trained = False
    else:
        logger.info(
            "ranker.json not found at %s — XGBRanker in cold-start mode (PPR fallback active)",
            MODEL_PATH,
        )
        _model_trained = False

    _ranker = model
    return _ranker


def reload_ranker() -> None:
    """
    Force model reload from disk.
    Call after the nightly retraining job writes a new ranker.json
    so inference picks up the updated weights without a server restart.
    """
    global _ranker, _model_trained
    _ranker = None
    _model_trained = False
    load_ranker()
    logger.info("XGBRanker reloaded from disk")


def is_model_trained() -> bool:
    """Returns True if a trained model file was successfully loaded."""
    load_ranker()          # ensure loaded
    return _model_trained


def rank_candidates(feature_matrix: np.ndarray) -> list[int]:
    """
    Run XGBRanker.predict() on the (N × 16) feature matrix.

    Returns a list of row indices sorted by predicted relevance score
    (descending) — i.e., index 0 = most relevant candidate.

    Cold-start fallback: if no trained model exists, ranks by the raw
    PPR score in column 0 of the feature matrix.

    Args:
        feature_matrix: float32 array of shape (N, 16).

    Returns:
        List of integer row indices, length N, sorted best→worst.
    """
    if feature_matrix.shape[0] == 0:
        return []

    ranker = load_ranker()

    if not _model_trained:
        # Cold-start: rank purely by PPR score (column 0)
        scores = feature_matrix[:, 0]
        logger.debug("rank_candidates: cold-start PPR fallback (%d candidates)", len(scores))
    else:
        try:
            scores = ranker.predict(feature_matrix)
        except Exception as e:
            logger.warning("XGBRanker.predict() failed (%s) — falling back to PPR score", e)
            scores = feature_matrix[:, 0]

    return list(np.argsort(scores)[::-1])
