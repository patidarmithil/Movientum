"""
Movientum — Auth Router (Phase 3.1)

POST /api/v1/auth/register  → create user, return JWT + refresh
POST /api/v1/auth/login     → verify creds, return JWT + refresh
POST /api/v1/auth/refresh   → rotate refresh token
POST /api/v1/auth/logout    → blacklist jti in Redis (TTL = remaining lifetime)
GET  /api/v1/auth/me        → [AUTH] current user profile

Auth rules:
- bcrypt cost=12 (enforced in password_utils)
- Access token: 60min, Refresh token: 30 days
- Same "Invalid credentials" for wrong email AND wrong password (no enumeration)
- Logout: store jti in Redis with TTL = remaining token lifetime
"""
import logging
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.database import get_db
from app.db.cache import redis_client
from app.schemas.user import (
    MeResponse,
    RefreshRequest,
    TokenResponse,
    UserLoginRequest,
    UserRegisterRequest,
    UserResetPasswordRequest,
    UserResponse,
    WrappedTokenResponse,
    WrappedMeResponse,
)
from app.services.auth_service import (
    authenticate_user,
    create_user,
    get_user_by_email,
    get_user_by_id,
    reset_user_password,
)
from app.utils.deps import get_current_user
from app.utils.jwt_utils import (
    create_access_token,
    create_refresh_token,
    decode_token,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ─────────────────────────────────────────────────────

def _token_pair(user) -> dict:
    """Build access + refresh token dict for a given User ORM object."""
    access = create_access_token(
        user_id=str(user.id),
        email=user.email,
        role=user.role,
        username=user.username,
    )
    refresh = create_refresh_token(user_id=str(user.id))
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "bearer",
        "user": UserResponse.model_validate(user),
    }


# ── Routes ────────────────────────────────────────────────────────

@router.post(
    "/register",
    response_model=WrappedTokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register new user",
)
async def register(
    body: UserRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new account. Returns JWT access + refresh tokens on success.
    Fails with 409 if email or username already taken.
    """
    # Check email uniqueness
    existing = await get_user_by_email(db, body.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    user = await create_user(
        db=db,
        username=body.username,
        email=body.email,
        password=body.password,
    )

    logger.info("USER_REGISTERED user_id=%s email=%s", user.id, user.email)
    return {"data": _token_pair(user)}


@router.post(
    "/login",
    response_model=WrappedTokenResponse,
    summary="Login",
)
async def login(
    body: UserLoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Verify credentials. Returns JWT access + refresh tokens.
    Always returns the same "Invalid credentials" for wrong email OR wrong password
    to prevent user enumeration.
    """
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        logger.warning("AUTH_FAILED email=%s reason=invalid_credentials", body.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    logger.info("USER_LOGIN user_id=%s", user.id)
    return {"data": _token_pair(user)}


@router.post(
    "/reset-password",
    summary="Directly reset a user's password without confirmation",
)
async def reset_password(
    body: UserResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Reset a user's password using their email directly.
    """
    user = await reset_user_password(db, body.email, body.new_password)
    if not user:
        # Prevent email enumeration by returning a generic success message
        return {"data": {"message": "If the email is registered, the password has been reset."}}
        
    logger.info("USER_PASSWORD_RESET user_id=%s", user.id)
    return {"data": {"message": "If the email is registered, the password has been reset."}}


@router.post(
    "/refresh",
    response_model=WrappedTokenResponse,
    summary="Rotate refresh token",
)
async def refresh_token(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Validate refresh token → issue new access + refresh token pair.
    Old refresh token jti is blacklisted in Redis to prevent reuse.
    """
    payload = await decode_token(body.refresh_token)

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token required",
        )

    user_id = payload.get("sub")
    user = await get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    # Blacklist old refresh token jti
    old_jti = payload.get("jti")
    if old_jti:
        from datetime import datetime, timezone as tz
        exp_ts = payload.get("exp", 0)
        now_ts = datetime.now(tz.utc).timestamp()
        remaining = max(int(exp_ts - now_ts), 1)
        await redis_client.set(f"auth:blacklist:{old_jti}", "true", ex=remaining)
        logger.info("TOKEN_BLACKLISTED jti=%s (refresh rotation)", old_jti)

    logger.info("TOKEN_REFRESHED user_id=%s", user_id)
    return {"data": _token_pair(user)}


@router.post(
    "/logout",
    summary="Logout — blacklist access token",
)
async def logout(
    current_user: dict = Depends(get_current_user),
):
    """
    Invalidate current access token by storing its jti in Redis.
    TTL = remaining lifetime of the token so the key auto-expires.
    """
    jti = current_user.get("jti")
    exp_ts = current_user.get("exp", 0)

    if jti:
        from datetime import datetime, timezone as tz
        now_ts = datetime.now(tz.utc).timestamp()
        remaining = max(int(exp_ts - now_ts), 1)
        await redis_client.set(f"auth:blacklist:{jti}", "true", ex=remaining)
        logger.info("TOKEN_BLACKLISTED jti=%s user_id=%s", jti, current_user.get("sub"))

    return {"data": {"message": "Logged out successfully"}}


@router.get(
    "/me",
    response_model=WrappedMeResponse,
    summary="Current user profile",
)
async def me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Return basic profile from JWT payload + DB fetch for fresh dynamic fields.
    """
    from uuid import UUID
    user_id = UUID(current_user["sub"])
    user = await get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    return {
        "data": MeResponse(
            id=str(user.id),
            email=user.email,
            username=user.username,
            role=user.role,
            avatar_url=user.avatar_url,
            bio=user.bio,
        )
    }
