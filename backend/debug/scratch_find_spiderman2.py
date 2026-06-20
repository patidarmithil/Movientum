import asyncio
from sqlalchemy import select
from app.db.database import AsyncSessionLocal
from app.db.orm_models import Movie
from app.services.tmdb_service import tmdb_service

async def main():
    async with AsyncSessionLocal() as db:
        stmt = select(Movie).where(Movie.title.ilike("%spider-man 2%"))
        res = await db.execute(stmt)
        movies = res.scalars().all()
        print(f"Local database 'spider-man 2' matches: {len(movies)}")
        for m in movies:
            print(f"ID: {m.id}, Title: {m.title}, Popularity: {m.popularity}, Poster: {m.poster_path}, Adult: {m.adult}")
            
    print("\nQuerying TMDB search for 'spider-man 2'...")
    res_tmdb = await tmdb_service.multi_search("spider-man 2")
    if res_tmdb and "results" in res_tmdb:
        print(f"TMDB search results count: {len(res_tmdb['results'])}")
        for item in res_tmdb["results"][:10]:
            print(f"ID: {item.get('id')}, Title: {item.get('title') or item.get('name')}, MediaType: {item.get('media_type')}, Popularity: {item.get('popularity')}, Poster: {item.get('poster_path')}, Adult: {item.get('adult')}")

if __name__ == "__main__":
    asyncio.run(main())
