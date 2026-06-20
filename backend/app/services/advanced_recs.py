"""
Movientum — Similar Items Service (Upgraded 11-step pipeline)

Final Pipeline:
1. Fetch (max 3 TMDB calls)
2. Merge results
3. Apply hard filters
4. Apply pre-rank filtering
5. Score items
6. Apply personalization boost
7. Sort by score
8. Apply diversity (after top 10)
9. Slice to 40 results
10. Cache final output (handled by router mostly, but we can do internal cache too)

Phase 3 additions:
- get_rwr_candidates()          — Personalised PageRank candidate retrieval
- get_catalog_rows_by_node_ids() — Batch fetch ContentCatalog rows by graph node IDs
- get_or_create_taste_profile() — Lazy-create UserTasteProfile
- build_feature_matrix()        — Compile 16-feature matrix for XGBRanker
- _catalog_to_dict()            — Serialise ContentCatalog → frontend dict
- get_new_model_recommendations() — Full ML inference pipeline (Steps 1-8)
"""
import asyncio
import logging
import math
from datetime import datetime
from math import log1p
from typing import Optional
from uuid import UUID

import networkx as nx
import numpy as np
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.cache import get_cached, set_cached
from app.db.orm_models import Movie, MovieGenre, WatchHistory, ContentCatalog, UserTasteProfile
from app.services.tmdb_service import tmdb_service as _tmdb, ingest_item_to_catalog
from app.routers.search import _tmdb_to_search_result

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────

async def safe_tmdb_call(coro, default=None, timeout: float = 4.0):
    """Run a TMDB coroutine with timeout. Returns default on failure."""
    try:
        return await asyncio.wait_for(coro, timeout=timeout)
    except Exception as e:
        logger.warning(f"TMDB call failed: {type(e).__name__} {e}")
        return default


def _local_movie_to_dict(movie) -> dict:
    genres = [mg.genre.name for mg in (movie.genres or [])]
    release_year = movie.release_date.year if movie.release_date else None
    return {
        "id": movie.id,
        "title": movie.title,
        "name": movie.title,
        "poster_path": movie.poster_path,
        "backdrop_path": movie.backdrop_path,
        "release_year": release_year,
        "genres": genres,
        "vote_average": float(movie.vote_average or 0),
        "vote_count": int(movie.vote_count or 0),
        "popularity": float(movie.popularity or 0),
        "media_type": getattr(movie, "type", "movie"),
        "genre_ids": [mg.genre_id for mg in (movie.genres or [])],
    }



def _passes_hard_guards(item: dict, exclude_id: int) -> bool:
    """Hard filters: has poster, vote_count >= 30, not itself."""
    if item.get("id") == exclude_id:
        return False
    if not item.get("poster_path"):
        return False
    if int(item.get("vote_count", 0)) < 30:
        return False
    return True


def passes_intensity_filter(cand_genres: set, current_genre_ids: set) -> bool:
    """Conditional intensity filter based on the source genres."""
    if not current_genre_ids:
        return True

    action_genres = {28, 12, 53, 878, 27, 14}
    calm_genres = {18, 99, 36, 10751, 10749, 10402}
    comedy_genre = {35}

    is_action_source = bool(current_genre_ids & action_genres)
    is_comedy_source = 35 in current_genre_ids
    is_calm_source = not is_action_source and not is_comedy_source

    if is_calm_source:
        # Calm filter: exclude Action (28), Horror (27), Thriller (53)
        if cand_genres & {28, 27, 53}:
            return False
    if is_action_source:
        # Action filter: must have at least one action-intensity genre
        if not (cand_genres & action_genres):
            return False
    if is_comedy_source:
        # Comedy filter: must have comedy
        if 35 not in cand_genres:
            return False
            
    return True


