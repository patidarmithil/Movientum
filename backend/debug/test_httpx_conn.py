import asyncio
import httpx

async def test_conn(use_local_address):
    print(f"Testing with use_local_address={use_local_address}...")
    if use_local_address:
        transport = httpx.AsyncHTTPTransport(local_address="0.0.0.0")
    else:
        transport = httpx.AsyncHTTPTransport()
        
    async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
        try:
            resp = await client.get("https://api.themoviedb.org/3/search/multi", params={"query": "spider-man"})
            print(f"Success! Status: {resp.status_code}")
        except Exception as e:
            print(f"Failed: {type(e).__name__} - {e}")

async def main():
    await test_conn(True)
    await test_conn(False)

if __name__ == "__main__":
    asyncio.run(main())
