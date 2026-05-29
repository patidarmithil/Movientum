"""
Movientum — Auth Service (Phase 3.1)

Service layer between router and DB. No raw DB queries in router handlers.

authenticate_user   → verify email+password → User ORM object or None
create_user         → insert new user row → User ORM object
get_user_by_email   → lookup by email
get_user_by_id      → lookup by UUID
"""
import logging
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.orm_models import User
from app.utils.password_utils import hash_password, verify_password

logger = logging.getLogger(__name__)


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    """Return User row for given email, or None."""
    stmt = select(User).where(User.email == email.lower().strip())
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: UUID) -> Optional[User]:
    """Return User row for given UUID, or None."""
    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def create_user(
    db: AsyncSession,
    username: str,
    email: str,
    password: str,
) -> User:
    """
    Insert new user. Hashes password before storing.
    Enforces password complexity/length validation and handles IntegrityErrors.
    """
    # 6. Password validation before hashing (min 8 chars)
    if not password or len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long",
        )

    new_user = User(
        username=username.strip(),
        email=email.lower().strip(),
        password_hash=hash_password(password),
        role="user",
        is_active=True,
    )
    
    # 5. Unique constraint handling
    try:
        db.add(new_user)
        await db.flush()   # assign UUID without committing — commit handled by get_db()
        await db.refresh(new_user)
    except IntegrityError as e:
        await db.rollback()
        logger.warning("Duplicate user registration attempt: email=%s, username=%s. Error: %s", email, username, e)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email or username already registered",
        )

    logger.info("USER_CREATED user_id=%s email=%s", new_user.id, new_user.email)
    return new_user


async def authenticate_user(
    db: AsyncSession,
    email: str,
    password: str,
) -> Optional[User]:
    """
    Verify email + password.
    Returns User on success, None on failure.
    Always returns None (not descriptive error) to prevent user enumeration.
    """
    user = await get_user_by_email(db, email)
    if not user:
        # Constant-time dummy verify to prevent timing attacks
        verify_password("dummy", "$2b$12$" + "a" * 53)
        return None
    if not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
