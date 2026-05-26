"""
Movientum — Celery Application
Broker + Result Backend: Upstash Redis (from .env)

Usage:
    Start worker:   celery -A app.celery_app worker --loglevel=info
    Start beat:     celery -A app.celery_app beat --loglevel=info
    Both together:  celery -A app.celery_app worker --beat --loglevel=info
"""
from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "movientum",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.tasks.sync_movies",
        # "app.tasks.fetch_news",       # Phase 3: news integration
        # "app.tasks.invalidate_cache", # Phase 3: cache management
    ],
)

celery_app.conf.update(
    # Serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,

    # Retry policy
    task_acks_late=True,
    task_reject_on_worker_lost=True,

    # Beat schedule — recurring background jobs
    beat_schedule={
        "daily-movie-sync": {
            "task": "app.tasks.sync_movies.daily_movie_sync",
            "schedule": crontab(hour=3, minute=0),    # 3 AM IST daily
            "options": {"expires": 3600},              # Don't run if delayed > 1hr
        },
        # Phase 3 additions:
        # "news-fetch-every-2-hours": {
        #     "task": "app.tasks.fetch_news.fetch_movie_news",
        #     "schedule": crontab(minute=0, hour="*/2"),
        # },
    },
)
