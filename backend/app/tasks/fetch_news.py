"""
Movientum — News Celery Tasks

Tasks registered here:
  fetch_movie_news_task   — every 2 hours (Celery Beat), global news fetch
  expire_news_task        — daily at 2 AM IST, archives old articles
"""
import asyncio
import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="app.tasks.fetch_news.fetch_movie_news_task",
    bind=True,
    max_retries=3,
    default_retry_delay=120,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def fetch_movie_news_task(self):
    """
    Celery Beat task — runs every 2 hours.
    Fetches broad movie/entertainment news from NewsAPI and inserts new articles.
    """
    logger.info("[NEWS TASK] Starting global news fetch...")
    try:
        result = asyncio.run(_async_global_fetch())
        logger.info(f"[NEWS TASK] Done: {result}")
        return result
    except Exception as exc:
        logger.error(f"[NEWS TASK] Failed: {exc}")
        raise self.retry(exc=exc)


@shared_task(
    name="app.tasks.fetch_news.expire_news_task",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    autoretry_for=(Exception,),
)
def expire_news_task(self):
    """
    Celery Beat task — runs daily at 2 AM IST.
    Archives news articles older than 7 days.
    """
    logger.info("[NEWS TASK] Starting article expiration...")
    try:
        count = asyncio.run(_async_expire())
        logger.info(f"[NEWS TASK] Expired {count} articles")
        return {"archived": count}
    except Exception as exc:
        logger.error(f"[NEWS TASK] Expiry failed: {exc}")
        raise self.retry(exc=exc)


async def _async_global_fetch() -> dict:
    from app.services.news_service import fetch_global_news
    return await fetch_global_news()


async def _async_expire() -> int:
    from app.services.news_service import expire_old_articles
    return await expire_old_articles()
