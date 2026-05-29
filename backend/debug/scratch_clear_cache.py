import asyncio
import os
from dotenv import load_dotenv
load_dotenv()
from app.db.cache import redis_client

async def test():
    res = await redis_client.flushdb()
    print(f"Flushed Redis DB: {res}")

if __name__ == "__main__":
    asyncio.run(test())
