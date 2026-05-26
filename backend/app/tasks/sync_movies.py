"""
Movientum — Daily Movie Sync Celery Task

Runs at 3 AM IST daily (registered in app/celery_app.py).
Fetches now_playing + upcoming from TMDB.
Inserts new movies not yet in DB.
Updates popularity + vote_average for existing top movies.
"""
import asyncio
import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="app.tasks.sync_movies.daily_movie_sync",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def daily_movie_sync(self):
    """
    Daily TMDB sync — runs as Celery task.
    Celery is sync by default — we run async logic via asyncio.run().
    """
    logger.info("[SYNC] Starting daily movie sync...")
    try:
        result = asyncio.run(_async_sync())
        logger.info(f"[SYNC] Complete: {result}")
        return result
    except Exception as exc:
        logger.error(f"[SYNC] Failed: {exc}")
        raise self.retry(exc=exc)


async def _async_sync():
    """Async sync logic — fetches now_playing + upcoming, upserts new movies."""
    import asyncpg
    from app.config import settings
    from app.services.tmdb_service import TMDBService

    db_url = settings.async_database_url.replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(db_url, ssl="require")

    inserted = 0
    updated = 0
    failed = 0

    async with TMDBService() as tmdb:
        # ── Collect IDs from now_playing + upcoming ──────────
        new_ids = set()
        for fetch_fn, label, pages in [
            (tmdb.fetch_now_playing, "now_playing", 3),
            (tmdb.fetch_upcoming, "upcoming", 3),
        ]:
            for page in range(1, pages + 1):
                data = await fetch_fn(page=page)
                if data:
                    for movie in data.get("results", []):
                        new_ids.add(movie["id"])
            logger.info(f"[SYNC] {label}: collected {len(new_ids)} IDs so far")

        # ── Check which IDs not in DB ──────────────────────
        existing_rows = await conn.fetch("SELECT id FROM movies")
        existing_ids = {row["id"] for row in existing_rows}
        ids_to_insert = new_ids - existing_ids

        logger.info(f"[SYNC] New movies to insert: {len(ids_to_insert)}")

        # ── Insert new movies ──────────────────────────────
        for movie_id in ids_to_insert:
            detail = await tmdb.fetch_movie_detail(movie_id)
            credits = await tmdb.fetch_movie_credits(movie_id)

            if not detail:
                failed += 1
                continue

            directors = TMDBService.extract_directors(credits) if credits else []
            movie_data = TMDBService.extract_movie_data(detail)
            genres = movie_data.pop("genres", [])

            from scripts.seed_movies import (
                upsert_movie, upsert_movie_genres, upsert_movie_directors
            )

            try:
                async with conn.transaction():
                    await upsert_movie(conn, movie_data)
                    await upsert_movie_genres(conn, movie_id, genres)
                    if directors:
                        await upsert_movie_directors(conn, movie_id, directors)
                inserted += 1
            except Exception as e:
                logger.error(f"[SYNC] Insert failed for movie {movie_id}: {e}")
                failed += 1

        # ── Update popularity for top 1000 existing movies ──
        logger.info("[SYNC] Updating popularity for top 1000 movies...")
        top_rows = await conn.fetch(
            "SELECT id FROM movies ORDER BY popularity DESC LIMIT 1000"
        )
        top_ids = [row["id"] for row in top_rows]

        for movie_id in top_ids[:100]:  # limit to 100 to avoid long sync
            detail = await tmdb.fetch_movie_detail(movie_id)
            if detail:
                try:
                    await conn.execute(
                        """
                        UPDATE movies
                        SET popularity = $1, vote_average = $2, vote_count = $3, fetched_at = NOW()
                        WHERE id = $4
                        """,
                        float(detail.get("popularity", 0)),
                        float(detail.get("vote_average", 0)),
                        int(detail.get("vote_count", 0)),
                        movie_id,
                    )
                    updated += 1
                except Exception as e:
                    logger.warning(f"[SYNC] Update failed for {movie_id}: {e}")

    await conn.close()

    return {
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
        "new_ids_found": len(ids_to_insert),
    }
