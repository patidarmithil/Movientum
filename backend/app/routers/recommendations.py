"""
Movientum — Recommendations Router (Phase 5: Ensemble Blending)

Endpoints:
  GET /api/v1/recommendations               → [AUTH] 60/40 TDI blend (ML + baseline) | [GUEST] trending
  GET /api/v1/recommendations/similar/{id}  → 70/30 TDI blend (ML + baseline), 100 results

Phase 5 changes:
  - team_draft_interleave() — TDI blending algorithm
  - GET / upgraded: hybrid blend for authenticated users, baseline for anonymous
  - GET /similar/{id} upgraded: 70/30 blend returning 100 results, excludes watched/watchlist
"""
import logging
import random
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.cache import (
    TTL_USER_RECS,
    get_cached,
    key_user_recommendations,
    set_cached,
)
from app.db.database import get_db
from app.db.orm_models import WatchHistory, Watchlist
from app.services import recommendation_service
from app.services.advanced_recs import get_new_model_recommendations
from app.utils.deps import get_current_user, get_optional_user

router = APIRouter()
logger = logging.getLogger(__name__)

_TTL_SIMILAR   = 1800   # 30 min for similar (heavier computation)
_TTL_ANON_RECS = 600    # 10 min for anonymous recommendations


# ── Team-Draft Interleaving ───────────────────────────────────────

def team_draft_interleave(
    list_a: list[dict],    # New model results (higher ratio team)
    list_b: list[dict],    # Baseline model results (lower ratio team)
    k: int = 20,
    ratio_a: float = 0.6,
) -> list[dict]:
    """
    Team-Draft Interleaving producing k deduplicated results.

    Industry-standard A/B blend algorithm (Netflix, Spotify, YouTube).
    Avoids position bias by deterministically distributing slots and
    shuffling assignment order for natural feel.

    Args:
        list_a:   New ML model results (allocated ratio_a fraction of slots).
        list_b:   Baseline results (allocated 1-ratio_a fraction of slots).
        k:        Target output size.
        ratio_a:  Fraction of slots for list_a (0.6 = 60% new model).

    Guarantees:
      - No duplicates (deduped by tmdb_id + media_type).
      - Graceful degradation: if one pool exhausted, fills from the other.
      - Ratio is deterministic per call (slots pre-computed) but shuffled for
        natural feel.
    """
    result:   list[dict] = []
    seen_ids: set         = set()
    ptr_a = ptr_b = 0

    # Deterministic slot allocation
    slots_a = round(k * ratio_a)
    slots_b = k - slots_a

    def pick_next(lst: list[dict], ptr: int, seen: set):
        """Advance ptr until an unseen item is found, or exhaust list."""
        while ptr < len(lst):
            item = lst[ptr]
            key  = (item.get("tmdb_id") or item.get("id"), item.get("media_type", "movie"))
            ptr += 1
            if key not in seen:
                return item, ptr
        return None, ptr

    # Build interleave queue: True = pick from A, False = pick from B
    queue: list[bool] = [False] * slots_b + [True] * slots_a
    random.shuffle(queue)

    for pick_from_a in queue:
        if len(result) >= k:
            break

        if pick_from_a:
            item, ptr_a = pick_next(list_a, ptr_a, seen_ids)
            if item is None:           # A exhausted — fall back to B
                item, ptr_b = pick_next(list_b, ptr_b, seen_ids)
        else:
            item, ptr_b = pick_next(list_b, ptr_b, seen_ids)
            if item is None:           # B exhausted — fall back to A
                item, ptr_a = pick_next(list_a, ptr_a, seen_ids)

        if item:
            key = (item.get("tmdb_id") or item.get("id"), item.get("media_type", "movie"))
            seen_ids.add(key)
            result.append(item)

    return result


# ── Normalise item dict ───────────────────────────────────────────

def _normalise(item: dict) -> dict:
    """
    Ensure both 'id' and 'tmdb_id' are present (some sources provide only one).
    Also ensures 'media_type' defaults to 'movie'.
    """
    if "tmdb_id" not in item and "id" in item:
        item["tmdb_id"] = item["id"]
    if "id" not in item and "tmdb_id" in item:
        item["id"] = item["tmdb_id"]
    item.setdefault("media_type", "movie")
    return item


# ── GET /recommendations ──────────────────────────────────────────