def _passes_strict_filter(item: dict, current_genre_ids: set) -> bool:
    """Strict quality, genre match, context, and intensity filters."""
    # Rating filter >= 6.5
    if float(item.get("vote_average", 0)) < 6.5:
        return False
        
    if not current_genre_ids:
        return True
        
    cand_genres = set(item.get("genre_ids", []))
    matched_genres = cand_genres & current_genre_ids
    
    # >= 2 genre match (dynamic)
    required_matches = min(2, len(current_genre_ids))
    if len(matched_genres) < required_matches:
        return False
        
    # Remove weak-only genres (Drama/Comedy only) & context filter
    if matched_genres.issubset({18, 35}):
        return False
        
    # Intensity filter
    if not passes_intensity_filter(cand_genres, current_genre_ids):
        return False
        
    return True


def _compute_score(item: dict, current_genre_ids: set) -> float:
    """
    score = 0.50 * genre_match + 0.25 * rating_score + 0.15 * popularity_score + 0.10 * recency_score
    """
    cand_genres = set(item.get("genre_ids", []))
    if current_genre_ids:
        genre_match = len(cand_genres & current_genre_ids) / len(current_genre_ids)
    else:
        genre_match = 0.0

    rating_score = float(item.get("vote_average", 0)) / 10.0
    popularity_score = math.log1p(float(item.get("popularity", 0)))
    
    # Recency score
    release_year = item.get("release_year")
    if not release_year:
        try:
            date_str = item.get("release_date") or item.get("first_air_date")
            if date_str:
                release_year = int(date_str.split("-")[0])
        except (ValueError, AttributeError):
            pass
            
    current_year = datetime.now().year
    recency_score = 0.0
    if release_year:
        years_old = current_year - release_year
        recency_score = max(0.0, 1.0 - (years_old * 0.02))
        
    return (0.50 * genre_match) + (0.25 * rating_score) + (0.15 * popularity_score) + (0.10 * recency_score)


async def _get_user_genre_profile(db: AsyncSession, user_id: UUID) -> dict:
    """Normalized genre freq from watch history. genre_id → fraction."""
    try:
        watched_stmt = select(WatchHistory.movie_id).where(WatchHistory.user_id == user_id)
        watched_result = await db.execute(watched_stmt)
        watched_ids = list(watched_result.scalars().all())
        if not watched_ids:
            return {}

        genre_stmt = (
            select(MovieGenre.genre_id, func.count(MovieGenre.genre_id).label("cnt"))
            .where(MovieGenre.movie_id.in_(watched_ids))
            .group_by(MovieGenre.genre_id)
        )
        genre_res = await db.execute(genre_stmt)
        counts = {row.genre_id: row.cnt for row in genre_res.all()}
        total = sum(counts.values())
        if total == 0:
            return {}
        return {gid: cnt / total for gid, cnt in counts.items()}
    except Exception as e:
        logger.warning(f"_get_user_genre_profile failed: {e}")
        return {}


async def get_catalog_row(db: AsyncSession, tmdb_id: int, media_type: str) -> Optional[ContentCatalog]:
    stmt = select(ContentCatalog).where(
        ContentCatalog.tmdb_id == tmdb_id,
        ContentCatalog.media_type == media_type
    )
    res = await db.execute(stmt)
    return res.scalar_one_or_none()


# ── Main Entry ────────────────────────────────────────────────────

