import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    credits = await tmdb_service.fetch_person_credits(92572)
    if not credits:
        print("No credits found")
        return
    
    cast = credits.get("cast", [])
    crew = credits.get("crew", [])
    print(f"Total cast: {len(cast)}, Total crew: {len(crew)}")
    
    # Let's find "Marry Me" (id 615904)
    marry_me = None
    for item in cast + crew:
        if item.get("id") == 615904:
            marry_me = item
            break
            
    if marry_me:
        print("Found Marry Me:", marry_me)
    else:
        print("Marry Me not found in credits")
        
    # Let's find "The Tonight Show Starring Jimmy Fallon"
    fallon = []
    for item in cast + crew:
        title = item.get("title") or item.get("name") or ""
        if "fallon" in title.lower():
            fallon.append(item)
    print("Found Fallon credits count:", len(fallon))
    for f in fallon[:5]:
        print("Fallon credit:", f)

if __name__ == "__main__":
    asyncio.run(main())
