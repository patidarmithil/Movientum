import asyncio
from app.db.database import AsyncSessionLocal
from app.services.tmdb_service import tmdb_service
from app.routers.search import insert_movie_if_not_exists

async def test():
    async with AsyncSessionLocal() as db:
        tmdb_resp = await tmdb_service.multi_search("breaking bad")
        if tmdb_resp and "results" in tmdb_resp:
            print(f"Got {len(tmdb_resp['results'])} results from TMDB")
            for item in tmdb_resp["results"][:5]:
                print(f"Trying to insert: {item.get('title') or item.get('name')} ({item.get('media_type')})")
                if item.get("media_type") == "movie":
                    try:
                        await insert_movie_if_not_exists(db, item)
                        print("Inserted.")
                    except Exception as e:
                        print("ERROR:", repr(e))

if __name__ == "__main__":
    asyncio.run(test())
