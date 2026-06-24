from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete
from pydantic import BaseModel
from typing import List
from uuid import UUID

from app.db.database import get_db
from app.db.orm_models import TempTracker
from app.utils.deps import get_current_user

router = APIRouter()

class TempTrackRequest(BaseModel):
    tv_id: int

@router.post("")
async def add_temp_tracker(
    request: TempTrackRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    # Check if already tracking
    query = select(TempTracker).where(
        TempTracker.user_id == user_id,
        TempTracker.tv_id == request.tv_id
    )
    result = await db.execute(query)
    tracker = result.scalars().first()

    if not tracker:
        tracker = TempTracker(
            user_id=user_id,
            tv_id=request.tv_id
        )
        db.add(tracker)
        await db.commit()

    return {"message": "Show added to temp tracker"}

@router.delete("/{tv_id}")
async def remove_temp_tracker(
    tv_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    query = delete(TempTracker).where(
        TempTracker.user_id == user_id,
        TempTracker.tv_id == tv_id
    )
    await db.execute(query)
    await db.commit()
    
    return {"message": "Show removed from temp tracker"}

@router.get("")
async def get_temp_trackers(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    query = select(TempTracker).where(
        TempTracker.user_id == user_id
    )
    result = await db.execute(query)
    trackers = result.scalars().all()

    return {"temp_trackers": [{"tv_id": t.tv_id, "added_at": t.added_at.isoformat()} for t in trackers]}
