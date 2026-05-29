import asyncio
import os
from dotenv import load_dotenv
load_dotenv()
from app.db.cache import redis_client

async def flush_cache():
    # Fetch all keys and delete them
    keys = await redis_client.keys("search:auto:*")
    if keys:
        await redis_client.delete(*keys)
        print(f"Deleted {len(keys)} autocomplete keys")
        
    keys_q = await redis_client.keys("search:query:*")
    if keys_q:
        await redis_client.delete(*keys_q)
        print(f"Deleted {len(keys_q)} search query keys")

if __name__ == "__main__":
    asyncio.run(flush_cache())
