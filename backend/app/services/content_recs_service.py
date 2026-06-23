import logging
import json
import hashlib
import random
import math
from typing import List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.db.orm_models import ContentCatalog
from app.db.cache import get_cached, set_cached
from app.services.graph_cache import get_or_build_graph
from app.services.advanced_recs import get_rwr_candidates, _catalog_to_dict
from app.services import tmdb_service

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

logger = logging.getLogger(__name__)

async def get_content_basket_recommendations(
    db: AsyncSession,
    items: List[Dict[str, Any]],
    page: int = 1,
    user_id=None
) -> Dict[str, Any]:
    """
    Phase 2 implementation for content recommendations.
    """
    # Deterministic Seeding
    sorted_items_json = json.dumps(sorted(items, key=lambda x: (x["tmdb_id"], x["media_type"])))
    items_hash = hashlib.sha256(sorted_items_json.encode()).hexdigest()
    random.seed(items_hash)
    
    # 1. Check Page Cache
    page_cache_key = f"rec:content:{items_hash}:page:{page}"
    cached_page = await get_cached(page_cache_key)
    if cached_page:
        logger.info(f"CACHE_HIT key={page_cache_key}")
        return cached_page

    basket_keys = [(item["tmdb_id"], item["media_type"]) for item in items]
    basket_set = set(basket_keys)
    
    # 2. Check/Build RWR Cache (Candidates & Traits)
    rwr_cache_key = f"rec:content:rwr:{items_hash}"
    cached_rwr = await get_cached(rwr_cache_key)
    
    if cached_rwr:
        basket_genres = set(cached_rwr.get("basket_genres", []))
        basket_keywords = set(cached_rwr.get("basket_keywords", []))
        common_genres = set(cached_rwr.get("common_genres", []))
        merged_rwr_score = cached_rwr.get("merged_rwr_score", {})
    else:
        # Fetch catalog rows for basket items
        tmdb_ids = [k[0] for k in basket_keys]
        stmt = select(ContentCatalog).where(ContentCatalog.tmdb_id.in_(tmdb_ids))
        res = await db.execute(stmt)
        catalog_rows = res.scalars().all()
        
        # Filter to actual matched media types
        matched_rows = [
            row for row in catalog_rows
            if (row.tmdb_id, row.media_type) in basket_keys
        ]
        
        # Sort by popularity
        sorted_rows = sorted(matched_rows, key=lambda x: x.popularity or 0.0, reverse=True)
        top_seeds = sorted_rows[:2]
        
        # Trait extraction
        basket_genres = set()
        basket_keywords = set()
        genre_counts = {}
        for row in matched_rows:
            if row.genre_ids:
                for g in row.genre_ids:
                    basket_genres.add(g)
                    genre_counts[g] = genre_counts.get(g, 0) + 1
            if row.keyword_ids:
                for k in row.keyword_ids:
                    basket_keywords.add(k)
        
        common_genres = set()
        if matched_rows:
            common_genres = set(matched_rows[0].genre_ids or [])
            for row in matched_rows[1:]:
                common_genres.intersection_update(set(row.genre_ids or []))
        
        # Strategy A (RWR Multi-seed)
        G = await get_or_build_graph(db)
        merged_rwr_score = {}
        if G:
            for seed_row in top_seeds:
                seed_node = f"{seed_row.media_type}_{seed_row.tmdb_id}"
                if G.has_node(seed_node):
                    candidates = get_rwr_candidates(G, seed_node, top_k=80)
                    for k, v in candidates.items():
                        merged_rwr_score[k] = max(merged_rwr_score.get(k, 0), v)
        
        await set_cached(rwr_cache_key, {
            "basket_genres": list(basket_genres),
            "basket_keywords": list(basket_keywords),
            "common_genres": list(common_genres),
            "merged_rwr_score": merged_rwr_score
        }, 1800)

    # 3. Retrieve RWR Candidates from DB
    rwr_candidates = []
    if merged_rwr_score:
        rwr_candidate_ids = set(merged_rwr_score.keys())
        movie_ids = [int(n.split("_")[1]) for n in rwr_candidate_ids if n.startswith("movie_")]
        tv_ids = [int(n.split("_")[1]) for n in rwr_candidate_ids if n.startswith("tv_")]
        
        conditions = []
        if movie_ids:
            conditions.append((ContentCatalog.media_type == "movie") & (ContentCatalog.tmdb_id.in_(movie_ids)))
        if tv_ids:
            conditions.append((ContentCatalog.media_type == "tv") & (ContentCatalog.tmdb_id.in_(tv_ids)))
            
        if conditions:
            c_stmt = select(ContentCatalog).where(or_(*conditions))
            c_res = await db.execute(c_stmt)
            rwr_candidates = [_catalog_to_dict(r) for r in c_res.scalars().all()]
            
    # 4. Strategy B (TMDB Discovery - Pagination dependent)
    tmdb_candidates = []
    discover_genres = list(common_genres) if common_genres else list(basket_genres)[:3]
    
    if discover_genres:
        genre_str = ",".join(map(str, discover_genres))
        tmdb_service_instance = tmdb_service.TMDBService()
        try:
            tmdb_page = math.ceil(page / 2.0) if page > 0 else 1
            movies = await tmdb_service_instance.discover_movies(genre_str, page=tmdb_page)
            if movies and "results" in movies:
                for m in movies["results"]:
                    m["media_type"] = "movie"
                    tmdb_candidates.append(m)
        except Exception as e:
            logger.warning(f"TMDB discovery failed: {e}")
            
    # 5. Interleave
    blended = team_draft_interleave(rwr_candidates, tmdb_candidates, k=len(rwr_candidates) + len(tmdb_candidates), ratio_a=0.7)
    
    # 6. Seen Tracking
    seen_cache_key = f"rec:content:{items_hash}:seen"
    seen_keys = set()
    if page > 1:
        cached_seen = await get_cached(seen_cache_key)
        if cached_seen:
            seen_keys = set(tuple(k) for k in cached_seen)
            
    # 7. Scoring & Hard Filters
    scored_candidates = []
    max_rwr = max(merged_rwr_score.values()) if merged_rwr_score else 1.0
    if max_rwr == 0: max_rwr = 1.0
    
    for c in blended:
        key = (c.get("tmdb_id") or c.get("id"), c.get("media_type", "movie"))
        
        # Hard Filter
        if key in basket_set:
            continue
        if c.get("vote_count", 0) < 50:
            continue
        if not c.get("poster_path"):
            continue
        if key in seen_keys:
            continue
            
        c_genre_ids = set(c.get("genre_ids", []))
        c_keyword_ids = set(c.get("keyword_ids", []))
        
        genre_score = len(c_genre_ids.intersection(basket_genres))
        keyword_score = len(c_keyword_ids.intersection(basket_keywords))
        
        rating_score = (c.get("vote_average", 0) / 10.0)
        pop_score = math.log1p(c.get("popularity", 0))
        
        node_key = f"{key[1]}_{key[0]}"
        raw_rwr = merged_rwr_score.get(node_key, 0.0)
        normalized_rwr_score = raw_rwr / max_rwr
        
        final_score = (
            0.5 * genre_score
            + 0.2 * keyword_score
            + 0.15 * rating_score
            + 0.1 * pop_score
            + 0.2 * normalized_rwr_score
        )
        c["final_score"] = final_score
        scored_candidates.append(c)
        
    scored_candidates.sort(key=lambda x: x["final_score"], reverse=True)
    
    # Take exactly 20 items to return for this page
    paginated = scored_candidates[:20]
    
    # Update seen items
    new_seen_keys = [(c.get("tmdb_id") or c.get("id"), c.get("media_type", "movie")) for c in paginated]
    seen_list = list(seen_keys) + new_seen_keys
    await set_cached(seen_cache_key, seen_list, 1800)
    
    result = {
        "movies": paginated,
        "page": page,
        "total_pages": 10000,
        "source": "rwr_tmdb_blend",
        "common_traits": {
            "genres": list(common_genres)
        }
    }
    
    await set_cached(page_cache_key, result, 900)  # TTL: 15 min
    return result
