import httpx
import asyncio

async def main():
    async with httpx.AsyncClient() as client:
        resp = await client.get("http://127.0.0.1:8000/api/v1/movies/157336/credits")
        print(f"Status: {resp.status_code}")
        data = resp.json()
        print(f"Cast count: {len(data.get('cast', []))}")
        print(f"Crew count: {len(data.get('crew', []))}")
        if data.get("crew"):
            print("First crew:", data["crew"][0])

if __name__ == "__main__":
    asyncio.run(main())
