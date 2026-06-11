import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    p1 = await tmdb_service.fetch_person_details(92572)
    p2 = await tmdb_service.fetch_person_details(16866)
    
    print("Person 92572:", p1.get("name") if p1 else None)
    print("Person 16866:", p2.get("name") if p2 else None)

if __name__ == "__main__":
    asyncio.run(main())
