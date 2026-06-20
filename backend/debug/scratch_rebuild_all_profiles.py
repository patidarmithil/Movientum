import asyncio
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.database import AsyncSessionLocal
from app.db.orm_models import UserTasteProfile
from app.services.feedback_service import rebuild_taste_profile_from_history
from sqlalchemy import select

async def run():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(UserTasteProfile))
        profiles = res.scalars().all()
        print(f"Found {len(profiles)} taste profiles to rebuild.")
        for profile in profiles:
            print(f"Rebuilding taste profile for user {profile.user_id}...")
            await rebuild_taste_profile_from_history(db, profile)
            print(f"Rebuilt user {profile.user_id} successfully!")

if __name__ == "__main__":
    asyncio.run(run())
