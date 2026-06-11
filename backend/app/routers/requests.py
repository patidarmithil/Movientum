from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.db.orm_models import RequestedContent

router = APIRouter(prefix="/requests", tags=["Requests"])

class RequestContentPayload(BaseModel):
    title: str = Field(..., min_length=1, description="The title of the missing content")
    content_type: str = Field(..., description="The type of the content (Movie / TV Show)")

@router.post("", status_code=status.HTTP_201_CREATED, summary="Request missing content")
async def request_content(
    payload: RequestContentPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Saves a user request for missing content into the database.
    """
    new_request = RequestedContent(
        title=payload.title,
        content_type=payload.content_type
    )
    db.add(new_request)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Failed to save request")
    
    return {"message": "Content requested successfully"}
