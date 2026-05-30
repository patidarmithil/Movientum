import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.utils.deps import get_current_user
from app.services.analysis_service import get_user_analysis

logger = logging.getLogger(__name__)
router = APIRouter()

@router.get(
    "/me/analysis",
    summary="User Analysis Dashboard Data",
)
async def get_analysis_data(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns aggregated behavioral insights for the current user.
    Used for the Analysis dashboard.
    """
    try:
        user_id = UUID(current_user["sub"])
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid user ID format in token."
        )

    try:
        data = await get_user_analysis(db, user_id)
        return {"data": data}
    except Exception as e:
        logger.exception("Failed to generate user analysis: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error generating analysis"
        )
