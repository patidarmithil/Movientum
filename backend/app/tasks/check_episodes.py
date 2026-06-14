import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.future import select

from app.db.database import AsyncSessionLocal
from app.db.orm_models import WatchingTracker, Notification
from app.services.tmdb_service import tmdb_service
from app.celery_app import celery_app

logger = logging.getLogger(__name__)

async def process_episode_checks():
    """Check watching_tracker for episodes airing today, send notifications."""
    today = datetime.now(timezone.utc).date()
    logger.info(f"Starting check_episodes task for date: {today}")
    
    async with AsyncSessionLocal() as db:
        # Find all trackers where the next episode is today
        query = select(WatchingTracker).where(WatchingTracker.next_episode_date == today)
        result = await db.execute(query)
        trackers = result.scalars().all()
        
        logger.info(f"Found {len(trackers)} tracking records with episodes airing today.")
        
        for tracker in trackers:
            try:
                # Fetch fresh details from TMDB
                tv_data = await tmdb_service.fetch_tv_detail(tracker.tv_id)
                if not tv_data:
                    logger.warning(f"Could not fetch TMDB details for TV ID {tracker.tv_id}")
                    continue
                
                show_name = tv_data.get("name", f"Show {tracker.tv_id}")
                
                # Create the notification
                notif = Notification(
                    user_id=tracker.user_id,
                    tv_id=tracker.tv_id,
                    message=f"New Episode Released: {show_name}",
                    seen=False,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(notif)
                
                # Update the tracker's next episode date if there is another one scheduled
                next_episode_info = tv_data.get("next_episode_to_air")
                if next_episode_info and next_episode_info.get("air_date"):
                    # Only update if the new air date is strictly in the future (greater than today)
                    # Because TMDB might still return today's episode as "next" for a short time
                    new_air_date_str = next_episode_info["air_date"]
                    new_air_date = datetime.strptime(new_air_date_str, "%Y-%m-%d").date()
                    if new_air_date > today:
                        tracker.next_episode_date = new_air_date
                    else:
                        tracker.next_episode_date = None
                else:
                    tracker.next_episode_date = None
                    
                tracker.last_checked_at = datetime.now(timezone.utc)
                
            except Exception as e:
                logger.error(f"Error processing tracker for User {tracker.user_id}, TV {tracker.tv_id}: {e}")
                
        await db.commit()
        logger.info("Finished check_episodes task.")

@celery_app.task
def check_today_episodes_task():
    """Celery task wrapper."""
    asyncio.run(process_episode_checks())
