from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from pydantic import BaseModel
from typing import Optional
from datetime import date
from uuid import UUID

from app.db.database import get_db
from app.db.orm_models import WatchingTracker
from app.utils.deps import get_current_user

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
