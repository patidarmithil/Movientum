import asyncio
import os
from dotenv import load_dotenv
import httpx

load_dotenv()

async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get("http://127.0.0.1:8000/api/v1/movies/trending")
        print("Status:", resp.status_code)
        if resp.status_code == 200:
            data = resp.json()
            movies = data.get("movies", [])
            print(f"Total returned: {len(movies)}")
            
            movie_count = sum(1 for m in movies if m.get("media_type") == "movie")
            tv_count = sum(1 for m in movies if m.get("media_type") == "tv")
            print(f"Movies: {movie_count}, TV Shows: {tv_count}")
            
            print("\nTop 5 Items:")
            for m in movies[:5]:
                print(f"- [{m.get('media_type')}] {m.get('title')} (Pop: {m.get('popularity', 'N/A')}, Rating: {m.get('vote_average')})")
        else:
            print(resp.text)

if __name__ == "__main__":
    asyncio.run(main())
