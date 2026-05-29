"""
Movientum — FastAPI Dependencies (Phase 3.1)

get_current_user  → extract + validate Bearer token → user payload dict or 401
get_optional_user → same but returns None instead of 401 for unauthenticated
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.utils.jwt_utils import decode_token

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> dict:
    """
    FastAPI dependency — requires valid Bearer JWT.
    Returns decoded payload: {sub, email, role, jti, type, exp, iat}.
    Raises HTTP 401 if token missing, invalid, expired, or blacklisted.
    """
    if credentials is None or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = await decode_token(credentials.credentials)

    # Ensure it's an access token (not a refresh token used as access)
    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Access token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return payload


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
) -> Optional[dict]:
    """
    FastAPI dependency — does NOT raise on missing token.
    Returns payload dict if valid token present, None otherwise.
    Useful for endpoints that have different behaviour for logged-in vs guest.
    """
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = await decode_token(credentials.credentials)
        if payload.get("type") != "access":
            return None
        return payload
    except HTTPException:
        return None
