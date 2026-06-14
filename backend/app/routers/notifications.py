from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update, desc
from pydantic import BaseModel
from typing import List
from datetime import datetime
from uuid import UUID

from app.db.database import get_db
from app.db.orm_models import Notification
from app.utils.deps import get_current_user

router = APIRouter()

class NotificationResponse(BaseModel):
    id: int
    tv_id: int
    message: str
    seen: bool
    created_at: datetime

@router.get("", response_model=List[NotificationResponse])
async def get_notifications(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    query = select(Notification).where(
        Notification.user_id == user_id
    ).order_by(desc(Notification.created_at)).limit(50)
    
    result = await db.execute(query)
    notifications = result.scalars().all()
    
    return notifications

@router.post("/{id}/seen")
async def mark_notification_seen(
    id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    query = select(Notification).where(
        Notification.id == id,
        Notification.user_id == user_id
    )
    result = await db.execute(query)
    notification = result.scalars().first()
    
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
        
    notification.seen = True
    await db.commit()
    
    return {"message": "Notification marked as seen"}

@router.post("/mark_all_seen")
async def mark_all_notifications_seen(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    user_id = UUID(current_user["sub"])
    
    stmt = update(Notification).where(
        Notification.user_id == user_id,
        Notification.seen == False
    ).values(seen=True)
    
    await db.execute(stmt)
    await db.commit()
    
    return {"message": "All notifications marked as seen"}