async def get_advanced_similar_items(
    db: AsyncSession,
    item_id: int,
    media_type: str,
    user_id: Optional[UUID] = None,
) -> dict:
    """
    11-step similar items pipeline (refactored to two-stage filtering & relaxation).
    Returns flat list of up to 40 items wrapped in bucket keys for backward compatibility.
    """
    cache_key = f"rec:item:{item_id}:{media_type}:{user_id or 'guest'}"
    cached = await get_cached(cache_key)
    if cached:
        return cached

    # PHASE 2 INTEGRATION: Ensure item exists in ContentCatalog, otherwise ingest on-demand
    catalog_row = await get_catalog_row(db, item_id, media_type)
    if not catalog_row:
        catalog_row = await ingest_item_to_catalog(db, item_id, media_type)
        
    if not catalog_row:
        return {"bucket_1": [], "bucket_2": [], "bucket_3": []}

    current_genre_ids: set = set(catalog_row.genre_ids) if catalog_row.genre_ids else set()

    genre_ids_str = ",".join(str(g) for g in current_genre_ids) if current_genre_ids else ""
    cross_type = "tv" if media_type == "movie" else "movie"

    # Concurrently fetch TMDB candidates
    rec_coro = (
        _tmdb.fetch_movie_recommendations(item_id)
        if media_type == "movie"
        else _tmdb.fetch_tv_recommendations(item_id)
    )
    sim_coro = (
        _tmdb.fetch_similar_movies(item_id)
        if media_type == "movie"
        else _tmdb.fetch_similar_tv(item_id)
    )
    cross_coro = (
        _tmdb.discover_tv(genre_ids_str)
        if media_type == "movie" and genre_ids_str
        else _tmdb.discover_movies(genre_ids_str)
        if genre_ids_str
        else None
    )

    tasks = [
        safe_tmdb_call(rec_coro, default={"results": []}),
        safe_tmdb_call(sim_coro, default={"results": []}),
    ]
    if cross_coro:
        tasks.append(safe_tmdb_call(cross_coro, default={"results": []}))

    results = await asyncio.gather(*tasks, return_exceptions=True)

    recs_raw = results[0].get("results", []) if isinstance(results[0], dict) else []
    sims_raw = results[1].get("results", []) if isinstance(results[1], dict) else []
    cross_raw = results[2].get("results", []) if len(results) > 2 and isinstance(results[2], dict) else []

    # Tag media types
    for item in recs_raw:
        item["media_type"] = media_type
    for item in sims_raw:
        item["media_type"] = media_type
    for item in cross_raw:
        item["media_type"] = cross_type

    # Merge (Order: recommendations -> discover -> similar)
    merged = recs_raw + cross_raw + sims_raw

    # deduplicate early to avoid unnecessary processing
    seen: set = set()
    unique: list[dict] = []
    for c in merged:
        key = f"{c.get('id')}_{c.get('media_type', 'movie')}"
        if key not in seen:
            seen.add(key)
            unique.append(c)
    merged = unique

    # Hard filter (poster, vote_count)
    valid_candidates = []
    for c in merged:
        if not _passes_hard_guards(c, item_id):
            continue
        valid_candidates.append(c)

    # TWO-STAGE FILTERING & RELAXATION
    # Stage 1: Strict filter
    strict_candidates = [c for c in valid_candidates if _passes_strict_filter(c, current_genre_ids)]
    candidates = list(strict_candidates)

    # Stage 2: Relax Level 1
    if len(candidates) < 40:
        relaxed_1 = [
            c for c in valid_candidates
            if (
                len(set(c.get("genre_ids", [])) & current_genre_ids) >= 1
                and float(c.get("vote_average", 0)) >= 7.0
            )
        ]
        # deduplicated merge
        seen = {f"{c['id']}_{c.get('media_type', 'movie')}" for c in candidates}
        for c in relaxed_1:
            key = f"{c['id']}_{c.get('media_type', 'movie')}"
            if key not in seen:
                seen.add(key)
                candidates.append(c)

    # Stage 2: Relax Level 2
    if len(candidates) < 40:
        relaxed_2 = [
            c for c in valid_candidates
            if float(c.get("vote_average", 0)) >= 7.2
        ]
        # deduplicated merge
        seen = {f"{c['id']}_{c.get('media_type', 'movie')}" for c in candidates}
        for c in relaxed_2:
            key = f"{c['id']}_{c.get('media_type', 'movie')}"
            if key not in seen:
                seen.add(key)
                candidates.append(c)

    # Stage 2: Fallback
    if len(candidates) < 40:
        fallback = [
            c for c in valid_candidates
            if float(c.get("vote_average", 0)) >= 6.5
        ]
        # deduplicated merge
        seen = {f"{c['id']}_{c.get('media_type', 'movie')}" for c in candidates}
        for c in fallback:
            key = f"{c['id']}_{c.get('media_type', 'movie')}"
            if key not in seen:
                seen.add(key)
                candidates.append(c)

    # Convert candidates to frontend search result format
    candidates_formatted = [_tmdb_to_search_result(c) for c in candidates]

    # Score items (NO filtering here)
    for c in candidates_formatted:
        c["_score"] = _compute_score(c, current_genre_ids)

    # Sort descending
    candidates_formatted.sort(key=lambda x: x["_score"], reverse=True)

    # Apply personalization boost (NO filtering here)
    if user_id:
        user_profile = await _get_user_genre_profile(db, user_id)
        if user_profile:
            top_genres = sorted(user_profile.items(), key=lambda x: x[1], reverse=True)[:2]
            top_2_genre_ids = {g[0] for g in top_genres}
            
            top_half_idx = len(candidates_formatted) // 2
            for i in range(top_half_idx):
                item = candidates_formatted[i]
                cand_genres = set(item.get("genre_ids", []))
                if cand_genres & top_2_genre_ids:
                    item["_score"] *= 1.2
                    
            # Re-sort after personalization boost
            candidates_formatted.sort(key=lambda x: x["_score"], reverse=True)

    # Slice 40
    final = candidates_formatted[:40]

    # Clean internal fields
    for c in final:
        c.pop("_score", None)

    # Wrap in buckets for backward compat with router
    buckets = {
        "bucket_1": final[0:15],
        "bucket_2": final[15:30],
        "bucket_3": final[30:40],
    }

    try:
        # Cache final output (15 min = 900s)
        await set_cached(cache_key, buckets, 900)
    except Exception as e:
        logger.warning(f"Cache set failed: {e}")

    logger.info("SIMPLE_SIMILAR_ITEMS", extra={"item_id": item_id, "media_type": media_type, "count": len(final)})
    return buckets


