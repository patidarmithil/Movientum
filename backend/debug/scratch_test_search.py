import asyncio
from app.db.database import AsyncSessionLocal
from app.routers.search import search_movies

async def test():
    async with AsyncSessionLocal() as db:
        res = await search_movies(q="breaking bad", page=1, limit=20, genre=None, db=db)
        data = res["data"]
        print(f"Total: {data['total']}")
        for m in data['results']:
            try:
                print(f"- {m['title']} (ID: {m['id']}, Type: {m.get('media_type')})")
            except UnicodeEncodeError:
                print(f"- [Unicode title] (ID: {m['id']}, Type: {m.get('media_type')})")

if __name__ == "__main__":
    asyncio.run(test())
