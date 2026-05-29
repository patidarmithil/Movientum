import asyncio
from app.services.tmdb_service import tmdb_service as tmdb

async def test_discover():
    print("Testing TMDB Discover...")
    movies = await tmdb.discover_movies("28,12") # Action, Adventure
    tv = await tmdb.discover_tv("10759,16") # Action/Adventure, Animation
    
    print(f"Movies returned: {len(movies.get('results', []))}")
    print(f"TV returned: {len(tv.get('results', []))}")
    
    print("\nTop Movie:")
    m = movies['results'][0]
    print(m.get('title'), m.get('popularity'))
    
    print("\nTop TV:")
    t = tv['results'][0]
    print(t.get('name'), t.get('popularity'))

if __name__ == "__main__":
    asyncio.run(test_discover())
