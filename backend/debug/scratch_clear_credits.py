import asyncio
from app.db.cache import redis_client

async def clear():
    keys = await redis_client.keys("tmdb:credits:*")
    if keys:
        await redis_client.delete(*keys)
        print(f"Deleted {len(keys)} movie credits cache keys")
    else:
        print("No movie credits cache keys found")

if __name__ == "__main__":
    asyncio.run(clear())
