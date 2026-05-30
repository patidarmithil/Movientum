import logging
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.orm_models import WatchHistory, Rating, MovieGenre, ClickHistory, Movie
from app.services.click_service import get_click_profile

logger = logging.getLogger(__name__)

# Numeric weight for ratings on a 0-10 scale
RATING_VALUES = {
    "perfection": 9.5,
    "go_for_it": 7.5,
    "timepass": 5.0,
    "skip": 1.5
}

def _get_rating_style_label(avg_score: float) -> str:
    if avg_score >= 8.0: return "Strict Critic"
    if avg_score >= 6.0: return "Casual Viewer"
    return "Hard to Please"

async def get_user_analysis(db: AsyncSession, user_id: UUID) -> Dict[str, Any]:
    # 1. Fetch Watch History with Movies and Genres
    stmt_watch = (
        select(WatchHistory)
        .options(selectinload(WatchHistory.movie).selectinload(Movie.genres).selectinload(MovieGenre.genre))
        .where(WatchHistory.user_id == user_id)
    )
    watched_items = list((await db.execute(stmt_watch)).scalars().all())
    
    # 2. Fetch Ratings with Movies
    stmt_ratings = (
        select(Rating)
        .options(selectinload(Rating.movie))
        .where(Rating.user_id == user_id)
    )
    user_ratings = list((await db.execute(stmt_ratings)).scalars().all())
    
    # 3. Fetch Click Profile
    click_profile = await get_click_profile(db, user_id, freshness_days=30)
    
    # 4. Fetch Clicks for time-based and rewatch analysis
    stmt_clicks = (
        select(ClickHistory)
        .where(ClickHistory.user_id == user_id)
        .order_by(ClickHistory.clicked_at.desc())
    )
    all_clicks = list((await db.execute(stmt_clicks)).scalars().all())

    # --- Basic Totals and Mappings ---
    watched_dict = {w.movie_id: w.watched_at for w in watched_items if w.movie}
    rating_dict = {r.movie_id: r.category for r in user_ratings}
    
    movie_count = 0
    tv_count = 0
    popularities = []
    genre_count = defaultdict(float)
    
    for w in watched_items:
        m = w.movie
        if not m:
            continue
        if m.type == "tv":
            tv_count += 1
        else:
            movie_count += 1
            
        if m.popularity:
            popularities.append(m.popularity)
            
        for mg in m.genres:
            genre_count[mg.genre.name] += 1.0

    # --- 1. Genre Distribution (Real Breakdown: 70% Watch + 30% Click) ---
    total_watch_genres = sum(genre_count.values())
    watch_genre_profile = {g: count / total_watch_genres for g, count in genre_count.items()} if total_watch_genres > 0 else {}
    
    combined_genres = {}
    all_genres = set(watch_genre_profile.keys()) | set(click_profile.keys())
    
    for g in all_genres:
        w_val = watch_genre_profile.get(g, 0.0)
        c_val = click_profile.get(g, 0.0)
        if watch_genre_profile and click_profile:
            combined_genres[g] = 0.7 * w_val + 0.3 * c_val
        elif watch_genre_profile:
            combined_genres[g] = w_val
        elif click_profile:
            combined_genres[g] = c_val
        else:
            combined_genres[g] = 0.0
            
    total_comb = sum(combined_genres.values())
    if total_comb > 0:
        genre_distribution = sorted(
            [{"genre": g, "percentage": round(val / total_comb, 3)} for g, val in combined_genres.items() if val > 0],
            key=lambda x: x["percentage"],
            reverse=True
        )
    else:
        genre_distribution = []

    # --- 2. Rating Behavior Profile ---
    liked_count = 0
    neutral_count = 0
    disliked_count = 0
    rating_scores = []
    
    for r in user_ratings:
        cat = r.category.lower()
        score = RATING_VALUES.get(cat, 5.0)
        rating_scores.append(score)
        
        if score >= 7.0:
            liked_count += 1
        elif score >= 4.0:
            neutral_count += 1
        else:
            disliked_count += 1
            
    avg_rating = sum(rating_scores) / len(rating_scores) if rating_scores else 0.0
    style_label = _get_rating_style_label(avg_rating) if rating_scores else "No Data"
    
    rating_profile = {
        "avg_rating": round(avg_rating, 2),
        "liked_count": liked_count,
        "neutral_count": neutral_count,
        "disliked_count": disliked_count,
        "distribution": {
            "Liked (7-10)": liked_count,
            "Neutral (4-6)": neutral_count,
            "Disliked (0-3)": disliked_count
        },
        "style_label": style_label
    }

    # --- 3. Time-Based Watch Pattern ---
    # Days: Mon=0 to Sun=6. Hours: 0 to 23.
    day_map = {0: "Mon", 1: "Tue", 2: "Wed", 3: "Thu", 4: "Fri", 5: "Sat", 6: "Sun"}
    day_activity = {day: 0 for day in day_map.values()}
    hour_activity = {hour: 0 for hour in range(24)}
    heatmap_matrix = [[0 for _ in range(24)] for _ in range(7)]
    
    for w in watched_items:
        dt = w.watched_at.replace(tzinfo=timezone.utc)
        # Convert to local time offset if needed (here we keep UTC or default to row datetime)
        day_idx = dt.weekday()
        hour_val = dt.hour
        
        day_name = day_map.get(day_idx, "Mon")
        day_activity[day_name] += 1
        hour_activity[hour_val] += 1
        heatmap_matrix[day_idx][hour_val] += 1
        
    time_pattern = {
        "day_activity": [{"day": day, "count": count} for day, count in day_activity.items()],
        "hour_activity": [{"hour": hour, "count": count} for hour, count in hour_activity.items()],
        "heatmap": heatmap_matrix
    }

    # --- 4. Taste Evolution (Recent 30 Days vs Older) ---
    cutoff_30d = datetime.now(timezone.utc) - timedelta(days=30)
    
    recent_genres = defaultdict(float)
    older_genres = defaultdict(float)
    recent_total = 0
    older_total = 0
    
    for w in watched_items:
        m = w.movie
        if not m:
            continue
        dt = w.watched_at.replace(tzinfo=timezone.utc)
        
        for mg in m.genres:
            gname = mg.genre.name
            if dt >= cutoff_30d:
                recent_genres[gname] += 1.0
                recent_total += 1
            else:
                older_genres[gname] += 1.0
                older_total += 1
                
    recent_profile = {g: count / recent_total for g, count in recent_genres.items()} if recent_total > 0 else {}
    older_profile = {g: count / older_total for g, count in older_genres.items()} if older_total > 0 else {}
    
    evolution_list = []
    all_evolution_genres = set(recent_profile.keys()) | set(older_profile.keys())
    for g in all_evolution_genres:
        recent_val = round(recent_profile.get(g, 0.0), 3)
        older_val = round(older_profile.get(g, 0.0), 3)
        evolution_list.append({
            "genre": g,
            "recent": recent_val,
            "older": older_val,
            "shift": round(recent_val - older_val, 3)
        })
    evolution_list = sorted(evolution_list, key=lambda x: abs(x["shift"]), reverse=True)

    # --- 5. Click vs Watch Gap ---
    comparison = {}
    gap_insights = []
    for g in all_genres:
        w_score = watch_genre_profile.get(g, 0.0)
        c_score = click_profile.get(g, 0.0)
        gap = round(c_score - w_score, 3)
        
        if gap > 0.15:
            label = "exploration_interest"
            if w_score == 0:
                gap_insights.append(f"You explore {g} but have not watched any yet.")
        elif gap < -0.15:
            label = "confirmed_preference"
        else:
            label = "neutral"
            
        if w_score > 0.03 or c_score > 0.03:
            comparison[g] = {
                "watch": round(w_score, 3),
                "click": round(c_score, 3),
                "gap": gap,
                "label": label
            }
            
    exploration_genres = [g for g, v in comparison.items() if v["label"] == "exploration_interest"]
    if gap_insights:
        insight = gap_insights[0]
    elif exploration_genres:
        insight = f"You are shifting focus towards {', '.join(exploration_genres[:2])}."
    elif not comparison:
        insight = "Start exploring to build your insights."
    else:
        insight = "Your taste remains highly consistent."

    # --- 6. Popularity vs Taste (Mainstream vs Niche) ---
    avg_pop = sum(popularities) / len(popularities) if popularities else 0.0
    if avg_pop >= 50:
        popularity_style = "Mainstream"
    elif avg_pop >= 20:
        popularity_style = "Mixed"
    elif popularities:
        popularity_style = "Niche"
    else:
        popularity_style = "No Data"

    # --- 7. Content Type Behavior ---
    movie_ratings = [RATING_VALUES.get(r.category.lower(), 5.0) for r in user_ratings if r.movie and r.movie.type != "tv"]
    tv_ratings = [RATING_VALUES.get(r.category.lower(), 5.0) for r in user_ratings if r.movie and r.movie.type == "tv"]
    
    avg_movie_rating = round(sum(movie_ratings) / len(movie_ratings), 2) if movie_ratings else 0.0
    avg_tv_rating = round(sum(tv_ratings) / len(tv_ratings), 2) if tv_ratings else 0.0
    
    content_behavior = {
        "movie": {"count": movie_count, "avg_rating": avg_movie_rating},
        "tv": {"count": tv_count, "avg_rating": avg_tv_rating}
    }

    # --- 8. Rewatch Signal (Smart Feature) ---
    # High rating (category: perfection or go_for_it) + old watch (>30 days ago)
    rewatch_candidate_ids = {} # movie_id -> why label
    
    for r in user_ratings:
        if r.category.lower() in ("perfection", "go_for_it") and r.movie_id in watched_dict:
            watch_date = watched_dict[r.movie_id].replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - watch_date > timedelta(days=30):
                human_cat = "Perfection" if r.category.lower() == "perfection" else "Great"
                rewatch_candidate_ids[r.movie_id] = f"You rated this {human_cat}"
                
    # Also support clicked again after watching
    for c in all_clicks:
        if c.item_id in watched_dict and c.item_id not in rewatch_candidate_ids:
            watch_date = watched_dict[c.item_id].replace(tzinfo=timezone.utc)
            click_date = c.clicked_at.replace(tzinfo=timezone.utc)
            if click_date > watch_date + timedelta(hours=1):
                rewatch_candidate_ids[c.item_id] = "Highly clicked after watch"

    rewatch_candidates = []
    if rewatch_candidate_ids:
        stmt_cand = select(Movie).where(Movie.id.in_(rewatch_candidate_ids.keys())).limit(6)
        cands = list((await db.execute(stmt_cand)).scalars().all())
        for c in cands:
            rewatch_candidates.append({
                "id": c.id,
                "title": c.title,
                "media_type": c.type,
                "poster_path": c.poster_path,
                "why": rewatch_candidate_ids.get(c.id, "Rewatch candidate")
            })

    # --- 8.5 Early Favorites (All-Time Classics: rated high by user, high TMDB, watched >90 days ago) ---
    early_favorites_ids = {}
    high_rated_movies = [
        r for r in user_ratings 
        if r.category.lower() in ("perfection", "go_for_it") 
        and r.movie_id in watched_dict
    ]
    
    cutoff_90d = datetime.now(timezone.utc) - timedelta(days=90)
    old_high_rated = [
        r for r in high_rated_movies 
        if watched_dict[r.movie_id].replace(tzinfo=timezone.utc) < cutoff_90d
    ]
    
    if not old_high_rated and high_rated_movies:
        sorted_high_rated = sorted(high_rated_movies, key=lambda r: watched_dict[r.movie_id])
        half_idx = max(1, len(sorted_high_rated) // 2)
        old_high_rated = sorted_high_rated[:half_idx]
        
    for r in old_high_rated:
        if r.movie and r.movie.vote_average and r.movie.vote_average >= 7.0:
            early_favorites_ids[r.movie_id] = {
                "user": "Perfection" if r.category.lower() == "perfection" else "Great",
                "tmdb": r.movie.vote_average
            }
            
    early_favorites = []
    if early_favorites_ids:
        stmt_fav = select(Movie).where(Movie.id.in_(early_favorites_ids.keys())).limit(6)
        favs = list((await db.execute(stmt_fav)).scalars().all())
        for f in favs:
            info = early_favorites_ids[f.id]
            early_favorites.append({
                "id": f.id,
                "title": f.title,
                "media_type": f.type,
                "poster_path": f.poster_path,
                "why": f"You rated: {info['user']} • TMDB: ★{info['tmdb']:.1f}"
            })
        early_favorites = sorted(early_favorites, key=lambda x: x["id"])

    # --- 9. Discovery Depth Score ---
    # score = % low popularity content (<20) + genre diversity (len / 19) + click exploration ratio
    low_pop_ratio = len([p for p in popularities if p < 20]) / len(popularities) if popularities else 0.0
    genre_diversity = len(genre_count) / 19.0
    click_exploration_ratio = sum(max(0.0, click_profile.get(g, 0.0) - watch_genre_profile.get(g, 0.0)) for g in click_profile)
    
    raw_depth_score = (low_pop_ratio * 40.0) + (genre_diversity * 30.0) + (click_exploration_ratio * 30.0)
    discovery_depth_score = min(100, max(0, int(round(raw_depth_score * 100.0)))) if (watched_items or all_clicks) else 0

    # --- 10. Personal Tagging ---
    personal_tags = []
    if avg_rating >= 8.0:
        personal_tags.append("Strict Critic")
    elif avg_rating >= 6.0 and len(user_ratings) > 0:
        personal_tags.append("Generous Rater")
        
    top_genre_ratio = max(watch_genre_profile.values()) if watch_genre_profile else 0.0
    if top_genre_ratio > 0.40:
        personal_tags.append("Genre Loyalist")
        
    if len(click_profile) >= 5 or click_exploration_ratio > 0.4:
        personal_tags.append("Binge Explorer")
        
    if avg_pop > 50:
        personal_tags.append("Mainstream Watcher")
    elif avg_pop < 20 and popularities:
        personal_tags.append("Niche Connoisseur")
        
    if tv_count > movie_count:
        personal_tags.append("TV Binger")
    elif movie_count > tv_count:
        personal_tags.append("Cinephile")
        
    # Pick top 3 tags or default
    if not personal_tags:
        personal_tags = ["Balanced Explorer"]
    else:
        personal_tags = personal_tags[:3]

    # --- Summary ---
    top_genre = "N/A"
    if watch_genre_profile:
        top_genre = max(watch_genre_profile.items(), key=lambda x: x[1])[0]
        
    exploring = "N/A"
    if click_profile:
        exploring = max(click_profile.items(), key=lambda x: x[1])[0]
        
    summary = {
        "top_genre": top_genre,
        "exploring": exploring,
        "rating_style": style_label,
        "media_preference": "Movie-heavy" if movie_count > tv_count * 1.5 else ("TV-heavy" if tv_count > movie_count * 1.5 else "Balanced"),
        "discovery_type": popularity_style,
        "total_watched": len(watched_items),
        "total_rated": len(user_ratings)
    }

    return {
        "genre_distribution": genre_distribution,
        "rating_profile": rating_profile,
        "time_pattern": time_pattern,
        "evolution": evolution_list,
        "comparison": comparison,
        "insight": insight,
        "popularity_style": popularity_style,
        "avg_popularity": round(avg_pop, 2),
        "content_behavior": content_behavior,
        "rewatch_candidates": rewatch_candidates,
        "early_favorites": early_favorites,
        "discovery_depth_score": discovery_depth_score,
        "personal_tags": personal_tags,
        "summary": summary
    }
