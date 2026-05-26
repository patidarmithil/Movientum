"""
Movientum — One-Time Movie Seed Script
======================================
Fetches ~800–1000 movies from TMDB and inserts into Supabase PostgreSQL.

Run ONCE from backend/ directory:
    python scripts/seed_movies.py

Expected runtime: 35–60 minutes (due to rate limit 0.25s sleep per request).
Expected result:  ~800–1000 movies, 19 genres, ~600–800 directors.

Re-run safe: uses ON CONFLICT DO UPDATE so re-running won't duplicate data.

Steps:
    1. Fetch 25 pages of /movie/popular   → up to 500 IDs
    2. Fetch 25 pages of /movie/top_rated → up to 500 more IDs
    3. Deduplicate IDs
    4. For each ID: fetch detail + credits → upsert into DB
    5. Print final stats
"""
import asyncio
import logging
import os
import sys
import time
from datetime import datetime, date
import json

# Add parent directory to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Load .env before importing app modules
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

import asyncpg
from app.config import settings
from app.services.tmdb_service import TMDBService

# ── Logging ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("seed")

# ── Config ───────────────────────────────────────────────────────
POPULAR_PAGES = 25      # 25 × 20 = 500 movies
TOP_RATED_PAGES = 25    # 25 × 20 = 500 more (many overlap)
LOG_EVERY = 50          # print progress every N movies


# ── Database Helpers (raw asyncpg for seed script speed) ─────────

async def get_existing_movie_ids(conn: asyncpg.Connection) -> set:
    """Return set of all movie IDs already in DB."""
    rows = await conn.fetch("SELECT id FROM movies")
    return {row["id"] for row in rows}


async def upsert_genre(conn: asyncpg.Connection, genre_id: int, name: str):
    await conn.execute(
        """
        INSERT INTO genres (id, name)
        VALUES ($1, $2)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
        """,
        genre_id, name,
    )


async def upsert_movie(conn: asyncpg.Connection, movie: dict):
    """
    Insert or update movie record.
    ON CONFLICT (id) → update popularity + vote data + fetched_at.
    """
    release_date = None
    if movie.get("release_date"):
        try:
            release_date = date.fromisoformat(movie["release_date"])
        except ValueError:
            release_date = None

    await conn.execute(
        """
        INSERT INTO movies (
            id, title, original_title, overview, release_date, runtime,
            poster_path, backdrop_path, popularity, vote_average, vote_count,
            adult, status, budget, revenue, original_language, imdb_id,
            metadata, fetched_at
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17,
            $18, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            popularity    = EXCLUDED.popularity,
            vote_average  = EXCLUDED.vote_average,
            vote_count    = EXCLUDED.vote_count,
            status        = EXCLUDED.status,
            fetched_at    = NOW()
        """,
        movie["id"],
        movie["title"],
        movie.get("original_title"),
        movie.get("overview"),
        release_date,
        movie.get("runtime"),
        movie.get("poster_path"),
        movie.get("backdrop_path"),
        float(movie.get("popularity") or 0),
        float(movie.get("vote_average") or 0),
        int(movie.get("vote_count") or 0),
        bool(movie.get("adult", False)),
        movie.get("status"),
        int(movie.get("budget") or 0),
        int(movie.get("revenue") or 0),
        movie.get("original_language"),
        movie.get("imdb_id"),
        json.dumps(movie.get("metadata_") or {}),
    )


