import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    credits = await tmdb_service.fetch_person_credits(16866)
    if not credits:
        print("No credits")
        return
    cast = credits.get("cast", [])
    crew = credits.get("crew", [])
    print(f"Raw cast size: {len(cast)}, crew size: {len(crew)}")
    
    found = False
    for item in cast:
        if item.get("id") == 615904:
            print("Found in cast:", item)
            found = True
    for item in crew:
        if item.get("id") == 615904:
            print("Found in crew:", item)
            found = True
            
    if not found:
        print("Marry Me NOT found in JLo's combined_credits!")

if __name__ == "__main__":
    asyncio.run(main())
