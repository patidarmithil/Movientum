import logging
from fastapi import APIRouter, Query, HTTPException, status
from celery import chain

from app.config import settings
from app.tasks.sync_movies import daily_movie_sync
from app.tasks.fetch_news import expire_news_task
from app.tasks.check_episodes import check_today_episodes_task
from app.tasks.retrain_ranker import nightly_ranker_retrain

router = APIRouter()
logger = logging.getLogger(__name__)

def verify_token(token: str):
    if token != settings.cron_secret_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid cron secret token."
        )

@router.post("/movie-sync", summary="Trigger daily movie sync background task")
async def trigger_movie_sync(token: str = Query(...)):
    verify_token(token)
    try:
        task = daily_movie_sync.delay()
        return {"status": "triggered", "task_id": task.id, "task_name": "daily_movie_sync"}
    except Exception as e:
        logger.error(f"Failed to trigger daily movie sync: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/news-expire", summary="Trigger daily news expiration background task")
async def trigger_news_expire(token: str = Query(...)):
    verify_token(token)
    try:
        task = expire_news_task.delay()
        return {"status": "triggered", "task_id": task.id, "task_name": "expire_news_task"}
    except Exception as e:
        logger.error(f"Failed to trigger news expiration: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/check-episodes", summary="Trigger daily episode check background task")
async def trigger_check_episodes(token: str = Query(...)):
    verify_token(token)
    try:
        task = check_today_episodes_task.delay()
        return {"status": "triggered", "task_id": task.id, "task_name": "check_today_episodes_task"}
    except Exception as e:
        logger.error(f"Failed to trigger check episodes task: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/ranker-retrain", summary="Trigger nightly ML ranker retrain background task")
async def trigger_ranker_retrain(token: str = Query(...)):
    verify_token(token)
    try:
        task = nightly_ranker_retrain.delay()
        return {"status": "triggered", "task_id": task.id, "task_name": "nightly_ranker_retrain"}
    except Exception as e:
        logger.error(f"Failed to trigger ranker retrain task: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/nightly-job", summary="Trigger all nightly jobs in sequence (chained) or in parallel")
async def trigger_nightly_job(token: str = Query(...), execute_chained: bool = Query(True, description="Execute tasks sequentially in a Celery chain")):
    verify_token(token)
    try:
        if execute_chained:
            # We use immutable signatures (.si()) to avoid passing return values between tasks
            task_chain = chain(
                expire_news_task.si(),
                daily_movie_sync.si(),
                nightly_ranker_retrain.si(),
                check_today_episodes_task.si()
            )
            result = task_chain.apply_async()
            return {
                "status": "triggered_chained",
                "chain_task_id": result.id,
                "message": "Tasks will execute sequentially: expire_news -> daily_movie_sync -> retrain_ranker -> check_episodes"
            }
        else:
            t1 = expire_news_task.delay()
            t2 = daily_movie_sync.delay()
            t3 = nightly_ranker_retrain.delay()
            t4 = check_today_episodes_task.delay()
            return {
                "status": "triggered_parallel",
                "triggered_tasks": {
                    "news_expire": t1.id,
                    "movie_sync": t2.id,
                    "ranker_retrain": t3.id,
                    "check_episodes": t4.id
                }
            }
    except Exception as e:
        logger.error(f"Failed to trigger nightly job: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
