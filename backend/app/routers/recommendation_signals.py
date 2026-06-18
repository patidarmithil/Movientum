"""
Movientum — Recommendation Feedback Router (Phase 6)
Prefix: /api/v1/rec-feedback

Separate from the existing /api/v1/feedback (bug-report) router.

POST /api/v1/rec-feedback/
    Receives a user signal (thumbs_up, thumbs_down, click, ignore) for a
    recommendation card.  Updates the user's taste profile JSONB weights and
    logs the interaction for nightly XGBRanker retraining.

Requires authentication (Bearer token). Anonymous signals are discarded.
"""
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.orm_models import ContentCatalog
from app.schemas.recommendation_feedback import RecFeedbackRequest, RecFeedbackResponse
from app.services.advanced_recs import get_catalog_row
from app.services.feedback_service import apply_feedback, log_interaction
from app.services.tmdb_service import ingest_item_to_catalog
from app.utils.deps import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post(
    "/",
    response_model=RecFeedbackResponse,
    summary="Submit recommendation feedback signal",
    status_code=status.HTTP_200_OK,
)
async def submit_rec_feedback(
    payload: RecFeedbackRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> RecFeedbackResponse:
    """
    Processes a recommendation feedback signal from an authenticated user.

    Pipeline:
    1. Verify the catalog item exists (ingest on-demand if not).
    2. Apply taste-profile weight updates via `feedback_service.apply_feedback()`.
    3. Log interaction to `interaction_log` for nightly training.

    Returns {"status": "ok"} on success, {"status": "skipped", "reason": "..."} when
    the item cannot be resolved.
    """
    user_id = UUID(current_user["sub"])

    # ── Step 1: Resolve catalog item ─────────────────────────────
    catalog_item: ContentCatalog | None = await get_catalog_row(
        db, payload.tmdb_id, payload.media_type
    )
    if catalog_item is None:
        logger.info(
            "rec-feedback: catalog miss — ingesting %s/%d for user %s",
            payload.media_type, payload.tmdb_id, user_id,
        )
        catalog_item = await ingest_item_to_catalog(db, payload.tmdb_id, payload.media_type)

    if catalog_item is None:
        logger.warning(
            "rec-feedback: item %s/%d not found in TMDB — skipping",
            payload.media_type, payload.tmdb_id,
        )
        return RecFeedbackResponse(status="skipped", reason="item_not_found")

    # ── Step 2: Update taste profile ─────────────────────────────
    try:
        await apply_feedback(
            db,
            user_id=user_id,
            catalog_item=catalog_item,
            signal_type=payload.signal_type,
        )
    except Exception as e:
        logger.error("rec-feedback: apply_feedback failed: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update taste profile",
        )

    # ── Step 3: Log interaction ───────────────────────────────────
    try:
        await log_interaction(
            db,
            user_id=user_id,
            tmdb_id=payload.tmdb_id,
            media_type=payload.media_type,
            signal_type=payload.signal_type,
            feature_snapshot=payload.feature_snapshot,
        )
    except Exception as e:
        # Non-fatal: profile update already succeeded; don't fail the request
        logger.warning("rec-feedback: log_interaction failed (non-fatal): %s", e)

    logger.info(
        "rec-feedback: user=%s signal=%s item=%s/%d",
        user_id, payload.signal_type, payload.media_type, payload.tmdb_id,
    )
    return RecFeedbackResponse(status="ok")
