import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    movie = await tmdb_service.fetch_movie_detail(615904)
    print("Movie detail found:", bool(movie))
    if movie:
        print("Movie title:", movie.get("title"))
    
    credits = await tmdb_service.fetch_movie_credits(615904)
    if not credits:
        print("No movie credits found")
        return
    cast = credits.get("cast", [])
    crew = credits.get("crew", [])
    print(f"Movie cast size: {len(cast)}, crew size: {len(crew)}")
    
    for c in cast[:10]:
        print(f"Cast: ID={c.get('id')}, Name={c.get('name')}, Character={c.get('character')}")

if __name__ == "__main__":
    asyncio.run(main())
