"""
Movientum — Nightly Ranker Retrain Celery Task (Phase 7)

Scheduled: 3:30 AM IST daily (beat_schedule in celery_app.py).
Offset from daily movie sync (3:00 AM) and episode check (4:00 AM).

On failure: retries twice with 10-minute delay before giving up.
"""
import asyncio
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(
    name="app.tasks.retrain_ranker.nightly_ranker_retrain",
    bind=True,
    max_retries=2,
    default_retry_delay=600,    # 10 min between retries
)
def nightly_ranker_retrain(self):
    """
    Celery task wrapper for the async retraining pipeline.

    Celery workers are synchronous — async logic runs via asyncio.run().
    An AsyncSession is opened for the duration of the training job and
    closed cleanly on exit, regardless of success or failure.
    """
    logger.info("[RetainTask] Starting nightly ranker retrain task...")
    try:
        result = asyncio.run(_run_retrain())
        logger.info("[RetainTask] Completed: %s", result)
        return result
    except Exception as exc:
        logger.error("[RetainTask] Failed: %s", exc)
        raise self.retry(exc=exc)


async def _run_retrain() -> dict:
    """Open an async DB session and call the training pipeline."""
    from app.db.database import AsyncSessionLocal
    from app.ml.training import run_nightly_retrain

    async with AsyncSessionLocal() as db:
        return await run_nightly_retrain(db)
