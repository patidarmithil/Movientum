"""
Movientum — User Schemas (Phase 3.1)

UserRegisterRequest  → POST /auth/register body
UserLoginRequest     → POST /auth/login body
UserResponse         → user profile in responses
TokenResponse        → {access_token, refresh_token, token_type}
RefreshRequest       → POST /auth/refresh body
"""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator


class UserRegisterRequest(BaseModel):
    """Registration payload. username maps to orm_models.User.username."""
    username: str = Field(..., min_length=3, max_length=100, description="Display name / username")
    email: EmailStr
    password: str = Field(..., min_length=8, description="Min 8 characters")

    @field_validator("username")
    @classmethod
    def username_no_spaces(cls, v: str) -> str:
        if " " in v.strip():
            raise ValueError("Username cannot contain spaces")
        return v.strip()


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: UUID
    username: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    avatar_url: Optional[str] = None

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class RefreshRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    """Minimal payload returned from GET /auth/me."""
    id: str
    email: str
    username: str
    role: str


class WrappedTokenResponse(BaseModel):
    data: TokenResponse


class WrappedMeResponse(BaseModel):
    data: MeResponse

