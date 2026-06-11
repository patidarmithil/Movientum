import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    detail = await tmdb_service.fetch_movie_detail(1358005)
    print("Detail of 1358005:", detail)

if __name__ == "__main__":
    asyncio.run(main())
