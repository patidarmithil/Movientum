from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from pydantic import BaseModel
from typing import Optional
from datetime import date
from uuid import UUID

from app.db.database import get_db
from app.db.orm_models import WatchingTracker, Notification
from app.utils.deps import get_current_user
from app.services.tmdb_service import tmdb_service
from datetime import datetime, timezone

router = APIRouter()

class TrackRequest(BaseModel):
    tv_id: int
    next_episode_date: Optional[date] = None

class UntrackRequest(BaseModel):
    tv_id: int

@router.post("/track")
async def track_show(
    request: TrackRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    # Check if already tracking
    query = select(WatchingTracker).where(
        WatchingTracker.user_id == user_id,
        WatchingTracker.tv_id == request.tv_id
    )
    result = await db.execute(query)
    tracker = result.scalars().first()

    if tracker:
        tracker.next_episode_date = request.next_episode_date
    else:
        tracker = WatchingTracker(
            user_id=user_id,
            tv_id=request.tv_id,
            next_episode_date=request.next_episode_date
        )
        db.add(tracker)

    # Immediate notification check
    if request.next_episode_date:
        today = datetime.now(timezone.utc).date()
        if request.next_episode_date <= today:
            # Check if we already notified today to prevent spam
            notif_query = select(Notification).where(
                Notification.user_id == user_id,
                Notification.tv_id == request.tv_id,
                # We do a basic check by seeing if an unseen notif already exists 
                # or we just blindly create one since they just clicked "watch"
            )
            result = await db.execute(notif_query)
            existing_notifs = result.scalars().all()
            
            # Simple check: if they don't have an unseen notif for this show, create one
            unseen = [n for n in existing_notifs if not n.seen]
            if not unseen:
                tv_data = await tmdb_service.fetch_tv_detail(request.tv_id)
                show_name = tv_data.get("name", f"Show {request.tv_id}") if tv_data else f"Show {request.tv_id}"
                notif = Notification(
                    user_id=user_id,
                    tv_id=request.tv_id,
                    message=f"New Episode Released: {show_name}",
                    seen=False,
                    created_at=datetime.now(timezone.utc)
                )
                db.add(notif)

    await db.commit()
    return {"message": "Show tracked successfully"}

@router.post("/untrack")
async def untrack_show(
    request: UntrackRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    query = delete(WatchingTracker).where(
        WatchingTracker.user_id == user_id,
        WatchingTracker.tv_id == request.tv_id
    )
    await db.execute(query)
    await db.commit()
    
    return {"message": "Show untracked successfully"}

@router.get("/status/{tv_id}")
async def get_tracking_status(
    tv_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    query = select(WatchingTracker).where(
        WatchingTracker.user_id == user_id,
        WatchingTracker.tv_id == tv_id
    )
    result = await db.execute(query)
    tracker = result.scalars().first()

    return {
        "tracked": tracker is not None,
        "next_episode_date": tracker.next_episode_date.isoformat() if tracker and tracker.next_episode_date else None
    }
