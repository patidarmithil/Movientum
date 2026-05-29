from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.orm_models import Movie

async def autocomplete_search(db: AsyncSession, prefix: str):
    prefix_val = f"{prefix.lower()}%"
    stmt = (
        select(Movie)
        .where(func.lower(Movie.title).like(prefix_val))
        .order_by(Movie.popularity.desc())
        .limit(8)
    )
    result = await db.execute(stmt)
    return result.scalars().all()
