import asyncio
import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession
load_dotenv()

from app.db.database import AsyncSessionLocal
from app.services.recommendation_service import get_similar_items

async def test():
    async with AsyncSessionLocal() as db:
        items = await get_similar_items(db, 1396, "tv")
        print(f"Got {len(items)} items")
        if items:
            print("First item:", items[0])

if __name__ == "__main__":
    asyncio.run(test())
