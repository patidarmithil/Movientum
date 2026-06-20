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
    "watched":     4,
    "watchlist":   3,
    "unwatched":   0,
    "unwatchlist": 0,
}

SIGNAL_DELTAS: dict[str, dict[str, float]] = {
    "thumbs_up":   {"genres": +10.0, "cast": +10.0, "crew": +10.0, "era": +10.0, "keyword": +5.0, "language": +1.0},
    "thumbs_down": {"genres": -15.0, "cast": -15.0, "crew": -15.0, "era": -15.0, "keyword": -8.0, "language": -1.5},
    "click":       {"genres": +2.0, "keyword": +1.0, "language": +0.2},
    "ignore":      {"genres": -0.5, "keyword": -0.2, "language": -0.05},
    "watched":     {"genres": +15.0, "cast": +10.0, "crew": +10.0, "era": +10.0, "keyword": +8.0, "language": +2.0},
    "watchlist":   {"genres": +8.0, "cast": +5.0, "crew": +5.0, "era": +5.0, "keyword": +4.0, "language": +1.0},
    "unwatched":   {"genres": -15.0, "cast": -10.0, "crew": -10.0, "era": -10.0, "keyword": -8.0, "language": -2.0},
    "unwatchlist": {"genres": -8.0, "cast": -5.0, "crew": -5.0, "era": -5.0, "keyword": -4.0, "language": -1.0},
}

# Explicit signals bypass time decay (they represent permanent intent)
EXPLICIT_SIGNALS: frozenset[str] = frozenset({
    "thumbs_up", "thumbs_down", "watched", "watchlist", "unwatched", "unwatchlist"
})

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


def _normalize_weights(
    weights: dict[str, float],
    max_limit: float = 100.0,
    min_limit: Optional[float] = None,
) -> dict[str, float]:
    if not weights:
        return weights
    max_val = max(abs(v) for v in weights.values())
    if max_val > max_limit:
        scale = max_limit / max_val
        new_weights = {k: v * scale for k, v in weights.items()}
    else:
        new_weights = dict(weights)

    for k, v in new_weights.items():
        if min_limit is not None:
            new_weights[k] = max(min_limit, min(max_limit, v))
        else:
            new_weights[k] = max(-max_limit, min(max_limit, v))
    return new_weights



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
            gw[key] = gw.get(key, 0.0) + delta
        profile.genre_weights = gw

    # ── Cast weights ─────────────────────────────────────────────
    if "cast" in deltas:
        cw    = dict(profile.cast_weights or {})
        delta = deltas["cast"] * decay
        for pid in (catalog_item.cast_ids or []):
            key = str(pid)
            cw[key] = cw.get(key, 0.0) + delta
        profile.cast_weights = cw

    # ── Crew (director) weights ──────────────────────────────────
    if "crew" in deltas:
        crw   = dict(profile.crew_weights or {})
        delta = deltas["crew"] * decay
        for pid in (catalog_item.crew_ids or {}).get("director", []):
            key = str(pid)
            crw[key] = crw.get(key, 0.0) + delta
        profile.crew_weights = crw

    # ── Era weights ──────────────────────────────────────────────
    if "era" in deltas and catalog_item.release_era:
        ew    = dict(profile.era_weights or {})
        delta = deltas["era"] * decay
        key   = catalog_item.release_era
        ew[key] = ew.get(key, 0.0) + delta
        profile.era_weights = ew

    # ── Keyword weights ──────────────────────────────────────────
    if "keyword" in deltas:
        kw    = dict(profile.keyword_weights or {})
        delta = deltas["keyword"] * decay
        for kid in (catalog_item.keyword_ids or []):
            key = str(kid)
            kw[key] = kw.get(key, 0.0) + delta
        profile.keyword_weights = kw

    # ── Language weights ─────────────────────────────────────────
    if "language" in deltas and catalog_item.original_language:
        lw    = dict(profile.language_weights or {})
        delta = deltas["language"] * decay
        key   = catalog_item.original_language
        lw[key] = max(0.1, lw.get(key, 1.0) + (delta * 0.1))
        profile.language_weights = lw

    # ── Negative Weights (Phase 9.2) ─────────────────────────────
    if signal_type in ["thumbs_down", "unwatched"]:
        nw = dict(profile.negative_weights or {})
        for gid in (catalog_item.genre_ids or []):
            k = f"genre_{gid}"
            nw[k] = nw.get(k, 0.0) + abs(deltas.get("genres", -10.0)) * decay
        for kid in (catalog_item.keyword_ids or []):
            k = f"keyword_{kid}"
            nw[k] = nw.get(k, 0.0) + abs(deltas.get("keyword", -5.0)) * decay
        profile.negative_weights = nw

    # Top-K Limits for Cast, Crew, Keywords
    TOP_K = 20
    if profile.cast_weights:
        profile.cast_weights = dict(sorted(profile.cast_weights.items(), key=lambda x: x[1], reverse=True)[:TOP_K])
    if profile.crew_weights:
        profile.crew_weights = dict(sorted(profile.crew_weights.items(), key=lambda x: x[1], reverse=True)[:TOP_K])
    if profile.keyword_weights:
        profile.keyword_weights = dict(sorted(profile.keyword_weights.items(), key=lambda x: x[1], reverse=True)[:TOP_K])

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


