import asyncio
from app.db.database import AsyncSessionLocal
from app.routers.search import search_movies

async def test_search(query):
    print(f"\n--- Testing Search Router for query: '{query}' ---")
    async with AsyncSessionLocal() as db:
        try:
            resp = await search_movies(
                q=query,
                type="content",
                genre="",
                page=1,
                limit=20,
                db=db
            )
            data = resp.get("data", {})
            results = data.get("results", [])
            print(f"Total results returned: {len(results)}, total count in metadata: {data.get('total')}")
            for idx, r in enumerate(results):
                print(f"{idx+1}. ID: {r.get('id')}, Title: {r.get('title') or r.get('name')}, MediaType: {r.get('media_type')}, Popularity: {r.get('popularity')}")
        except Exception as e:
            print(f"Error: {e}")

async def main():
    await test_search("spider man")
    await test_search("spider man 2")

if __name__ == "__main__":
    asyncio.run(main())
