import asyncio
from app.db.cache import redis_client

async def clear():
    await redis_client.delete("movie:trending")
    print("Cleared movie:trending cache")

if __name__ == "__main__":
    asyncio.run(clear())
