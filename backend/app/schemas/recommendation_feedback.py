"""
Movientum — Recommendation Feedback Schemas (Phase 6)

Separate from the existing Feedback (bug-report) schema.
Used by the /api/v1/rec-feedback endpoint.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field


VALID_SIGNALS = Literal["thumbs_up", "thumbs_down", "click", "ignore"]

# Label mapping (matches InteractionLog.label)
SIGNAL_LABEL: dict[str, int] = {
    "thumbs_up":   3,
    "click":       2,
    "ignore":      0,
    "thumbs_down": -1,
}


class RecFeedbackRequest(BaseModel):
    """Body for POST /api/v1/rec-feedback/."""
    tmdb_id:    int    = Field(..., gt=0, description="TMDB item ID")
    media_type: Literal["movie", "tv"] = Field("movie")
    signal_type: VALID_SIGNALS

    # Optional: frontend can send the 16-feature vector it used when displaying
    # the card (for richer training data). If omitted, stored as empty dict.
    feature_snapshot: Optional[dict] = Field(default_factory=dict)


class RecFeedbackResponse(BaseModel):
    status: str                    # "ok" | "skipped"
    reason: Optional[str] = None   # only set when status == "skipped"