async def rebuild_taste_profile_from_history(
    db: AsyncSession,
    profile: UserTasteProfile,
) -> UserTasteProfile:
    """
    Populate UserTasteProfile weights in memory using existing watch history and watchlist,
    then update and commit.
    """
    user_id = profile.user_id
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.db.orm_models import WatchHistory, Watchlist, Movie
    from app.services.tmdb_service import ingest_item_to_catalog

    # 1. Fetch watch history and watchlist with movie relation
    watch_history_stmt = (
        select(WatchHistory)
        .where(WatchHistory.user_id == user_id)
        .options(selectinload(WatchHistory.movie))
    )
    watchlist_stmt = (
        select(Watchlist)
        .where(Watchlist.user_id == user_id)
        .options(selectinload(Watchlist.movie))
    )

    watch_history_rows = (await db.execute(watch_history_stmt)).scalars().all()
    watchlist_rows = (await db.execute(watchlist_stmt)).scalars().all()

    if not watch_history_rows and not watchlist_rows:
        return profile

    # Gather all tmdb_ids
    movie_ids = list({w.movie_id for w in watch_history_rows} | {w.movie_id for w in watchlist_rows})
    if not movie_ids:
        return profile

    # Batch fetch ContentCatalog items
    catalog_stmt = select(ContentCatalog).where(ContentCatalog.tmdb_id.in_(movie_ids))
    catalog_res = (await db.execute(catalog_stmt)).scalars().all()
    catalog_map = {(c.tmdb_id, c.media_type): c for c in catalog_res}

    # Compute weights in memory
    gw = {}
    cw = {}
    crw = {}
    ew = {}
    kw = {}
    lw = {}
    nw = {}
    total_interactions = 0

    def apply_signal_in_mem(catalog_item: ContentCatalog, signal_type: str):
        nonlocal total_interactions
        deltas = SIGNAL_DELTAS.get(signal_type, {})
        if not deltas:
            return

        # Genre weights
        if "genres" in deltas:
            delta = deltas["genres"]
            for gid in (catalog_item.genre_ids or []):
                key = str(gid)
                gw[key] = gw.get(key, 0.0) + delta

        # Cast weights
        if "cast" in deltas:
            delta = deltas["cast"]
            for pid in (catalog_item.cast_ids or []):
                key = str(pid)
                cw[key] = cw.get(key, 0.0) + delta

        # Crew weights
        if "crew" in deltas:
            delta = deltas["crew"]
            for pid in (catalog_item.crew_ids or {}).get("director", []):
                key = str(pid)
                crw[key] = crw.get(key, 0.0) + delta

        # Era weights
        if "era" in deltas and catalog_item.release_era:
            delta = deltas["era"]
            key = catalog_item.release_era
            ew[key] = ew.get(key, 0.0) + delta

        # Keyword weights
        if "keyword" in deltas:
            delta = deltas["keyword"]
            for kid in (catalog_item.keyword_ids or []):
                key = str(kid)
                kw[key] = kw.get(key, 0.0) + delta

        # Language weights
        if "language" in deltas and catalog_item.original_language:
            delta = deltas["language"]
            key = catalog_item.original_language
            lw[key] = lw.get(key, 1.0) + (delta * 0.1)

        # Negative Weights (Phase 9.2)
        if signal_type in ["thumbs_down", "unwatched"]:
            for gid in (catalog_item.genre_ids or []):
                k = f"genre_{gid}"
                nw[k] = nw.get(k, 0.0) + abs(deltas.get("genres", -10.0))
            for kid in (catalog_item.keyword_ids or []):
                k = f"keyword_{kid}"
                nw[k] = nw.get(k, 0.0) + abs(deltas.get("keyword", -5.0))

        total_interactions += 1

    # Process watch history
    for w in watch_history_rows:
        media_type = w.movie.type if w.movie else "movie"
        catalog_item = catalog_map.get((w.movie_id, media_type))
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, w.movie_id, media_type)
            if catalog_item:
                catalog_map[(w.movie_id, media_type)] = catalog_item
        if catalog_item:
            apply_signal_in_mem(catalog_item, "watched")

    # Process watchlist
    for w in watchlist_rows:
        media_type = w.movie.type if w.movie else "movie"
        catalog_item = catalog_map.get((w.movie_id, media_type))
        if not catalog_item:
            catalog_item = await ingest_item_to_catalog(db, w.movie_id, media_type)
            if catalog_item:
                catalog_map[(w.movie_id, media_type)] = catalog_item
        if catalog_item:
            apply_signal_in_mem(catalog_item, "watchlist")

    # Clamp language weights min limit to 0.1
    lw_clamped = {k: max(0.1, v) for k, v in lw.items()}

    TOP_K = 20
    cw_top = dict(sorted(cw.items(), key=lambda x: x[1], reverse=True)[:TOP_K]) if cw else {}
    crw_top = dict(sorted(crw.items(), key=lambda x: x[1], reverse=True)[:TOP_K]) if crw else {}
    kw_top = dict(sorted(kw.items(), key=lambda x: x[1], reverse=True)[:TOP_K]) if kw else {}

    # Save to profile
    profile.genre_weights = gw
    profile.cast_weights = cw_top
    profile.crew_weights = crw_top
    profile.era_weights = ew
    profile.keyword_weights = kw_top
    profile.language_weights = lw_clamped
    profile.negative_weights = nw
    profile.total_interactions = total_interactions
    profile.last_updated = datetime.now(timezone.utc)

    db.add(profile)
    try:
        await db.commit()
        await db.refresh(profile)
    except Exception as e:
        await db.rollback()
        logger.error(f"rebuild_taste_profile_from_history: commit failed for user={user_id}: {e}")
        raise

    # Invalidate cache keys for recommendations and profile
    try:
        await invalidate(key_user_recommendations(str(user_id)))
        await invalidate(key_taste_profile(str(user_id)))
    except Exception as e:
        logger.warning("rebuild_taste_profile_from_history: cache invalidation failed: %s", e)

    return profile
