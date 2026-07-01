# Watchlist & Collections Feature

## Overview & Architecture

Movientum implements a robust, multi-collection watchlist system. Instead of a single binary "Watchlist" flag, users can create unlimited custom collections (e.g., "Sci-Fi Weekend", "Movies to watch with Mom") and add movies or TV shows to them.

This heavily customized approach is implemented in `watchlist.py` and the `watchlist_repo.py` repository.

---

## Logics & Business Rules

### Cross-Media Support
A single watchlist collection can contain a mix of Movies and TV Shows. The database schema handles this polymorphism gracefully using a `media_type` column (`'movie'` or `'tv'`).

### Cache Aggressiveness
Because checking if a movie is in a watchlist is required on almost every movie card render in the UI (to show the filled/unfilled bookmark icon), the `GET /api/v1/watchlists/movie/{media_type}/{movie_id}/status` endpoint must be lightning fast. 

Whenever a user adds or removes an item, the backend issues an aggressive `invalidate` command to Upstash Redis, busting BOTH the specific collection cache and the user's master collection list cache (`_bust_collection`).

---

## Code Structure & Detailed Logic

### Database Schema (`orm_models.py`)
```python
class WatchlistCollection(Base):
    __tablename__ = "watchlist_collections"
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    id = Column(Integer, primary_key=True)
    collection_id = Column(UUID(as_uuid=True), ForeignKey("watchlist_collections.id"))
    movie_id = Column(Integer, nullable=False) # Maps to either movies.id or tv_shows.id
    media_type = Column(String(20), nullable=False, default="movie")
```

### Endpoints (`watchlist.py`)
- `GET /api/v1/watchlists`: Lists all collections for the user.
- `POST /api/v1/watchlists`: Creates a new named collection.
- `GET /api/v1/watchlists/{collection_id}`: Retrieves a specific collection and its hydrated movie/tv items.
- `POST /api/v1/watchlists/{collection_id}/items`: Adds an item.
- `DELETE /api/v1/watchlists/{collection_id}/items/{media_type}/{id}`: Removes an item.

---

## Tables & Summaries

### Redis Keys for Watchlists

| Cache Key Pattern | Bust Trigger | TTL |
|---|---|---|
| `user:wlists:{user_id}` | On Create/Delete Collection | 300s (5m) |
| `user:wlcoll:{collection_id}` | On Add/Remove Item | 300s (5m) |

---

## Workflows & Lifecycles

### Add to Watchlist Flow
```mermaid
flowchart TD
    A[User clicks Bookmark on Movie Card] --> B[POST /items]
    B --> C[Insert row in watchlist_items]
    C --> D[Invalidate 'user:wlcoll:{collection_id}']
    D --> E[Invalidate 'user:wlists:{user_id}']
    E --> F[Return 201 Created]
    F --> G[React UI turns Bookmark Solid]
```