@router.get(
    "",
    summary="Personalized movie recommendations",
    response_description="20 items — 60% ML model + 40% baseline for auth users, trending for guests",
)
async def get_recommendations(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    [AUTH] Personalized picks for the authenticated user.

    Phase 5 algorithm (TDI Blend):
    - Authenticated: 60% new ML model (PPR + XGBRanker) + 40% baseline (genre-affinity)
    - Falls back to baseline-only if the ML pipeline fails or catalog is empty.
    - Falls back to baseline if the user has no watch history for seed selection.

    Cache: per-user, 15-minute TTL.
    """
    user_id_str = current_user["sub"]
    user_id     = UUID(user_id_str)
    cache_key   = key_user_recommendations(user_id_str)

    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return cached

    # ── Step 1: Get watch seed for ML pipeline ────────────────────
    seed = await recommendation_service.get_user_watch_seed(db, user_id)

    new_pool: list[dict] = []
    if seed:
        try:
            raw = await get_new_model_recommendations(
                db,
                tmdb_id=seed["tmdb_id"],
                media_type=seed["media_type"],
                user_id=user_id,
                top_n=30,
            )
            new_pool = [_normalise(m) for m in raw]
        except Exception as e:
            logger.warning("ML pipeline failed for user %s: %s — falling back", user_id_str, e)

    # ── Step 2: Baseline pool ─────────────────────────────────────
    base_pool: list[dict] = []
    try:
        raw_base = await recommendation_service.get_baseline_recommendations(
            db, user_id=user_id, limit=30
        )
        base_pool = [_normalise(m) for m in raw_base]
    except Exception as e:
        logger.warning("Baseline pipeline failed for user %s: %s", user_id_str, e)

    # ── Step 3: Blend ─────────────────────────────────────────────
    if new_pool and base_pool:
        movies = team_draft_interleave(new_pool, base_pool, k=20, ratio_a=0.6)
        source = "tdi_blend_60_40"
    elif new_pool:
        movies = new_pool[:20]
        source = "ml_only_fallback"
    elif base_pool:
        movies = base_pool[:20]
        source = "baseline_only_fallback"
    else:
        movies = []
        source = "empty"

    # ── Step 4: Moctale ratings enrichment ───────────────────────
    if movies:
        try:
            from app.routers.movies import _bulk_fetch_moctale
            item_ids   = [m["id"] for m in movies]
            item_types = [m.get("media_type", "movie") for m in movies]
            moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
            for m in movies:
                m["moctale_rating"] = moctale_map.get(m["id"])
        except Exception as e:
            logger.warning("Moctale enrichment failed: %s", e)

    result = {"movies": movies, "source": source}
    await set_cached(cache_key, result, TTL_USER_RECS)
    logger.info("RECS source=%s count=%d user=%s", source, len(movies), user_id_str)
    return result


# ── GET /recommendations/similar/{item_id} ────────────────────────

@router.get(
    "/similar/{item_id}",
    summary="Similar items (Phase 5: 70/30 blend)",
    response_description="Up to 100 similar items via 70% ML + 30% baseline TDI blend",
)
async def get_similar_items(
    item_id: int,
    media_type: str = "movie",
    db: AsyncSession = Depends(get_db),
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """
    Blended similar items endpoint returning up to 100 results:
    - 70% from New Model (PPR graph + XGBRanker similarity)
    - 30% from Old Model (TMDB-based similarity pipeline)
    - For authenticated users: excludes watched history and watchlist items.

    Cache: per-user/item, 30-minute TTL.
    """
    user_id_str = current_user["sub"] if current_user else "guest"
    user_uuid   = UUID(current_user["sub"]) if current_user else None

    # Include user_id in cache key because personalised filtering changes output
    cache_key = f"rec:item:{item_id}:{media_type}:{user_id_str}:v5"

    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return cached

    # ── Step 1: Collect exclusion IDs (watch history + watchlist) ─
    exclude_ids: set[int] = {item_id}     # always exclude seed itself
    if user_uuid:
        try:
            watch_stmt = select(WatchHistory.movie_id).where(
                WatchHistory.user_id == user_uuid
            )
            watch_res = await db.execute(watch_stmt)
            exclude_ids.update(watch_res.scalars().all())

            wl_stmt = select(Watchlist.movie_id).where(
                Watchlist.user_id == user_uuid
            )
            wl_res = await db.execute(wl_stmt)
            exclude_ids.update(wl_res.scalars().all())
        except Exception as e:
            logger.warning("Failed to fetch exclusion IDs for user %s: %s", user_uuid, e)

    # ── Step 2: New Model pool (Graph + XGBoost) ──────────────────
    new_pool: list[dict] = []
    try:
        raw_new = await get_new_model_recommendations(
            db, item_id, media_type, user_id=user_uuid, top_n=150
        )
        new_pool = [
            _normalise(m) for m in raw_new
            if m.get("id") not in exclude_ids
        ]
    except Exception as e:
        logger.warning("ML similar pipeline failed for %s/%s: %s", media_type, item_id, e)

    # ── Step 3: Baseline pool (TMDB-based) ───────────────────────
    old_pool: list[dict] = []
    try:
        raw_old = await recommendation_service.get_baseline_similar_items(
            db, item_id=item_id, media_type=media_type, user_id=user_uuid, limit=80
        )
        old_pool = [
            _normalise(m) for m in raw_old
            if m.get("id") not in exclude_ids
        ]
    except Exception as e:
        logger.warning("Baseline similar pipeline failed for %s/%s: %s", media_type, item_id, e)

    # ── Step 4: Blend 70/30 → 100 results ────────────────────────
    if new_pool and old_pool:
        blended = team_draft_interleave(new_pool, old_pool, k=100, ratio_a=0.70)
        source = "blended_70_30"
    elif new_pool:
        blended = new_pool[:100]
        source = "ml_only_fallback"
    elif old_pool:
        blended = old_pool[:100]
        source = "baseline_only_fallback"
    else:
        blended = []
        source = "empty"

    # ── Step 5: Moctale ratings enrichment ───────────────────────
    if blended:
        try:
            from app.routers.movies import _bulk_fetch_moctale
            item_ids   = [m["id"] for m in blended]
            item_types = [m.get("media_type", "movie") for m in blended]
            moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
            for m in blended:
                m["moctale_rating"] = moctale_map.get(m["id"])
        except Exception as e:
            logger.warning("Moctale enrichment failed: %s", e)

    result = {
        "movies":     blended,
        "movie_id":   item_id,
        "media_type": media_type,
        "source":     source,
        "count":      len(blended),
    }

    await set_cached(cache_key, result, _TTL_SIMILAR)
    logger.info(
        "SIMILAR source=%s count=%d item=%s/%s user=%s",
        source, len(blended), media_type, item_id, user_id_str,
    )
    return result
