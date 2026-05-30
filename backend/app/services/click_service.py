import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID
from collections import Counter, defaultdict

from sqlalchemy import func, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.orm_models import ClickHistory, MovieGenre
from app.services.tmdb_service import tmdb_service as _tmdb

logger = logging.getLogger(__name__)


def recency_weight(clicked_at: datetime) -> float:
    age_days = (datetime.now(timezone.utc) - clicked_at.replace(tzinfo=timezone.utc)).days
    if age_days <= 1:   return 1.0
    if age_days <= 2:   return 0.8
    if age_days <= 7:   return 0.5
    if age_days <= 14:  return 0.3
    return 0.1


async def insert_click(db: AsyncSession, user_id: UUID, item_id: int, media_type: str, source: str = None):
    # Enforce duplicate rule: ignore same item < 30s
    recent_stmt = (
        select(ClickHistory)
        .where(
            ClickHistory.user_id == user_id,
            ClickHistory.item_id == item_id,
            ClickHistory.media_type == media_type,
            ClickHistory.clicked_at > datetime.now(timezone.utc) - timedelta(seconds=30)
        )
    )
    recent = (await db.execute(recent_stmt)).scalars().first()
    if recent:
        return  # Ignore duplicate

    new_click = ClickHistory(user_id=user_id, item_id=item_id, media_type=media_type, source=source)
    db.add(new_click)
    await db.commit()

    # Trim over 200
    count_stmt = select(func.count(ClickHistory.id)).where(ClickHistory.user_id == user_id)
    count = (await db.execute(count_stmt)).scalar_one()

    if count > 200:
        excess = count - 200
        old_ids_stmt = (
            select(ClickHistory.id)
            .where(ClickHistory.user_id == user_id)
            .order_by(ClickHistory.clicked_at.asc())
            .limit(excess)
        )
        old_ids = (await db.execute(old_ids_stmt)).scalars().all()
        if old_ids:
            await db.execute(delete(ClickHistory).where(ClickHistory.id.in_(old_ids)))
            await db.commit()


async def get_click_profile(db: AsyncSession, user_id: UUID, freshness_days: int = None, limit_items: int = None) -> dict:
    stmt = select(ClickHistory).where(ClickHistory.user_id == user_id)
    if freshness_days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=freshness_days)
        stmt = stmt.where(ClickHistory.clicked_at >= cutoff)
    stmt = stmt.order_by(ClickHistory.clicked_at.desc())
    clicks = list((await db.execute(stmt)).scalars().all())
    
    if not clicks:
        return {}
    
    # Filter duplicates >30s for computing freq
    filtered_clicks = []
    seen_recent = {}
    for c in clicks:
        key = (c.item_id, c.media_type)
        if key in seen_recent:
            if (seen_recent[key] - c.clicked_at) < timedelta(seconds=30):
                continue
        seen_recent[key] = c.clicked_at
        filtered_clicks.append(c)
        
    item_clicks = defaultdict(list)
    for c in filtered_clicks:
        item_clicks[(c.item_id, c.media_type)].append(c.clicked_at)

    item_weights = {}
    for (item_id, media_type), click_dates in item_clicks.items():
        raw = sum(recency_weight(d) for d in click_dates)
        freq_boost = min(1.0 + 0.5 * (len(click_dates) - 1), 2.0)
        weight = raw * freq_boost
        item_weights[(item_id, media_type)] = weight

    # Limit to top N weighted clicked items
    if limit_items is not None:
        sorted_items = sorted(item_weights.items(), key=lambda x: x[1], reverse=True)[:limit_items]
        item_weights = dict(sorted_items)

    genre_counts = defaultdict(float)
    
    for (item_id, media_type), weight in item_weights.items():
        genres = []
        if media_type == "movie":
            # fetch local db first
            g_stmt = select(MovieGenre).options(selectinload(MovieGenre.genre)).where(MovieGenre.movie_id == item_id)
            mg = (await db.execute(g_stmt)).scalars().all()
            if mg:
                genres = [m.genre.name for m in mg]
        
        if not genres:
            # fetch tmdb
            try:
                if media_type == "movie":
                    info = await _tmdb._get(f"/movie/{item_id}", params={"language": "en-US"})
                else:
                    info = await _tmdb.fetch_tv_detail(item_id)
                if info and "genres" in info:
                    genres = [g["name"] for g in info["genres"]]
            except Exception as e:
                logger.warning(f"Failed to fetch TMDB genres for {media_type} {item_id}: {e}")
                
        for g in genres:
            genre_counts[g] += weight
            
    total = sum(genre_counts.values())
    if total == 0:
        return {}
        
    return {g: round(count / total, 3) for g, count in genre_counts.items()}


async def get_repeated_interest(db: AsyncSession, user_id: UUID) -> list:
    stmt = select(ClickHistory).where(ClickHistory.user_id == user_id).order_by(ClickHistory.clicked_at.desc())
    clicks = list((await db.execute(stmt)).scalars().all())
    
    filtered_clicks = []
    seen_recent = {}
    for c in clicks:
        key = (c.item_id, c.media_type)
        if key in seen_recent:
            if (seen_recent[key] - c.clicked_at) < timedelta(seconds=30):
                continue
        seen_recent[key] = c.clicked_at
        filtered_clicks.append(c)
        
    counts = Counter((c.item_id, c.media_type) for c in filtered_clicks)
    high_interest = [{"id": item[0], "media_type": item[1], "count": count} for item, count in counts.most_common() if count >= 2]
    return high_interest


def compute_watch_vs_click_gap(click_profile: dict, watch_profile: dict) -> dict:
    all_genres = set(click_profile.keys()).union(set(watch_profile.keys()))
    comparison = {}
    
    for genre in all_genres:
        c_score = click_profile.get(genre, 0.0)
        w_score = watch_profile.get(genre, 0.0)
        gap = round(c_score - w_score, 3)
        
        if gap > 0.15:
            label = "exploration_interest"
        elif gap < -0.15:
            label = "confirmed_preference"
        else:
            label = "neutral"
            
        comparison[genre] = {
            "watch": w_score,
            "click": c_score,
            "gap": gap,
            "label": label
        }
        
    return comparison


async def get_click_count(db: AsyncSession, user_id: UUID) -> int:
    stmt = select(func.count(ClickHistory.id)).where(ClickHistory.user_id == user_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none() or 0
