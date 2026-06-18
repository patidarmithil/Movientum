"""
Movientum — Recommendation Feedback Service (Phase 6)

Handles taste-profile weight updates and interaction logging in response
to user signals (thumbs-up/down, click, scroll-ignore).

Key design decisions:
- Explicit signals (thumbs) are never time-decayed (λ=0); they represent
  permanent intent.
- Implicit signals (click, ignore) decay exponentially (half-life ≈ 69 days)
  so old passive behaviour doesn't permanently lock in weights.
- All weights are clamped to [-100, 100] to prevent runaway accumulation.
- Every interaction is logged to `interaction_log` with its feature snapshot
  for nightly XGBRanker retraining.
"""
import logging
import math
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.orm_models import ContentCatalog, InteractionLog, UserTasteProfile
from app.db.cache import invalidate, key_user_recommendations, key_taste_profile
from app.services.advanced_recs import get_or_create_taste_profile

logger = logging.getLogger(__name__)


# ── Constants ─────────────────────────────────────────────────────

DECAY_LAMBDA = 0.01  # Half-life ≈ 69 days. e^(-0.01 * 69) ≈ 0.5

SIGNAL_LABEL: dict[str, int] = {
    "thumbs_up":   3,
    "click":       2,
    "ignore":      0,
    "thumbs_down": -1,
}

SIGNAL_DELTAS: dict[str, dict[str, float]] = {
    "thumbs_up":   {"genres": +10.0, "cast": +10.0, "crew": +10.0, "era": +10.0},
    "thumbs_down": {"genres": -15.0, "cast": -15.0, "crew": -15.0, "era": -15.0},
    "click":       {"genres": +2.0},
    "ignore":      {"genres": -0.5},
}

# Explicit signals bypass time decay (they represent permanent intent)
EXPLICIT_SIGNALS: frozenset[str] = frozenset({"thumbs_up", "thumbs_down"})

# Symmetric clamp: prevents any single dimension exploding
WEIGHT_MIN, WEIGHT_MAX = -100.0, 100.0


# ── Time-Decay ────────────────────────────────────────────────────

def time_decay_weight(
    event_timestamp: datetime,
    lambda_: float = DECAY_LAMBDA,
) -> float:
    """
    W(t) = e^(-λ × Δt_days)

    Δt = days since the interaction occurred.
    Returns 1.0 for events happening today, ≈0.5 after 69 days.

    Examples:
        Δt=0  days → W=1.000
        Δt=7  days → W=0.932
        Δt=30 days → W=0.741
        Δt=69 days → W=0.500 (half-life point)
    """
    now = datetime.now(timezone.utc)
    if event_timestamp.tzinfo is None:
        event_timestamp = event_timestamp.replace(tzinfo=timezone.utc)
    delta_days = (now - event_timestamp).total_seconds() / 86400.0
    return math.exp(-lambda_ * delta_days)


# ── Weight Clamp Helper ───────────────────────────────────────────

def _clamp(value: float) -> float:
    return max(WEIGHT_MIN, min(WEIGHT_MAX, value))


# ── Core Update Logic ─────────────────────────────────────────────

async def apply_feedback(
    db: AsyncSession,
    user_id: UUID,
    catalog_item: ContentCatalog,
    signal_type: str,
    timestamp: Optional[datetime] = None,
) -> None:
    """
    Updates the `user_taste_profiles` JSONB weight vectors based on signal type.

    Steps:
    1. Determine time-decay factor (1.0 for explicit, e^(-λΔt) for implicit).
    2. Apply genre / cast / crew / era deltas to the taste profile JSONB fields.
    3. Bump `total_interactions` counter and `last_updated`.
    4. Commit and invalidate the user's recommendation cache key.
    """
    timestamp = timestamp or datetime.now(timezone.utc)

    apply_decay = signal_type not in EXPLICIT_SIGNALS
    decay = time_decay_weight(timestamp) if apply_decay else 1.0

    deltas = SIGNAL_DELTAS.get(signal_type, {})
    if not deltas:
        logger.warning("apply_feedback: unknown signal_type=%s", signal_type)
        return

    profile: UserTasteProfile = await get_or_create_taste_profile(db, user_id)

    # ── Genre weights ────────────────────────────────────────────
    if "genres" in deltas:
        gw    = dict(profile.genre_weights or {})
        delta = deltas["genres"] * decay
        for gid in (catalog_item.genre_ids or []):
            key = str(gid)
            gw[key] = _clamp(gw.get(key, 0.0) + delta)
        profile.genre_weights = gw

    # ── Cast weights ─────────────────────────────────────────────
    if "cast" in deltas:
        cw    = dict(profile.cast_weights or {})
        delta = deltas["cast"] * decay
        for pid in (catalog_item.cast_ids or []):
            key = str(pid)
            cw[key] = _clamp(cw.get(key, 0.0) + delta)
        profile.cast_weights = cw

    # ── Crew (director) weights ──────────────────────────────────
    if "crew" in deltas:
        crw   = dict(profile.crew_weights or {})
        delta = deltas["crew"] * decay
        for pid in (catalog_item.crew_ids or {}).get("director", []):
            key = str(pid)
            crw[key] = _clamp(crw.get(key, 0.0) + delta)
        profile.crew_weights = crw

    # ── Era weights ──────────────────────────────────────────────
    if "era" in deltas and catalog_item.release_era:
        ew    = dict(profile.era_weights or {})
        delta = deltas["era"] * decay
        key   = catalog_item.release_era
        ew[key] = _clamp(ew.get(key, 0.0) + delta)
        profile.era_weights = ew

    # ── Global counters ──────────────────────────────────────────
    profile.total_interactions = (profile.total_interactions or 0) + 1
    profile.last_updated = datetime.now(timezone.utc)

    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error("apply_feedback: commit failed for user=%s: %s", user_id, e)
        raise

    # Bust both the rec list and the taste profile cache for this user.
    try:
        await invalidate(key_user_recommendations(str(user_id)))
        await invalidate(key_taste_profile(str(user_id)))
    except Exception as e:
        logger.warning("apply_feedback: cache invalidation failed: %s", e)


# ── Interaction Logging ───────────────────────────────────────────

async def log_interaction(
    db: AsyncSession,
    user_id: UUID,
    tmdb_id: int,
    media_type: str,
    signal_type: str,
    feature_snapshot: Optional[dict] = None,
) -> None:
    """
    Inserts a row into `interaction_log` for nightly XGBRanker training.

    `feature_snapshot` should be the 16-dim feature dict that was active when
    the card was displayed to the user.  If the frontend doesn't send it, we
    store an empty dict (still useful for label distribution analysis).
    """
    label = SIGNAL_LABEL.get(signal_type, 0)
    log_entry = InteractionLog(
        user_id          = user_id,
        tmdb_id          = tmdb_id,
        media_type       = media_type,
        signal_type      = signal_type,
        label            = label,
        feature_snapshot = feature_snapshot or {},
        timestamp        = datetime.now(timezone.utc),
    )
    db.add(log_entry)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.warning("log_interaction: failed to log for user=%s tmdb=%d: %s", user_id, tmdb_id, e)
