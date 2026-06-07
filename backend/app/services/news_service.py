"""
Movientum — News Service (Redis Only)

Responsibilities:
  1. fetch_global_news()       — NewsAPI bulk fetch (called by Celery Beat every 2h).
  2. get_personalized_feed()   — Scored articles for logged-in user, served from Redis.
  3. expire_old_articles()     — Archive articles older than 3 days (Celery Beat daily).

Data Structures in Redis:
  - Hash: `news:articles` (Key=url_hash, Value=JSON)
  - Sorted Set: `news:article_dates` (Member=url_hash, Score=timestamp)

Personalization Score formula:
  score = genre_overlap×0.50 + watched_movie_mention×0.30
        + director_match×0.15 + recency_bonus×0.05
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

from app.config import settings
from app.db.cache import redis_client

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────
NEWS_API_BASE      = "https://newsapi.org/v2"
NEWS_API_TIMEOUT   = 10.0
PAGE_SIZE_DEFAULT  = 20
ARTICLE_EXPIRE_DAYS = 3

CLICKBAIT_PHRASES = [
    "you won't believe", "shocking", "what happened next",
    "this will make you", "blown away", "jaw-dropping",
]

TIER_1_SOURCES = {"variety", "the hollywood reporter", "deadline", "indiewire"}
TIER_2_SOURCES = {"ign", "collider", "screen rant"}

GENRE_KEYWORDS: dict[str, list[str]] = {
    "action":    ["action", "fight", "explosion", "stunt", "combat", "superhero"],
    "comedy":    ["comedy", "funny", "humor", "laugh", "satire", "parody"],
    "drama":     ["drama", "emotional", "oscar", "award", "performance"],
    "horror":    ["horror", "scary", "terrifying", "haunted", "creature"],
    "sci-fi":    ["sci-fi", "science fiction", "space", "alien", "futuristic", "dystopian"],
    "thriller":  ["thriller", "suspense", "mystery", "detective", "crime"],
    "romance":   ["romance", "love story", "romantic", "relationship"],
    "animation": ["animated", "animation", "pixar", "disney", "dreamworks"],
    "documentary":["documentary", "real story", "based on", "true story"],
    "fantasy":   ["fantasy", "magic", "dragon", "wizard", "mythology"],
    "adventure": ["adventure", "quest", "journey", "treasure"],
    "biography": ["biopic", "biography", "life story", "based on the life"],
}

# ── Helpers ──────────────────────────────────────────────────────

def _url_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()

def _tag_genres(title: str, description: str) -> list[str]:
    text_lower = f"{title} {description or ''}".lower()
    tags = []
    for genre, keywords in GENRE_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            tags.append(genre)
    return tags

def _is_clickbait(title: str) -> bool:
    t = title.lower()
    return any(phrase in t for phrase in CLICKBAIT_PHRASES)

def _recency_bonus(published_at_str: Optional[str]) -> float:
    if not published_at_str:
        return 0.0
    try:
        published_at = datetime.fromisoformat(published_at_str.replace("Z", "+00:00"))
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        age_hours = (datetime.now(timezone.utc) - published_at).total_seconds() / 3600
        if age_hours <= 1: return 1.0
        if age_hours >= 48: return 0.0
        return max(0.0, 1.0 - (age_hours / 48))
    except ValueError:
        return 0.0

# ── NewsAPI Client ────────────────────────────────────────────────

async def _newsapi_get(endpoint: str, params: dict) -> Optional[dict]:
    url = f"{NEWS_API_BASE}{endpoint}"
    params["apiKey"] = settings.news_api_key
    try:
        async with httpx.AsyncClient(timeout=NEWS_API_TIMEOUT) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                return resp.json()
            logger.warning(f"[NEWS] NewsAPI {resp.status_code}: {resp.text[:200]}")
            return None
    except Exception as e:
        logger.error(f"[NEWS] NewsAPI request failed: {e}")
        return None

# ── Redis Upsert ────────────────────────────────────────────────────

async def _upsert_articles(raw_articles: list[dict]) -> int:
    inserted = 0
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=ARTICLE_EXPIRE_DAYS)
    
    # Batch writes using pipeline
    pipe = redis_client.pipeline()
    
    for raw in raw_articles:
        url = raw.get("url", "")
        title = raw.get("title") or ""
        description = raw.get("description") or ""

        if not url or not title or _is_clickbait(title):
            continue

        # Parse published_at
        pub_str = raw.get("publishedAt")
        published_at = None
        if pub_str:
            try:
                published_at = datetime.fromisoformat(pub_str.replace("Z", "+00:00"))
            except ValueError:
                pass
        
        # Default to now if missing
        if not published_at:
            published_at = now
            
        if published_at < cutoff:
            continue

        h = _url_hash(url)
        
        # Check if already exists (avoids overwriting view counts etc, though we removed view counts mostly)
        exists = await redis_client.hexists("news:articles", h)
        if exists:
            continue

        source = raw.get("source", {}) or {}
        genre_tags = _tag_genres(title, description)

        article = {
            "id": h,  # Use hash as ID
            "title": title[:1000],
            "description": description[:2000] if description else None,
            "url": url,
            "image_url": raw.get("urlToImage"),
            "source_name": (source.get("name") or "")[:100],
            "source_url": None,
            "published_at": published_at.isoformat(),
            "fetched_at": now.isoformat(),
            "genre_tags": genre_tags,
        }
        
        # Add to hash map
        pipe.hset("news:articles", h, json.dumps(article))
        # Add to sorted set for expiration tracking
        pipe.zadd("news:article_dates", {h: published_at.timestamp()})
        
        inserted += 1

    if inserted > 0:
        await pipe.execute()

    return inserted


# ══════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════

async def fetch_global_news() -> dict:
    """Called by Celery Beat every 2 hours."""
    data = await _newsapi_get("/everything", {
        "q": "movies OR cinema OR film OR Hollywood OR Netflix OR Disney",
        "language": "en",
        "sortBy": "publishedAt",
        "pageSize": 50,
    })
    if not data:
        return {"fetched": 0, "inserted": 0}

    raw_articles = data.get("articles", [])
    inserted = await _upsert_articles(raw_articles)

    logger.info(f"[NEWS] Global fetch: {len(raw_articles)} fetched, {inserted} inserted to Redis")
    return {"fetched": len(raw_articles), "inserted": inserted}


async def get_personalized_feed(
    user_genre_tags: list[str],
    watched_movie_titles: list[str],
    director_names: list[str],
    page: int = 1,
    page_size: int = PAGE_SIZE_DEFAULT,
) -> dict:
    """Personalized feed scored in-memory based on Redis articles."""
    # 1. Fetch all active articles from Redis
    raw_articles = await redis_client.hvals("news:articles")
    articles = [json.loads(a) for a in raw_articles]

    if not articles:
        return {"articles": [], "total": 0, "page": page, "page_size": page_size}

    # 2. Score each article
    user_genres_set = set(t.lower() for t in user_genre_tags)
    watched_titles_lower = [t.lower() for t in watched_movie_titles]
    director_set = set(d.lower() for d in director_names)

    scored = []
    for art in articles:
        art_genres = set(t.lower() for t in (art.get("genre_tags") or []))
        text_lower = f"{art.get('title', '')} {art.get('description', '')}".lower()

        # genre_overlap
        if art_genres and user_genres_set:
            genre_overlap = len(art_genres & user_genres_set) / max(len(art_genres), 1)
        else:
            genre_overlap = 0.0

        # watched_movie_mention (string matching titles in article text)
        watched_mention = 1.0 if any(title in text_lower for title in watched_titles_lower if len(title) > 3) else 0.0

        # director_match
        director_match = 1.0 if any(d in text_lower for d in director_set) else 0.0

        # recency_bonus
        recency = _recency_bonus(art.get("published_at"))

        score = (
            genre_overlap   * 0.50
            + watched_mention * 0.30
            + director_match  * 0.15
            + recency         * 0.05
        )
        scored.append((art, score))

    # 3. Sort and paginate
    scored.sort(key=lambda x: x[1], reverse=True)
    total = len(scored)
    offset = (page - 1) * page_size
    page_items = scored[offset: offset + page_size]

    return {
        "articles": [{"score": s, **a} for a, s in page_items],
        "total": total,
        "page": page,
        "page_size": page_size,
    }

async def get_latest_feed(page: int = 1, page_size: int = PAGE_SIZE_DEFAULT) -> dict:
    """Unpersonalized feed showing latest articles. Used for non-logged-in users."""
    raw_articles = await redis_client.hvals("news:articles")
    articles = [json.loads(a) for a in raw_articles]

    if not articles:
        return {"articles": [], "total": 0, "page": page, "page_size": page_size}

    # Sort strictly by published_at (newest first)
    articles.sort(
        key=lambda x: x.get("published_at", ""),
        reverse=True
    )
    
    total = len(articles)
    offset = (page - 1) * page_size
    page_items = articles[offset: offset + page_size]

    return {
        "articles": page_items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }

async def expire_old_articles() -> int:
    """Archive articles older than ARTICLE_EXPIRE_DAYS days using Redis Sorted Set."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=ARTICLE_EXPIRE_DAYS)
    cutoff_ts = cutoff.timestamp()

    # Get hashes of articles to expire
    hashes_to_remove = await redis_client.zrangebyscore("news:article_dates", 0, cutoff_ts)
    if not hashes_to_remove:
        return 0

    pipe = redis_client.pipeline()
    # Remove from hash map
    pipe.hdel("news:articles", *hashes_to_remove)
    # Remove from sorted set
    pipe.zremrangebyscore("news:article_dates", 0, cutoff_ts)
    
    await pipe.execute()
    
    count = len(hashes_to_remove)
    logger.info(f"[NEWS] Expired {count} articles older than {ARTICLE_EXPIRE_DAYS}d from Redis")
    return count
