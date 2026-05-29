import asyncio
from app.db.database import AsyncSessionLocal
from app.routers.movies import get_movie_by_id

async def test():
    async with AsyncSessionLocal() as db:
        # Test an existing movie
        print("Testing local DB movie ID 1396:")
        try:
            res = await get_movie_by_id(movie_id=1396, db=db)
            print(f"Title: {res.get('title')}")
            print(f"Directors: {res.get('directors')}")
        except Exception as e:
            print(f"Error on 1396: {e}")
        
        # Test a movie from TMDB (e.g., ID 274870)
        print("\nTesting TMDB movie ID 274870:")
        try:
            res2 = await get_movie_by_id(movie_id=274870, db=db)
            print(f"Title: {res2.get('title')}")
            print(f"Directors: {res2.get('directors')}")
        except Exception as e:
            print(f"Error on 274870: {e}")

if __name__ == "__main__":
    asyncio.run(test())
