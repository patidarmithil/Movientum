import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.services import click_service
from app.utils.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


class ClickRequest(BaseModel):
    item_id: int
    media_type: str = "movie"
    source: str = None


@router.post("", status_code=status.HTTP_201_CREATED, summary="Log an item click")
async def log_click(
    req: ClickRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = UUID(current_user["sub"])
    try:
        await click_service.insert_click(
            db, 
            user_id=user_id, 
            item_id=req.item_id, 
            media_type=req.media_type, 
            source=req.source
        )
        # TODO: Invalidate cache if needed
    except Exception as e:
        logger.error(f"Error logging click: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
    
    return {"message": "Click logged successfully"}


@router.get("/profile", summary="Get user click profile")
async def get_click_profile(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    user_id = UUID(current_user["sub"])
    
    # Ideally cached for 30 minutes. Let's return raw for now.
    profile = await click_service.get_click_profile(db, user_id)
    high_interest = await click_service.get_repeated_interest(db, user_id)
    
    return {
        "click_genre_profile": profile,
        "high_interest_items": high_interest
    }
