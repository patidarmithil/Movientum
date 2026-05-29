import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as client:
        r = await client.get("http://127.0.0.1:8000/api/v1/movies/explore?page=1&limit=24&sort=popularity")
        print(r.status_code)
        print(r.json())

if __name__ == "__main__":
    asyncio.run(test())
