import asyncio
from app.services.tmdb_service import tmdb_service
from app.routers.person import _person_credit_score

async def main():
    credits = await tmdb_service.fetch_person_credits(16866)
    if not credits:
        return
    cast = credits.get("cast", [])
    
    # Let's filter like we do in person.py (excluding self/documentary etc.)
    filtered = []
    for w in cast:
        char_lower = (w.get("character") or "").lower()
        if "self" in char_lower or "himself" in char_lower or "herself" in char_lower:
            continue
            
        genres = w.get("genre_ids", []) or []
        if any(g_id in genres for g_id in [10767, 10764, 99, 10763]):
            continue
            
        filtered.append(w)
        
    filtered.sort(key=lambda x: x.get("popularity", 0.0) or 0.0, reverse=True)
    
    print("Top 30 credits sorted by popularity:")
    for idx, w in enumerate(filtered[:30]):
        title = w.get("title") or w.get("name")
        print(f"{idx+1}. {title} (ID={w.get('id')}, {w.get('media_type')}): pop={w.get('popularity')}, char={w.get('character')}, episodes={w.get('episode_count')}, genres={w.get('genre_ids')}")

if __name__ == "__main__":
    asyncio.run(main())