# ═══════════════════════════════════════════════════════════════════════════════
# PHASE 3 — Graph Coordinate Space & Candidate Retrieval
# ═══════════════════════════════════════════════════════════════════════════════

# ── RWR Candidate Retrieval ───────────────────────────────────────

def get_rwr_candidates(
    G: nx.Graph,
    seed_node: str,          # e.g. "m:550" for Interstellar, "tv:1399" for GoT
    top_k: int = 200,
    alpha: float = 0.15,     # restart probability (teleport back to seed)
    max_iter: int = 50,
) -> list[str]:
    """
    Runs Personalized PageRank (Random Walk with Restart) from seed_node.
    Returns top_k ContentNode IDs (strings) ranked by visit frequency.

    RWR formula per iteration:
        r_{t+1} = (1 - alpha) × A_norm × r_t  +  alpha × e_seed
    where:
        A_norm  = row-normalised weighted adjacency matrix
        e_seed  = one-hot seed vector
        alpha   = restart probability (0.15 = moderate exploration)

    NetworkX pagerank() implements this via sparse power iteration internally.
    alpha=0.15 → damping=0.85 in NetworkX convention.
    """
    if seed_node not in G:
        logger.warning("RWR: seed_node '%s' not in graph", seed_node)
        return []

    try:
        ppr = nx.pagerank(
            G,
            alpha=(1 - alpha),          # NetworkX uses (1-alpha) as damping factor
            personalization={seed_node: 1.0},
            weight="weight",
            max_iter=max_iter,
            tol=1e-6,
        )
    except Exception as e:
        logger.warning("RWR pagerank failed: %s", e)
        return []

    # Keep only ContentNodes; exclude seed itself
    content_scores = {
        nid: score
        for nid, score in ppr.items()
        if G.nodes[nid].get("type") == "content" and nid != seed_node
    }

    ranked = sorted(content_scores, key=content_scores.get, reverse=True)
    return ranked[:top_k]


