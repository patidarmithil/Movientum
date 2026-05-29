import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as client:
        r = await client.get("http://127.0.0.1:8000/api/v1/search?q=citadel&page=1")
        data = r.json()
        results = data.get("data", {}).get("results", [])
        for item in results:
            if item.get("id") == 114922:
                print(f"Citadel TV: {item}")
        
if __name__ == "__main__":
    asyncio.run(test())
