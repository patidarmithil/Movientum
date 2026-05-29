"""
Movientum — Search Index Data Ingestion
========================================
Background script to run every 6-12 hours via cron.
Fetches 2 pages each of Trending, Popular, and Top Rated for Movies and TV.
Totaling ~240 items. Upserts them into local DB with minimal data (Lazy Stub)
to enrich the local search_vector.
"""
import asyncio
import logging
import os
import sys
import time
from datetime import date
import json

# Add parent directory to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import asyncpg
from app.config import settings
from app.services.tmdb_service import TMDBService

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("ingest")

PAGES_TO_FETCH = 2

async def upsert_lazy_stub(conn: asyncpg.Connection, item: dict, media_type: str):
    """
    Upsert minimal data for search ingestion.
    """
    item_id = item["id"]
    
    # TV uses 'name' and 'first_air_date', Movie uses 'title' and 'release_date'
    title = item.get("title") or item.get("name") or "Unknown"
    original_title = item.get("original_title") or item.get("original_name")
    overview = item.get("overview", "")
    poster_path = item.get("poster_path")
    backdrop_path = item.get("backdrop_path")
    popularity = float(item.get("popularity", 0.0))
    vote_average = float(item.get("vote_average", 0.0))
    vote_count = int(item.get("vote_count", 0))
    
    date_str = item.get("release_date") if media_type == "movie" else item.get("first_air_date")
    release_date = None
    if date_str:
        try:
            release_date = date.fromisoformat(date_str)
        except ValueError:
            pass

    # Insert into movies table (which holds both movies and tv)
    await conn.execute(
        """
        INSERT INTO movies (
            id, type, title, original_title, overview, release_date,
            poster_path, backdrop_path, popularity, vote_average, vote_count,
            fetched_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            type          = EXCLUDED.type,
            title         = EXCLUDED.title,
            overview      = EXCLUDED.overview,
            popularity    = EXCLUDED.popularity,
            vote_average  = EXCLUDED.vote_average,
            vote_count    = EXCLUDED.vote_count,
            fetched_at    = NOW()
        """,
        item_id, media_type, title, original_title, overview, release_date,
        poster_path, backdrop_path, popularity, vote_average, vote_count
    )

async def update_search_vectors(conn: asyncpg.Connection):
    logger.info("Updating search_vector column (full-text index)...")
    await conn.execute(
        """
        UPDATE movies
        SET search_vector = to_tsvector('english',
            COALESCE(title, '') || ' ' || COALESCE(overview, '')
        )
        WHERE search_vector IS NULL
        """
    )
    logger.info("search_vector update complete.")

async def ingest(conn: asyncpg.Connection, tmdb: TMDBService):
    master_list = []
    
    logger.info(f"Fetching TMDB data ({PAGES_TO_FETCH} pages each)...")
    
    # We will fetch sequentially to avoid complex rate limit bursts, since this runs in background
    
    endpoints = [
        ("trending_movie", tmdb.fetch_trending, {"media_type": "movie", "time_window": "day"}),
        ("trending_tv", tmdb.fetch_trending, {"media_type": "tv", "time_window": "day"}),
        ("popular_movie", tmdb.fetch_popular_movies, {}),
        ("popular_tv", tmdb.fetch_popular_tv, {}),
        ("top_rated_movie", tmdb.fetch_top_rated_movies, {}),
        ("top_rated_tv", tmdb.fetch_top_rated_tv, {})
    ]
    
    for label, func, kwargs in endpoints:
        pages = 1 if "trending" in label else PAGES_TO_FETCH
        media_type = "movie" if "movie" in label else "tv"
        
        for p in range(1, pages + 1):
            if "trending" not in label:
                kwargs["page"] = p
                
            data = await func(**kwargs)
            if not data:
                continue
            
            results = data.get("results", [])
            for item in results:
                item["_media_type"] = media_type
                master_list.append(item)
    
    # Deduplicate
    seen = set()
    deduped = []
    for item in master_list:
        mtype = item["_media_type"]
        key = f"{item['id']}_{mtype}"
        if key not in seen:
            seen.add(key)
            deduped.append(item)
            
    logger.info(f"Collected {len(deduped)} unique items for ingestion.")
    
    # Upsert
    inserted = 0
    start = time.time()
    for item in deduped:
        mtype = item.pop("_media_type")
        try:
            await upsert_lazy_stub(conn, item, mtype)
            inserted += 1
        except Exception as e:
            logger.error(f"Error upserting {mtype} {item['id']}: {e}")
            
    elapsed = time.time() - start
    logger.info(f"Successfully upserted {inserted} items in {elapsed:.1f}s.")
    
    await update_search_vectors(conn)

async def main():
    logger.info("Starting Search Index Data Ingestion")
    db_url = settings.safe_async_db_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(db_url, ssl="require")
    
    async with TMDBService() as tmdb:
        await ingest(conn, tmdb)
        
    await conn.close()
    logger.info("Ingestion complete.")

if __name__ == "__main__":
    asyncio.run(main())
