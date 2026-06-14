from datetime import datetime
from typing import Optional
from uuid import UUID
from pydantic import BaseModel

class FeedbackBase(BaseModel):
    category: str
    content: str

class FeedbackCreate(FeedbackBase):
    pass

class FeedbackResponse(FeedbackBase):
    id: UUID
    user_id: Optional[UUID] = None
    image_url: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
