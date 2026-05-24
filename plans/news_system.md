# News System — Movientum

## Overview

Movientum's news section surfaces movie-related articles, interviews, trailers, and entertainment news. Initially generic, becomes personalized based on user's movie preferences and watch history. Tightly integrated with recommendation system — same preference signals drive both movie recs and news personalization.

---

## Data Sources

### Primary: NewsAPI
- Free tier: 100 requests/day
- Searches news across 30,000+ sources
- Query by keyword: `"movies" OR "cinema" OR actor names`
- Filter by: language, date, source
- Returns: title, description, URL, image, published_at, source name

### Secondary: TMDB News
- TMDB has limited news/reviews data
- Use `/movie/{id}/reviews` for movie-specific review content
- Supplement, not primary

### Future: RSS Feeds
- Aggregate RSS from: Variety, Hollywood Reporter, IndieWire, Collider
- Parse XML feeds, store locally
- More control, less API dependency

---

## News Fetching Pipeline

### Global News (Not Personalized)

Cron job every 2 hours:
```
1. Call NewsAPI with broad query:
   q="movies OR cinema OR film OR Hollywood OR Netflix OR Disney"
   language=en
   sortBy=publishedAt
   pageSize=50

2. Filter articles:
   - Must have title, description, URL, image
   - Not duplicate (check URL hash)
   - Published within last 48 hours
   - Not clickbait (basic heuristic: avoid "you won't believe...")

3. Store in news table:
   {id, title, description, url, image_url, source, published_at, fetched_at}

4. Tag articles:
   - Extract movie titles mentioned (NLP or keyword matching)
   - Link article to movie IDs if mention found
   - Add genre tags based on content keywords
```

### Movie-Specific News

Triggered on-demand when user views Movie Detail Page:
```
GET /api/news/movie/{movie_id}
  │
  ├── Check if recent articles exist in DB for this movie
  │     ├── YES (fetched within 6 hours) → return from DB
  │     └── NO → fetch from NewsAPI:
  │             q="{movie_title}" OR "{director_name}"
  │             → Store results linked to movie_id
  │             → Return articles
```

---

## Database Schema for News

### `news_articles` table

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| title | TEXT | Article headline |
| description | TEXT | Article summary/excerpt |
| url | TEXT | Unique, original article link |
| image_url | TEXT | Thumbnail image |
| source_name | VARCHAR(100) | "Variety", "IGN", etc. |
| source_url | TEXT | Source domain |
| published_at | TIMESTAMPTZ | Original publish time |
| fetched_at | TIMESTAMPTZ | When we ingested it |
| genre_tags | TEXT[] | Inferred genres: ["action", "sci-fi"] |
| url_hash | VARCHAR(64) | SHA256 of URL for dedup check |

### `news_movie_links` table (junction)

| Column | Type | Notes |
|--------|------|-------|
| article_id | UUID | FK → news_articles |
| movie_id | INTEGER | FK → movies |

Allows one article to link to multiple movies mentioned.

---

## Personalization Logic

### How Articles Get Personalized

Personalization score for article A shown to user U:

```
score = (genre_overlap × 0.50)
      + (watched_movie_mention × 0.30)
      + (director_match × 0.15)
      + (recency_bonus × 0.05)
```

**genre_overlap**: Fraction of article's genre tags matching user's top genres
- User loves Action + Sci-Fi. Article tagged ["action", "thriller"] → high overlap

**watched_movie_mention**: Article mentions movie user has watched
- User watched Dune. Article covers Dune 3 announcement → high relevance

**director_match**: Article features director from user's affinity list
- User watched 3 Nolan films. Article about Nolan's next project → boosted

**recency_bonus**: Newer articles get slight boost
- Article from 1 hour ago > article from 2 days ago

### Cold Start (New User, No History)

No personalization data:
- Show globally popular articles (most viewed in last 24h)
- Show articles from trending movies (based on TMDB popularity)
- After first 3 movies rated/watched → start applying personalization

---

## News Feed Structure on Frontend

### Global News Feed (`/news` page or Home section)
- Three tabs:
  - **Latest** — sorted by published_at DESC
  - **For You** — personalized score sorted (logged in only)
  - **Trending** — most clicked articles (simple view counter)

### Home Page News Strip
- 4–5 horizontal card strip on Home page
- Mixed: 2 personalized + 2 recent global

### Movie Detail Page News
- 3–4 articles relevant to that specific movie
- Below main movie info section
- Click → opens article in new tab (external link)

---

## Article Deduplication

Same story covered by 10 different outlets. Show one.

Strategies:
1. **URL hash**: Exact duplicate detection
2. **Title similarity**: If title Jaccard similarity > 0.8 → group as duplicate, show highest-authority source
3. **Cluster by entity**: Articles mentioning same movie + published within 6 hours → potential duplicates, keep 1–2

Authority ranking for dedup resolution:
```
Tier 1: Variety, Hollywood Reporter, Deadline, IndieWire
Tier 2: IGN, Collider, Screen Rant
Tier 3: Other entertainment blogs
```

When duplicates found → show Tier 1 article, link to "Also covered by: X, Y, Z"

---

## Integration with Recommendation System

News and movie recommendations share preference signals:

**Shared input:**
- User's genre preferences
- User's watch history
- User's ratings

**Shared infrastructure:**
- Same user preference profile used for both
- Recommendation service exposes `user_preference_vector`
- News service consumes that vector for article scoring

When FedPCL model updates user's preference representation → news personalization automatically improves too. Both systems benefit from one privacy-preserving learning loop.

---

## Content Moderation (Basic)

Not a full moderation system, but basic safety:
- Only fetch from whitelisted reputable sources (curated list)
- Title keyword filter: block articles with flagged terms
- Manual admin override: admin can delete any article from the feed
- Report button (future): users report inappropriate articles

---

## API Rate Limit Management (NewsAPI)

Free tier: 100 requests/day.

Strategies:
1. Bulk fetch 50 articles per request (use pageSize=50 max)
2. Cache aggressively — 2-hour cron, not per-user-request
3. Movie-specific fetch only on cache miss (not every page view)
4. Store and reuse — articles in DB are reusable for days
5. Upgrade to paid plan as platform grows (1000+ req/day tier)

---

## Future Enhancements

- **NLP Article Tagging**: Use NLP model (spaCy or BERT-based) to extract movie titles, person names, genres from article text automatically
- **Sentiment Analysis**: Tag articles as positive/negative/neutral coverage
- **Video News**: Integrate YouTube trailers + featurettes as "news" items
- **Newsletter**: Weekly digest email with personalized news for each user
- **Push Notifications**: "New trailer for a movie in your watchlist" via browser push
- **Content Freshness**: Auto-expire articles older than 7 days from active feed (archive but don't delete)
