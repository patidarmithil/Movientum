import asyncio
import httpx
from rich import print
import time

async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        print("[bold yellow]Testing GET /api/v1/movies/top_rated[/bold yellow]")
        
        start = time.time()
        r = await client.get("http://127.0.0.1:8000/api/v1/movies/top_rated")
        elapsed = time.time() - start
        
        print(f"Status: {r.status_code}")
        print(f"Time: {elapsed:.2f}s")
        
        if r.status_code == 200:
            data = r.json()
            movies = data.get("movies", [])
            print(f"Total returned: {len(movies)}")
            
            movies_count = sum(1 for m in movies if m.get("media_type") == "movie")
            tv_count = sum(1 for m in movies if m.get("media_type") == "tv")
            
            print(f"Movies: {movies_count}, TV Shows: {tv_count}")
            
            for i, m in enumerate(movies[:10]):
                print(f"{i+1}. [{m.get('media_type', 'unknown').upper()}] {m.get('title') or m.get('name')} (Rating: {m.get('vote_average')})")

if __name__ == "__main__":
    asyncio.run(main())
