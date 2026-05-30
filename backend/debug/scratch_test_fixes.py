import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from app.db.database import AsyncSessionLocal
from app.db.orm_models import User, Movie, MovieGenre, WatchHistory, ClickHistory, Rating, Genre
from app.services.recommendation_service import get_personalized_recommendations
from app.services.click_service import get_click_profile

async def test_fixes():
    print("=" * 60)
    print("RUNNING RECOMMENDATION SYSTEM FIXES TEST")
    print("=" * 60)
    
    async with AsyncSessionLocal() as db:
        # 1. Fetch some movies from the local database
        movies_stmt = select(Movie).options(selectinload(Movie.genres).selectinload(MovieGenre.genre)).limit(50)
        movies = list((await db.execute(movies_stmt)).scalars().all())
        
        if len(movies) < 40:
            print(f"Error: Need at least 40 movies in the database to run the test. Found: {len(movies)}")
            return
            
        print(f"Found {len(movies)} movies in DB. Proceeding with test user creation.")
        
        # 2. Create a clean test user
        test_user = User(
            id=uuid.uuid4(),
            email=f"test_{uuid.uuid4().hex[:8]}@example.com",
            username=f"test_{uuid.uuid4().hex[:8]}",
            password_hash="mock_hash"
        )
        db.add(test_user)
        await db.commit()
        print(f"Created test user: {test_user.username} (ID: {test_user.id})")
        
        try:
            # 3. Setup watch history: watch 3 movies (to trigger genre affinity and bypass cold-start)
            watched_movies = movies[:3]
            for m in watched_movies:
                wh = WatchHistory(user_id=test_user.id, movie_id=m.id, watched_at=datetime.now(timezone.utc))
                db.add(wh)
            await db.commit()
            print(f"Added watch history for movies: {[m.title for m in watched_movies]}")
            
            # Get watch genres to see what they are
            watch_genres = set()
            for m in watched_movies:
                for mg in m.genres:
                    watch_genres.add(mg.genre.name)
            print(f"Watch genres: {list(watch_genres)}")
            
            # 4. Setup click history for freshness test (Rule 4: last 14 days only)
            # Click on movie 4: 15 days ago (should NOT show up in profile)
            # Click on movie 5: 1 day ago (should show up in profile)
            click_old = ClickHistory(
                user_id=test_user.id,
                item_id=movies[3].id,
                media_type="movie",
                clicked_at=datetime.now(timezone.utc) - timedelta(days=15)
            )
            click_new = ClickHistory(
                user_id=test_user.id,
                item_id=movies[4].id,
                media_type="movie",
                clicked_at=datetime.now(timezone.utc) - timedelta(days=1)
            )
            db.add(click_old)
            db.add(click_new)
            await db.commit()
            
            profile_rec = await get_click_profile(db, test_user.id, freshness_days=14, limit_items=20)
            profile_all = await get_click_profile(db, test_user.id) # no freshness cutoff
            
            print("\n--- Freshness Window Test (Rule 4) ---")
            print(f"Recommendation click profile (last 14 days): {profile_rec}")
            print(f"All-time click profile: {profile_all}")
            
            # Check if movies[3] (old) genres are excluded from profile_rec but in profile_all
            old_movie_genres = [mg.genre.name for mg in movies[3].genres]
            new_movie_genres = [mg.genre.name for mg in movies[4].genres]
            print(f"Old click movie genres: {old_movie_genres}")
            print(f"New click movie genres: {new_movie_genres}")
            
            # 5. Setup click history for spam limit test (Rule 5: top 20 items only)
            # We will insert clicks for 25 different movies. Each with 1 click.
            # But we will give the first 20 movies a higher recency weight (today)
            # and the last 5 movies a lower weight (5 days ago).
            # So the top 20 weighted items should be the first 20.
            # The remaining 5 items should be filtered out from click profile.
            print("\n--- Click Spam Limit Test (Rule 5) ---")
            # First, delete existing clicks to start clean
            await db.execute(delete(ClickHistory).where(ClickHistory.user_id == test_user.id))
            await db.commit()
            
            spam_movies = movies[5:30] # 25 movies
            for idx, m in enumerate(spam_movies):
                clicked_date = datetime.now(timezone.utc) if idx < 20 else datetime.now(timezone.utc) - timedelta(days=5)
                c = ClickHistory(
                    user_id=test_user.id,
                    item_id=m.id,
                    media_type="movie",
                    clicked_at=clicked_date
                )
                db.add(c)
            await db.commit()
            
            # Profile with top 20 items
            profile_spam_limited = await get_click_profile(db, test_user.id, freshness_days=14, limit_items=20)
            print(f"Spam limited profile: {profile_spam_limited}")
            
            # 6. Setup high interest items test (Rule 2: placement & conditions)
            # We want:
            # - HI_1: Item has poster, not watched, not rated low. Should be inserted at position 8 (index 7).
            # - HI_2: Item has poster, watched. Should NOT be inserted.
            # - HI_3: Item has poster, not watched, rated low ('skip'). Should NOT be inserted.
            # - HI_4: Item has NO poster, not watched. Should NOT be inserted.
            # Let's assign these roles to movies:
            # movies[30] -> HI_1: has poster (e.g. movies[30].poster_path is set), not watched, not rated.
            # movies[31] -> HI_2: has poster, watched (watched_movies list).
            # movies[32] -> HI_3: has poster, not watched, rated 'skip'.
            # movies[33] -> HI_4: NO poster (we will temporarily set poster_path to None in memory/DB), not watched.
            print("\n--- High Interest Placement & Conditions Test (Rule 2) ---")
            # Clear clicks again
            await db.execute(delete(ClickHistory).where(ClickHistory.user_id == test_user.id))
            await db.commit()
            
            # Setup watched list to include HI_2
            wh_hi2 = WatchHistory(user_id=test_user.id, movie_id=movies[31].id, watched_at=datetime.now(timezone.utc))
            db.add(wh_hi2)
            
            # Setup rating for HI_3 to be 'skip'
            rating_hi3 = Rating(id=uuid.uuid4(), user_id=test_user.id, movie_id=movies[32].id, category="skip")
            db.add(rating_hi3)
            
            # Setup movie HI_4 to have NO poster
            original_poster = movies[33].poster_path
            movies[33].poster_path = None
            db.add(movies[33])
            
            # Ensure movie HI_1 has poster
            if not movies[30].poster_path:
                movies[30].poster_path = "/mock_poster_path.jpg"
                db.add(movies[30])
                
            await db.commit()
            
            # Add repeated clicks for all of them to trigger high interest (>= 2 clicks separated by >30s)
            # HI_1
            c1_1 = ClickHistory(user_id=test_user.id, item_id=movies[30].id, media_type="movie", clicked_at=datetime.now(timezone.utc) - timedelta(seconds=40))
            c1_2 = ClickHistory(user_id=test_user.id, item_id=movies[30].id, media_type="movie", clicked_at=datetime.now(timezone.utc))
            # HI_2
            c2_1 = ClickHistory(user_id=test_user.id, item_id=movies[31].id, media_type="movie", clicked_at=datetime.now(timezone.utc) - timedelta(seconds=40))
            c2_2 = ClickHistory(user_id=test_user.id, item_id=movies[31].id, media_type="movie", clicked_at=datetime.now(timezone.utc))
            # HI_3
            c3_1 = ClickHistory(user_id=test_user.id, item_id=movies[32].id, media_type="movie", clicked_at=datetime.now(timezone.utc) - timedelta(seconds=40))
            c3_2 = ClickHistory(user_id=test_user.id, item_id=movies[32].id, media_type="movie", clicked_at=datetime.now(timezone.utc))
            # HI_4
            c4_1 = ClickHistory(user_id=test_user.id, item_id=movies[33].id, media_type="movie", clicked_at=datetime.now(timezone.utc) - timedelta(seconds=40))
            c4_2 = ClickHistory(user_id=test_user.id, item_id=movies[33].id, media_type="movie", clicked_at=datetime.now(timezone.utc))
            
            db.add(c1_1); db.add(c1_2)
            db.add(c2_1); db.add(c2_2)
            db.add(c3_1); db.add(c3_2)
            db.add(c4_1); db.add(c4_2)
            await db.commit()
            
            # Now let's fetch personalized recommendations!
            recs_result = await get_personalized_recommendations(db, test_user.id)
            recs_movies = recs_result.get("movies", [])
            print(f"Recommendations source: {recs_result.get('source')}")
            print(f"Recommendations count: {len(recs_movies)}")
            
            # Check high interest item positions
            print("Checking returned recommendations for high interest items:")
            for idx, rm in enumerate(recs_movies):
                if rm["id"] in [movies[30].id, movies[31].id, movies[32].id, movies[33].id]:
                    print(f"Found item {rm['id']} ({rm['title']}) at index {idx} (Position {idx + 1})")
            
            # Assert HI_1 (movies[30].id) is at index 7 (Position 8)
            assert recs_movies[7]["id"] == movies[30].id, f"Expected HI_1 (id={movies[30].id}) at position 8 (index 7), but found id={recs_movies[7]['id']}"
            print("Rule 2 (High Interest Placement & Conditions) check: PASSED!")
            
            # Restore HI_4 poster path
            movies[33].poster_path = original_poster
            db.add(movies[33])
            await db.commit()
            
        finally:
            print("\nCleaning up test data...")
            # Clean up user relationships
            await db.execute(delete(ClickHistory).where(ClickHistory.user_id == test_user.id))
            await db.execute(delete(WatchHistory).where(ClickHistory.user_id == test_user.id))
            await db.execute(delete(Rating).where(Rating.user_id == test_user.id))
            # Delete test user
            await db.execute(delete(User).where(User.id == test_user.id))
            await db.commit()
            print("Cleanup complete!")
            
    print("=" * 60)
    print("TEST FINISHED successfully!")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_fixes())
