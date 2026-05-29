import asyncio
import httpx
from rich import print
import time

async def main():
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Tom Hanks is TMDB ID 31
        person_id = 31
        print(f"\n[bold yellow]Testing GET /api/v1/person/{person_id}[/bold yellow]")
        r1 = await client.get(f"http://127.0.0.1:8000/api/v1/person/{person_id}")
        print(f"Details Status: {r1.status_code}")
        if r1.status_code == 200:
            details = r1.json()
            print(f"Name: {details.get('name')}")
            print(f"Age: {details.get('age')}")
            print(f"Contains known_for: {'known_for' in details}")

        print(f"\n[bold yellow]Testing GET /api/v1/person/{person_id}/credits[/bold yellow]")
        start = time.time()
        r2 = await client.get(f"http://127.0.0.1:8000/api/v1/person/{person_id}/credits")
        elapsed = time.time() - start
        print(f"Credits Status: {r2.status_code}")
        print(f"Time: {elapsed:.2f}s")
        if r2.status_code == 200:
            credits = r2.json()
            print(f"Total returned: {len(credits)}")
            for i, c in enumerate(credits):
                print(f"{i+1}. [{c.get('media_type').upper()}] {c.get('title')} ({c.get('release_year')}) - Pop: {c.get('popularity')}")

if __name__ == "__main__":
    asyncio.run(main())
