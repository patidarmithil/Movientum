import asyncio
from app.services.tmdb_service import tmdb_service

async def main():
    credits = await tmdb_service.fetch_person_credits(16866)
    cast = credits.get("cast", [])
    
    marry_me = None
    for w in cast:
        if w.get("id") == 615904:
            marry_me = w
            break
            
    if not marry_me:
        print("Marry Me not in raw cast")
        return
        
    print("Marry Me raw cast item:", marry_me)
    
    # Trace filter: character check
    char_lower = (marry_me.get("character") or "").lower()
    self_filtered = "self" in char_lower or "himself" in char_lower or "herself" in char_lower
    print("Filtered by character (self/himself/herself):", self_filtered)
    
    # Trace filter: genres check
    genres = marry_me.get("genre_ids", []) or []
    genre_filtered = any(g_id in genres for g_id in [10767, 10764, 99, 10763])
    print("Filtered by genre (10767/10764/99/10763):", genre_filtered)
    
    # Check popularity sorting rank
    # Let's count how many items have popularity > marry_me popularity
    pop = marry_me.get("popularity", 0.0) or 0.0
    
    # Let's filter the entire list like we do in person.py
    filtered = []
    for w in cast:
        char_lower = (w.get("character") or "").lower()
        if "self" in char_lower or "himself" in char_lower or "herself" in char_lower:
            continue
        genres_w = w.get("genre_ids", []) or []
        if any(g_id in genres_w for g_id in [10767, 10764, 99, 10763]):
            continue
        filtered.append(w)
        
    higher_pop_items = [item for item in filtered if (item.get("popularity", 0.0) or 0.0) > pop]
    print(f"Number of filtered items with popularity > {pop}: {len(higher_pop_items)}")
    
    # Let's print the items with higher popularity
    higher_pop_items.sort(key=lambda x: x.get("popularity", 0.0) or 0.0, reverse=True)
    print("Items with higher popularity:")
    for idx, item in enumerate(higher_pop_items):
        print(f"{idx+1}. {item.get('title') or item.get('name')} (pop={item.get('popularity')})")

if __name__ == "__main__":
    asyncio.run(main())
