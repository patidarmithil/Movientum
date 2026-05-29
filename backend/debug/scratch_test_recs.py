import asyncio
import uuid
from app.db.database import AsyncSessionLocal
from app.services.recommendation_service import get_personalized_recommendations

async def test_recs():
    async with AsyncSessionLocal() as db:
        # Create a dummy user ID
        # Wait, the DB requires actual user and watch history to return >= 3 watched count
        # For a fake UUID, it will have 0 watched count, so it will hit the trending fallback
        user_id = uuid.uuid4()
        
        print("Testing Cold Start (Trending Fallback)...")
        result = await get_personalized_recommendations(db, user_id)
        
        print(f"Source: {result.get('source')}")
        movies = result.get('movies', [])
        print(f"Count: {len(movies)}")
        for m in movies[:5]:
            print(f"- [{m.get('media_type', 'N/A')}] {m.get('title')}")

if __name__ == "__main__":
    asyncio.run(test_recs())
