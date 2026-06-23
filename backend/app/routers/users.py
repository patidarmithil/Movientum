import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, extract, update
from sqlalchemy.exc import IntegrityError
import os
import csv
import io
from PIL import Image

from app.db.database import get_db
from app.db.orm_models import User, Movie, WatchHistory, Rating
from app.utils.deps import get_current_user
from app.services.analysis_service import get_user_analysis
from app.schemas.user import UserResponse, UserPasswordUpdateRequest, UserDeleteRequest
from app.utils.password_utils import verify_password, hash_password

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

@router.patch(
    "/me",
    response_model=UserResponse,
    summary="Update user profile"
)
async def update_profile(
    username: str = Form(None),
    bio: str = Form(None),
    avatar: UploadFile = File(None),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    try:
        user_id = UUID(current_user["sub"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if username and username.strip() != user.username:
        if " " in username.strip():
            raise HTTPException(status_code=400, detail="Username cannot contain spaces")
        user.username = username.strip()

    if bio is not None:
        user.bio = bio.strip()

    if avatar:
        if avatar.size > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 5MB)")
            
        ext = avatar.filename.split(".")[-1].lower()
        if ext not in ["jpg", "jpeg", "png", "webp"]:
            raise HTTPException(status_code=400, detail="Invalid image format")
            
        os.makedirs("uploads/avatars", exist_ok=True)
        filename = f"{user.id}.jpg"
        filepath = os.path.join("uploads/avatars", filename)
        
        try:
            image = Image.open(avatar.file)
            image.thumbnail((400, 400))
            if image.mode != "RGB":
                image = image.convert("RGB")
            image.save(filepath, "JPEG", quality=85)
            user.avatar_url = f"/uploads/avatars/{filename}"
        except Exception as e:
            logger.error(f"Image processing failed: {e}")
            raise HTTPException(status_code=500, detail="Failed to process image")

    try:
        await db.commit()
        await db.refresh(user)
        return user
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Username already taken")

@router.patch(
    "/me/password",
    summary="Change password"
)
async def change_password(
    req: UserPasswordUpdateRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    try:
        user_id = UUID(current_user["sub"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect current password")
        
    user.password_hash = hash_password(req.new_password)
    await db.commit()
    return {"message": "Password updated successfully"}

@router.delete(
    "/me",
    summary="Delete account"
)
async def delete_account(
    req: UserDeleteRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    if req.confirmation != "DELETE":
        raise HTTPException(status_code=400, detail="Confirmation must be 'DELETE'")
        
    try:
        user_id = UUID(current_user["sub"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect password")
        
    await db.delete(user)
    await db.commit()
    return {"message": "Account deleted successfully"}

@router.post("/import-list", summary="Import movie/tv list from CSV")
async def import_list(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    try:
        user_id = UUID(current_user["sub"])
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid token")

    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a CSV")

    content = await file.read()
    text_content = content.decode("utf-8-sig")
    
    reader = csv.DictReader(io.StringIO(text_content))
    if not reader.fieldnames or not all(k in reader.fieldnames for k in ["title", "type", "year", "rating"]):
        raise HTTPException(status_code=400, detail="Invalid CSV format. Missing required columns.")

    stats = {"imported": 0, "skipped": 0, "unmatched": 0}

    valid_ratings = ["skip", "timepass", "go_for_it", "perfection"]

    for row in reader:
        title = row.get("title", "").strip()
        media_type = row.get("type", "").strip().lower()
        year_str = row.get("year", "").strip()
        rating_val = row.get("rating", "").strip().lower()

        if not title or not media_type or not year_str:
            stats["skipped"] += 1
            continue

        if media_type not in ["movie", "tv"]:
            media_type = "movie"
            
        try:
            year = int(year_str)
        except ValueError:
            stats["skipped"] += 1
            continue

        # Find movie by title, type, and year
        stmt = select(Movie).where(
            Movie.type == media_type,
            Movie.title.ilike(f"{title}"),
            extract('year', Movie.release_date) == year
        ).limit(1)
        
        result = await db.execute(stmt)
        movie = result.scalar_one_or_none()

        if not movie:
            stats["unmatched"] += 1
            continue

        # Upsert watch history
        watch_stmt = select(WatchHistory).where(
            WatchHistory.user_id == user_id,
            WatchHistory.movie_id == movie.id
        )
        existing_wh = (await db.execute(watch_stmt)).scalar_one_or_none()
        if not existing_wh:
            new_wh = WatchHistory(user_id=user_id, movie_id=movie.id)
            db.add(new_wh)

        # Upsert rating if valid
        if rating_val in valid_ratings:
            rating_stmt = select(Rating).where(
                Rating.user_id == user_id,
                Rating.movie_id == movie.id
            )
            existing_rating = (await db.execute(rating_stmt)).scalar_one_or_none()
            if existing_rating:
                existing_rating.category = rating_val
            else:
                new_rating = Rating(user_id=user_id, movie_id=movie.id, category=rating_val)
                db.add(new_rating)

        stats["imported"] += 1

    await db.commit()
    return stats
