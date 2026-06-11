import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    credits = await tmdb_service.fetch_person_credits(16866)
    cast = credits.get("cast", [])
    for w in cast:
        title = w.get("title") or w.get("name") or ""
        if "fallon" in title.lower():
            print("Keys:", list(w.keys()))
            print("character:", repr(w.get("character")))
            print("genre_ids:", repr(w.get("genre_ids")))
            char_lower = (w.get("character") or "").lower()
            print("self in char_lower:", "self" in char_lower)
            print("10767 in genre_ids:", 10767 in (w.get("genre_ids") or []))

if __name__ == "__main__":
    asyncio.run(main())
