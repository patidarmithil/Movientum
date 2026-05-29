import asyncio
from app.db.database import get_db
from app.routers.movies import get_trending
from app.services.tmdb_service import tmdb_service as tmdb

async def main():
    async with tmdb:
        # We need a dummy DB session, but get_trending doesn't use it now
        # except it has db: AsyncSession = Depends(get_db)
        # We can just pass None for db since our new logic doesn't use the DB at all!
        data = await get_trending(db=None)
        
        movies = data.get("movies", [])
        print(f"Total returned: {len(movies)}")
        
        movie_count = sum(1 for m in movies if m.get("media_type") == "movie")
        tv_count = sum(1 for m in movies if m.get("media_type") == "tv")
        print(f"Movies: {movie_count}, TV Shows: {tv_count}")
        
        print("\nTop 5 Items:")
        for m in movies[:5]:
            print(f"- [{m.get('media_type')}] {m.get('title')} (Pop: {m.get('popularity', 'N/A')}, Rating: {m.get('vote_average')})")

if __name__ == "__main__":
    asyncio.run(main())
