"""
Movientum — Persistence and TTL Utilities
"""

def _is_persistable(raw: dict, threshold: float = 5.0) -> bool:
    """
    Check if a TMDB entity (movie, tv, person) meets the minimum quality bar
    to be persisted in the local database.
    """
    has_title = bool(raw.get("title") or raw.get("name") or raw.get("original_title") or raw.get("original_name"))
    has_poster = bool(raw.get("poster_path") or raw.get("profile_path"))
    pop = float(raw.get("popularity", 0.0) or 0.0)
    
    return has_title and has_poster and pop >= threshold

def get_ttl_for_popularity(popularity: float) -> int:
    """
    Determine Redis cache TTL based on popularity.
    """
    if popularity < 5.0:
        return 3600      # 1 hour
    elif popularity < 20.0:
        return 43200     # 12 hours
    return 86400         # 24 hours
