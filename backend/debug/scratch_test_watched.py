import asyncio
import uuid
from app.db.database import AsyncSessionLocal
from app.db.orm_models import User
from app.services import watch_service
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        # Find a real user in the DB
        stmt = select(User).limit(1)
        res = await db.execute(stmt)
        user = res.scalar_one_or_none()
        if not user:
            print("No users found in database. Cannot run test.")
            return

        user_id = user.id
        movie_id = 844251 # Invincible (exists in DB)
        
        print(f"Testing for User: {user.username} (ID: {user_id}), Movie ID: {movie_id}")
        
        # 1. Check status
        status = await watch_service.get_watch_status(db, user_id, movie_id)
        print(f"Initial Status: {status}")
        
        # 2. Mark watched
        print("Marking watched...")
        await watch_service.mark_watched(db, user_id, movie_id)
        
        # Verify status
        status = await watch_service.get_watch_status(db, user_id, movie_id)
        print(f"Status after marking watched: {status}")
        
        # 3. Remove watched
        print("Removing from watch history...")
        await watch_service.remove_from_watch_history(db, user_id, movie_id)
        
        # Verify status
        status = await watch_service.get_watch_status(db, user_id, movie_id)
        print(f"Status after removal: {status}")

if __name__ == "__main__":
    asyncio.run(main())
