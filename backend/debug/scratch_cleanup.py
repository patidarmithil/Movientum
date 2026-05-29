import asyncio
import redis.asyncio as redis
from sqlalchemy import delete
from app.db.database import AsyncSessionLocal
from app.db.orm_models import Movie

from dotenv import load_dotenv
load_dotenv()
import os

async def main():
    r = redis.from_url(os.environ["REDIS_URL"])
    await r.flushdb()
    print('Redis flushed')
    
    async with AsyncSessionLocal() as db:
        await db.execute(delete(Movie).where(Movie.id == 1396))
        await db.commit()
        print('Deleted 1396')

if __name__ == '__main__':
    asyncio.run(main())