async def upsert_movie_genres(conn: asyncpg.Connection, movie_id: int, genres: list[dict]):
    # Delete old mappings first to avoid stale entries
    await conn.execute("DELETE FROM movie_genres WHERE movie_id = $1", movie_id)
    for genre in genres:
        await upsert_genre(conn, genre["id"], genre["name"])
        await conn.execute(
            """
            INSERT INTO movie_genres (movie_id, genre_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            movie_id, genre["id"],
        )


async def upsert_director(conn: asyncpg.Connection, director: dict):
    await conn.execute(
        """
        INSERT INTO directors (id, name, biography, profile_path, birthday, place_of_birth, tmdb_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO UPDATE SET
            name        = EXCLUDED.name,
            profile_path = EXCLUDED.profile_path
        """,
        director["id"],
        director["name"],
        director.get("biography"),
        director.get("profile_path"),
        director.get("birthday"),
        director.get("place_of_birth"),
        director.get("tmdb_id"),
    )


async def upsert_movie_directors(conn: asyncpg.Connection, movie_id: int, directors: list[dict]):
    await conn.execute("DELETE FROM movie_directors WHERE movie_id = $1", movie_id)
    for director in directors:
        await upsert_director(conn, director)
        await conn.execute(
            """
            INSERT INTO movie_directors (movie_id, director_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            """,
            movie_id, director["id"],
        )


async def update_search_vectors(conn: asyncpg.Connection):
    """
    After seeding: populate tsvector column for full-text search.
    Only run this AFTER all movies inserted.
    """
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


# ── Main Seed Logic ──────────────────────────────────────────────

async def collect_movie_ids(tmdb: TMDBService) -> list[int]:
    """
    Collect all movie IDs from popular + top_rated lists.
    Deduplicates before returning.
    """
    all_ids = set()

    logger.info(f"Fetching popular movies ({POPULAR_PAGES} pages)...")
    for page in range(1, POPULAR_PAGES + 1):
        data = await tmdb.fetch_popular_movies(page=page)
        if not data:
            logger.warning(f"Popular page {page}: no data returned, stopping.")
            break
        results = data.get("results", [])
        for movie in results:
            all_ids.add(movie["id"])
        if page % 5 == 0:
            logger.info(f"  Popular: page {page}/{POPULAR_PAGES} done. IDs so far: {len(all_ids)}")
        if page >= data.get("total_pages", 999):
            break

    logger.info(f"Fetching top_rated movies ({TOP_RATED_PAGES} pages)...")
    for page in range(1, TOP_RATED_PAGES + 1):
        data = await tmdb.fetch_top_rated_movies(page=page)
        if not data:
            logger.warning(f"Top rated page {page}: no data returned, stopping.")
            break
        results = data.get("results", [])
        for movie in results:
            all_ids.add(movie["id"])
        if page % 5 == 0:
            logger.info(f"  Top rated: page {page}/{TOP_RATED_PAGES} done. IDs so far: {len(all_ids)}")
        if page >= data.get("total_pages", 999):
            break

    unique_ids = list(all_ids)
    logger.info(f"Total unique movie IDs collected: {len(unique_ids)}")
    return unique_ids


async def seed(conn: asyncpg.Connection, tmdb: TMDBService, movie_ids: list[int]):
    """
    Main seeding loop: fetch detail + credits for each ID, upsert into DB.
    """
    total = len(movie_ids)
    inserted = 0
    skipped = 0
    failed = 0
    start_time = time.time()

    for i, movie_id in enumerate(movie_ids, start=1):
        # ── Fetch movie detail ──
        detail = await tmdb.fetch_movie_detail(movie_id)
        if not detail:
            logger.warning(f"  [{i}/{total}] Movie {movie_id}: detail fetch failed. SKIP.")
            failed += 1
            continue

        # ── Fetch credits (directors) ──
        credits = await tmdb.fetch_movie_credits(movie_id)
        directors = TMDBService.extract_directors(credits) if credits else []

        # ── Normalize data ──
        movie_data = TMDBService.extract_movie_data(detail)
        genres = movie_data.pop("genres", [])

        # ── Upsert into DB (transaction per movie) ──
        try:
            async with conn.transaction():
                await upsert_movie(conn, movie_data)
                await upsert_movie_genres(conn, movie_id, genres)
                if directors:
                    await upsert_movie_directors(conn, movie_id, directors)
            inserted += 1
        except Exception as e:
            logger.error(f"  [{i}/{total}] Movie {movie_id} DB error: {e}")
            failed += 1
            continue

        # ── Progress logging ──
        if i % LOG_EVERY == 0:
            elapsed = time.time() - start_time
            rate = i / elapsed
            eta_seconds = (total - i) / rate if rate > 0 else 0
            eta_min = eta_seconds / 60
            logger.info(
                f"  [{i}/{total}] inserted={inserted} failed={failed} "
                f"rate={rate:.1f}/s ETA={eta_min:.0f}min"
            )

    return inserted, skipped, failed


async def main():
    logger.info("=" * 60)
    logger.info("MOVIENTUM SEED SCRIPT")
    logger.info("=" * 60)

    # Build asyncpg connection URL from settings (password already URL-encoded in safe_async_db_url)
    db_url = settings.safe_async_db_url.replace("postgresql+asyncpg://", "postgresql://")

    logger.info("Connecting to Supabase...")
    conn = await asyncpg.connect(db_url, ssl="require")
    logger.info("Connected to Supabase PostgreSQL.")

    async with TMDBService() as tmdb:
        # Step 1: Collect IDs
        movie_ids = await collect_movie_ids(tmdb)

        if not movie_ids:
            logger.error("No movie IDs collected. Exiting.")
            await conn.close()
            return

        # Step 2: Seed movies
        logger.info(f"Starting seed: {len(movie_ids)} movies to process...")
        logger.info("(Rate limit: 0.25s per TMDB request — expect 35–60 minutes)")

        start = time.time()
        inserted, skipped, failed = await seed(conn, tmdb, movie_ids)
        elapsed = time.time() - start

        # Step 3: Update full-text search vectors
        await update_search_vectors(conn)

    await conn.close()

    logger.info("=" * 60)
    logger.info("SEED COMPLETE")
    logger.info(f"  Inserted:  {inserted}")
    logger.info(f"  Skipped:   {skipped}")
    logger.info(f"  Failed:    {failed}")
    logger.info(f"  Total IDs: {len(movie_ids)}")
    logger.info(f"  Time:      {elapsed / 60:.1f} minutes")
    logger.info("=" * 60)
    logger.info("Next: verify in Supabase Table Editor → movies table")


if __name__ == "__main__":
    asyncio.run(main())
