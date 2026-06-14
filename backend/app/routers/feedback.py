import os
import uuid
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.db.orm_models import Feedback
from app.schemas.feedback import FeedbackResponse
from app.utils.deps import get_current_user
from PIL import Image

router = APIRouter()

UPLOAD_DIR = "uploads/feedback"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/", response_model=FeedbackResponse)
async def submit_feedback(
    category: str = Form(...),
    content: str = Form(...),
    image: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    image_url = None
    if image:
        if not image.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail="File must be an image")

        # Compress and save image
        filename = f"{uuid.uuid4().hex}.jpg"
        filepath = os.path.join(UPLOAD_DIR, filename)

        try:
            with Image.open(image.file) as img:
                if img.mode in ("RGBA", "P"):
                    img = img.convert("RGB")
                # Compress the image
                img.thumbnail((800, 800))
                img.save(filepath, "JPEG", quality=70, optimize=True)
            image_url = f"/{UPLOAD_DIR}/{filename}"
        except Exception as e:
            raise HTTPException(status_code=500, detail="Failed to process image")

    user_id = uuid.UUID(current_user["sub"])

    feedback = Feedback(
        category=category,
        content=content,
        image_url=image_url,
        user_id=user_id
    )
    db.add(feedback)
    await db.commit()
    await db.refresh(feedback)

    return feedback


@router.get("/", response_model=List[FeedbackResponse])
async def get_all_feedback(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    stmt = select(Feedback).order_by(Feedback.created_at.desc())
    result = await db.execute(stmt)
    feedbacks = result.scalars().all()
    return feedbacks
