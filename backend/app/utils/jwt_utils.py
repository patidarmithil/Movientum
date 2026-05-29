"""
Movientum — JWT Utilities (Phase 3.1)

create_access_token  → 60-min JWT with user identity
create_refresh_token → 30-day JWT for rotation
decode_token         → validate + check Redis blacklist → payload dict or 401

Redis blacklist key: auth:blacklist:{jti}
"""
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.config import settings
from app.db.cache import redis_client

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: str, email: str, role: str, username: str = "") -> str:
    """
    Create a 60-minute access JWT.
    Payload: sub (user_id), user_id, email, username, role, jti (unique ID for blacklisting), type=access.
    """
    jti = str(uuid.uuid4())
    expire = _utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": str(user_id),
        "user_id": str(user_id),
        "email": email,
        "username": username,
        "role": role,
        "jti": jti,
        "type": "access",
        "exp": expire,
        "iat": _utcnow(),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str) -> str:
    """
    Create a 30-day refresh JWT.
    Payload: sub (user_id), user_id, jti, type=refresh.
    """
    jti = str(uuid.uuid4())
    expire = _utcnow() + timedelta(days=settings.refresh_token_expire_days)
    payload = {
        "sub": str(user_id),
        "user_id": str(user_id),
        "jti": jti,
        "type": "refresh",
        "exp": expire,
        "iat": _utcnow(),
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


async def decode_token(token: str) -> dict:
    """
    Decode + validate JWT.
    Also checks Redis blacklist (logout invalidation).
    Raises HTTP 401 on any failure.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except JWTError as e:
        logger.warning("JWT decode failed: %s", e)
        raise credentials_exception

    jti = payload.get("jti")
    if jti:
        # Check Redis blacklist — token revoked on logout
        blacklisted = await redis_client.get(f"auth:blacklist:{jti}")
        if blacklisted:
            logger.warning("TOKEN_BLACKLISTED jti=%s", jti)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token revoked",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return payload