# ── DB Helpers ───────────────────────────────────────────────────

async def get_catalog_rows_by_node_ids(
    db: AsyncSession,
    node_ids: list[str],
) -> list[ContentCatalog]:
    """
    Batch-fetch ContentCatalog rows for a list of graph node IDs.
    Node IDs have format "m:{tmdb_id}" or "tv:{tmdb_id}".

    Preserves caller ordering by building a lookup dict keyed on
    (tmdb_id, media_type) and re-ordering to match node_ids.
    """
    if not node_ids:
        return []

    # Parse node IDs into (media_type, tmdb_id) pairs
    pairs: list[tuple[str, int]] = []
    for nid in node_ids:
        try:
            prefix, tmdb_str = nid.split(":", 1)
            media_type = "movie" if prefix == "m" else "tv"
            pairs.append((media_type, int(tmdb_str)))
        except (ValueError, AttributeError):
            continue

    if not pairs:
        return []

    # Single IN-style query: fetch all matched rows
    tmdb_ids = [p[1] for p in pairs]
    stmt = select(ContentCatalog).where(ContentCatalog.tmdb_id.in_(tmdb_ids))
    result = await db.execute(stmt)
    raw_rows = result.scalars().all()

    # Build lookup (tmdb_id, media_type) → row
    lookup: dict[tuple[int, str], ContentCatalog] = {}
    for row in raw_rows:
        lookup[(row.tmdb_id, row.media_type)] = row

    # Return in same order as node_ids, skipping any not found in DB
    ordered: list[ContentCatalog] = []
    for media_type, tmdb_id in pairs:
        row = lookup.get((tmdb_id, media_type))
        if row:
            ordered.append(row)

    return ordered


async def get_or_create_taste_profile(
    db: AsyncSession,
    user_id: UUID,
) -> UserTasteProfile:
    """
    Fetch UserTasteProfile for user_id, creating a blank one if absent.
    """
    stmt = select(UserTasteProfile).where(UserTasteProfile.user_id == user_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()

    if profile is None:
        profile = UserTasteProfile(
            user_id=user_id,
            genre_weights={},
            cast_weights={},
            crew_weights={},
            keyword_weights={},
            language_weights={},
            era_weights={},
            total_interactions=0,
            avg_rating_given=0.0,
        )
        db.add(profile)
        try:
            await db.commit()
            await db.refresh(profile)
        except Exception as e:
            await db.rollback()
            logger.warning("Could not create UserTasteProfile for %s: %s", user_id, e)
            result = await db.execute(stmt)
            profile = result.scalar_one_or_none()

    # Rebuild profile if it's completely new/empty and user has pre-existing history/watchlist
    if profile and profile.total_interactions == 0:
        try:
            from app.services.feedback_service import rebuild_taste_profile_from_history
            profile = await rebuild_taste_profile_from_history(db, profile)
        except Exception as e:
            logger.warning(f"Failed to rebuild taste profile from history: {e}")

    return profile


# ── Feature Matrix ───────────────────────────────────────────────

def build_feature_matrix(
    candidates: list[ContentCatalog],
    ppr_scores: dict[str, float],
    origin: ContentCatalog,
    taste: Optional[UserTasteProfile],
    total_candidates: int = 100,
) -> np.ndarray:
    """
    Builds an (N × 16) float32 feature matrix for XGBRanker inference.
    N = len(candidates), typically ≤ 100.

    Column order (matches ranker training schema):
        0  ppr_score
        1  ppr_rank_norm
        2  vote_average
        3  vote_count_log
        4  popularity_log
        5  recency_score
        6  user_genre_score
        7  user_cast_score
        8  user_crew_score
        9  user_keyword_score
        10 user_era_score
        11 user_language_mult
        12 genre_overlap_count
        13 cast_overlap_count
        14 same_language
        15 same_era
    """
    if not candidates:
        return np.zeros((0, 16), dtype=np.float32)

    # Pre-sort candidates by ppr_score for rank normalisation
    def _ppr(item: ContentCatalog) -> float:
        nid = f"{'m' if item.media_type == 'movie' else 'tv'}:{item.tmdb_id}"
        return ppr_scores.get(nid, 0.0)

    sorted_cands = sorted(candidates, key=_ppr, reverse=True)
    n = len(sorted_cands)

    origin_genres = set(origin.genre_ids or [])
    origin_cast   = set(origin.cast_ids or [])

    rows = []
    for rank, item in enumerate(sorted_cands):
        nid     = f"{'m' if item.media_type == 'movie' else 'tv'}:{item.tmdb_id}"
        ppr     = ppr_scores.get(nid, 0.0)
        ppr_norm = 1.0 - (rank / max(total_candidates - 1, 1))

        # ── Static content features ───────────────────────────────
        vote_avg  = float(item.vote_average or 0.0)
        vote_log  = log1p(float(item.vote_count or 0))
        pop_log   = log1p(float(item.popularity or 0.0))
        year      = item.release_year or 2000
        recency   = 1.0 / (2026 - year + 1)

        # ── Personalised features (zero if no taste profile) ──────
        genre_score = keyword_score = cast_score = crew_score = 0.0
        era_score   = 0.0
        lang_mult   = 1.0

        if taste:
            gw = taste.genre_weights or {}
            genre_score = sum(gw.get(str(gid), 0.0) for gid in (item.genre_ids or []))

            kw = taste.keyword_weights or {}
            keyword_score = sum(kw.get(str(kid), 0.0) for kid in (item.keyword_ids or []))

            cw = taste.cast_weights or {}
            cast_score = sum(cw.get(str(pid), 0.0) for pid in (item.cast_ids or []))

            crw = taste.crew_weights or {}
            crew_score = sum(
                crw.get(str(pid), 0.0)
                for pid in (item.crew_ids or {}).get("director", [])
            )

            era_score = (taste.era_weights or {}).get(item.release_era or "", 0.0)
            lang_mult = (taste.language_weights or {}).get(item.original_language or "", 1.0)

            # Apply Negative Penalties (Phase 9.2)
            if taste.negative_weights:
                nw = taste.negative_weights
                genre_penalty = sum(nw.get(f"genre_{gid}", 0.0) for gid in (item.genre_ids or []))
                keyword_penalty = sum(nw.get(f"keyword_{kid}", 0.0) for kid in (item.keyword_ids or []))
                genre_score -= genre_penalty
                keyword_score -= keyword_penalty

        # ── Structural overlap with origin item ───────────────────
        genre_overlap = len(origin_genres & set(item.genre_ids or []))
        cast_overlap  = len(origin_cast   & set(item.cast_ids or []))
        same_lang     = int(item.original_language == origin.original_language)
        same_era      = int(item.release_era == origin.release_era)

        rows.append([
            ppr, ppr_norm,
            vote_avg, vote_log, pop_log, recency,
            genre_score, cast_score, crew_score, keyword_score,
            era_score, lang_mult,
            genre_overlap, cast_overlap, same_lang, same_era,
        ])

    return np.array(rows, dtype=np.float32)


# ── Serialiser ───────────────────────────────────────────────────

def _catalog_to_dict(item: ContentCatalog) -> dict:
    """Serialise a ContentCatalog ORM row to the frontend-compatible dict."""
    return {
        "id":               item.tmdb_id,
        "tmdb_id":          item.tmdb_id,
        "media_type":       item.media_type,
        "title":            item.title or "Unknown",
        "name":             item.title or "Unknown",
        "poster_path":      item.poster_path,
        "backdrop_path":    None,                # not stored in catalog
        "vote_average":     float(item.vote_average or 0.0),
        "vote_count":       int(item.vote_count or 0),
        "popularity":       float(item.popularity or 0.0),
        "release_year":     item.release_year,
        "genre_ids":        item.genre_ids or [],
        "original_language": item.original_language,
        "release_era":      item.release_era,
    }


# ── Full ML Inference Pipeline ────────────────────────────────────

async def get_new_model_recommendations(
    db: AsyncSession,
    tmdb_id: int,
    media_type: str,
    user_id: Optional[UUID] = None,
    top_n: int = 20,
) -> list[dict]:
    """
    Phase 3 full inference pipeline:

    1. Ensure origin item exists in content_catalog (ingest if missing)
    2. Get / build in-memory graph
    3. RWR candidate retrieval (top 100 ContentNodes)
    4. Batch-fetch ContentCatalog rows for candidates
    5. Fetch / create UserTasteProfile (if authenticated)
    6. Build (N × 16) feature matrix
    7. XGBRanker inference → ranked indices
    8. Return top_n serialised dicts

    Graceful degradation at every step — returns [] rather than raising.
    """
    # Lazy import to avoid circular dependency at module load time
    from app.services.graph_cache import get_or_build_graph
    from app.ml.ranker import rank_candidates

    # ── Step 1: Ensure origin in catalog ─────────────────────────
    origin = await get_catalog_row(db, tmdb_id, media_type)
    if not origin:
        logger.info("ML pipeline: origin not in catalog — ingesting %s/%s", media_type, tmdb_id)
        origin = await ingest_item_to_catalog(db, tmdb_id, media_type)
    if not origin:
        logger.warning("ML pipeline: cannot ingest %s/%s — aborting", media_type, tmdb_id)
        return []

    # ── Step 2: Get graph ─────────────────────────────────────────
    try:
        G = await get_or_build_graph(db)
    except Exception as e:
        logger.error("ML pipeline: graph build failed: %s", e)
        return []

    seed = f"{'m' if media_type == 'movie' else 'tv'}:{tmdb_id}"

    # ── Step 3: RWR candidates ────────────────────────────────────
    candidate_node_ids = get_rwr_candidates(G, seed, top_k=100)
    if not candidate_node_ids:
        logger.warning("ML pipeline: RWR returned 0 candidates for seed '%s'", seed)
        return []

    # ── Step 4: Fetch catalog rows for candidates ─────────────────
    candidates = await get_catalog_rows_by_node_ids(db, candidate_node_ids)
    if not candidates:
        logger.warning("ML pipeline: no DB rows found for %d candidate nodes", len(candidate_node_ids))
        return []

    # ── Step 5: Taste profile ─────────────────────────────────────
    taste: Optional[UserTasteProfile] = None
    if user_id:
        try:
            taste = await get_or_create_taste_profile(db, user_id)
        except Exception as e:
            logger.warning("ML pipeline: taste profile fetch failed: %s", e)

    # ── Step 6: Feature matrix ────────────────────────────────────
    # Build a ppr_scores dict from candidate order (position → score proxy)
    # node_id → true PPR score would require returning scores from get_rwr_candidates;
    # for the feature matrix we use rank-derived proxy scores (1.0 → 0.01).
    n_cands = len(candidate_node_ids)
    ppr_proxy = {
        nid: 1.0 - (i / max(n_cands - 1, 1)) * 0.99
        for i, nid in enumerate(candidate_node_ids)
    }

    matrix = build_feature_matrix(
        candidates, ppr_proxy, origin, taste, total_candidates=n_cands
    )

    # ── Step 7: Rank ──────────────────────────────────────────────
    try:
        ranked_indices = rank_candidates(matrix)
    except Exception as e:
        logger.warning("ML pipeline: rank_candidates failed: %s — using identity order", e)
        ranked_indices = list(range(len(candidates)))

    # ── Step 8: Return top_n ──────────────────────────────────────
    results = []
    for i in ranked_indices[:top_n]:
        if 0 <= i < len(candidates):
            results.append(_catalog_to_dict(candidates[i]))

    logger.info(
        "ML pipeline: returned %d results for %s/%s (user=%s)",
        len(results), media_type, tmdb_id, user_id,
    )
    return results
