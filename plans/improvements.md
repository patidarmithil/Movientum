# Improvements Plan — Movientum

---

# [DONE] Improvement A: Moctale-Style Predictive In-Place Search

**Status: IMPLEMENTED** — `SearchOverlay.jsx`, `/api/v1/search/instant`, `pg_trgm` migration all done.

---

---

# Improvement B: Continue Watching + Episode Notifications

## B.1 Overview

Two connected features:
1. **Continue Watching status** — new status option when user is mid-series (tracked in DB)
2. **Episode Notifications** — alert user on login if a tracked series dropped a new episode today

---

## B.2 DB Changes

### B.2.1 Add `watch_status` column to `watch_history`

Current `WatchHistory` ORM (`orm_models.py`):
- `user_id`, `movie_id`, `watched_at`, `watch_source`, `rewatched`

**New column:**
```python
watch_status = Column(String(30), nullable=True, default="watched")
# Values: "watched" | "continue_watching"
```

Alembic migration needed. Non-destructive (nullable with default).

### B.2.2 New table: `notifications`

```python
class Notification(Base):
    __tablename__ = "notifications"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tv_id = Column(Integer, nullable=False)               # TMDB show id
    message = Column(Text, nullable=False)                # e.g. "New episode: S2E4 - Title (Jun 13)"
    episode_air_date = Column(Date, nullable=True)        # the episode date
    season_number = Column(Integer, nullable=True)
    episode_number = Column(Integer, nullable=True)
    seen = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("idx_notif_user_id", "user_id"),
        Index("idx_notif_user_seen", "user_id", "seen"),
    )
```

---

## B.3 Backend — API Endpoints

### B.3.1 Update Watch Router (`app/routers/watch.py`)

**Extend `WatchMarkRequest` schema (`schemas/watch.py`):**
```python
class WatchMarkRequest(BaseModel):
    movie_id: int
    watch_source: Optional[str] = None
    rewatched: bool = False
    watch_status: Optional[str] = "watched"  # NEW FIELD: "watched" | "continue_watching"
```

**Extend watch_service upsert** to save `watch_status` field.

### B.3.2 New Router: `app/routers/notifications.py`

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `GET /api/v1/notifications` | GET | YES | Fetch unseen + recent notifications for user |
| `POST /api/v1/notifications/{id}/seen` | POST | YES | Mark single notification as seen |
| `POST /api/v1/notifications/mark_all_seen` | POST | YES | Mark all as seen |

**GET /notifications response shape:**
```json
{
  "unseen_count": 2,
  "notifications": [
    {
      "id": 1,
      "tv_id": 12345,
      "message": "Releasing Today: The Bear (New Episode)",
      "episode_air_date": "2026-06-13",
      "season_number": 4,
      "episode_number": 2,
      "poster_path": "/abc.jpg",
      "seen": false,
      "created_at": "2026-06-13T09:00:00Z"
    }
  ]
}
```

Cache key: `user:notifications:{user_id}` → TTL 5 min. Invalidate on mark_seen.

---

## B.4 Backend — Celery Daily Task

**File:** `app/tasks/check_episodes.py`

**Trigger:** Celery Beat schedule → runs daily at **8:00 AM UTC** (1:30 PM IST).

**Algorithm:**
```
1. Fetch all distinct tv_ids from watch_history WHERE watch_status = 'continue_watching'
2. Group by tv_id (to avoid N queries per user)
3. For each tv_id:
   a. Fetch TV detail from TMDB (or Redis cache) → get `next_episode_to_air`
   b. Check: next_episode_to_air.air_date == TODAY (UTC date)
   c. If YES:
       - Find all users who have this tv_id with status='continue_watching'
       - For each user: INSERT INTO notifications (user_id, tv_id, message, episode_air_date, ...)
         Skip if notification already exists for same (user_id, tv_id, episode_air_date)
4. Log: "Episode check complete: X shows checked, Y notifications created"
```

**Notification de-duplication guard:**
```python
# Before insert:
existing = await db.execute(
    select(Notification)
    .where(Notification.user_id == uid, Notification.tv_id == tv_id,
           Notification.episode_air_date == today)
)
if existing.scalar_one_or_none():
    continue  # already notified today for this show
```

**Why Celery not a lifespan task:**
- lifespan runs once per cold start (unpredictable on Azure)
- Celery Beat guarantees scheduled daily execution

---

## B.5 Frontend — Continue Watching Button

**File:** `MovieDetail.jsx` / `TVDetail.jsx`

**Current UI:** "Watched" button (single action).

**New UI for TV only:** Split dropdown button:
```
[✓ Watched ▾]
  └── Watched
  └── Continue Watching   ← NEW
```

On "Continue Watching" select:
- Call `watchService.markWatched({ movie_id, watch_status: "continue_watching" })`
- Button state updates → shows `[▶ Continue Watching]` label

State stored in local watch status from `GET /api/v1/watch/status/{id}`.

---

## B.6 Frontend — Notification Bell in Navbar

**File:** `Navbar.jsx`

**Bell icon position:** Right side of navbar, left of avatar icon.

**Badge:** Red dot/count badge for `unseen_count > 0`.

```jsx
// In Navbar:
const [notifOpen, setNotifOpen] = useState(false)
const [notifications, setNotifications] = useState([])
const [unseenCount, setUnseenCount] = useState(0)

useEffect(() => {
  if (!isLoggedIn) return
  notificationService.getNotifications()
    .then(data => {
      setNotifications(data.notifications || [])
      setUnseenCount(data.unseen_count || 0)
    })
}, [isLoggedIn])
```

**Dropdown panel (matches reference image):**
```
┌──────────────────────────────────┐
│ 🔔 Notifications         [🗑 Clear] │
├──────────────────────────────────┤
│ [All] [Updates] [Activity]       │
├──────────────────────────────────┤
│ Last 7 Days                      │
│ [Poster] Releasing Today: Severance (New Episode)  │
│          10th June                                  │
│ [Poster] Releasing Today: The Bear (New Episode)   │
│          13th June                                  │
├──────────────────────────────────┤
│ Last 30 Days                     │
│ ...                              │
└──────────────────────────────────┘
```

**Close:** click outside, or `Escape` key.

**On open:** call `POST /notifications/mark_all_seen` → clear badge count.

**New service:** `src/services/notificationService.js`

---

## B.7 Cache Keys (add to `cache.py`)

```python
def key_user_notifications(user_id: str) -> str:
    return f"user:notifications:{user_id}"
TTL_NOTIFICATIONS = 300   # 5 min
```

---

## B.8 File Change Summary

| File | Change |
|---|---|
| `orm_models.py` | Add `watch_status` to WatchHistory + new `Notification` table |
| `schemas/watch.py` | Add `watch_status` field to `WatchMarkRequest` |
| `services/watch_service.py` | Pass `watch_status` to upsert |
| `routers/watch.py` | Forward `watch_status` |
| `routers/notifications.py` | NEW — 3 endpoints |
| `tasks/check_episodes.py` | NEW — daily Celery task |
| `celery_app.py` | Register daily beat schedule |
| `cache.py` | Add `key_user_notifications`, `TTL_NOTIFICATIONS` |
| `main.py` | Register `/api/v1/notifications` router |
| `Navbar.jsx` | Add bell icon + notification panel |
| `TVDetail.jsx` | Add Continue Watching dropdown button |
| `notificationService.js` | NEW — API calls for notifications |

---

---

# Improvement C: YouTube Trailer Player

## C.1 Overview

Show a play button overlay on the movie/TV backdrop. Click → fullscreen YouTube embed modal with tabs for Trailer 1, Trailer 2, Teaser. TV shows also get a Season selector to browse per-season trailers.

---

## C.2 TMDB Video API

**Existing:** `tmdb.fetch_movie_videos(movie_id)` already exists but filters only Trailers.

**Problem with current filter:** Only returns type=`"Trailer"`. Teasers, clips are dropped.

**Fix — return all useful video types:**
```python
async def fetch_movie_videos(self, movie_id: int) -> Optional[list]:
    data = await self._get(f"/movie/{movie_id}/videos", params={"language": "en-US"})
    if not data:
        # Fallback: try without language param (gets all languages)
        data = await self._get(f"/movie/{movie_id}/videos")
    if not data:
        return []
    videos = data.get("results", [])
    ALLOWED_TYPES = {"Trailer", "Teaser", "Clip", "Featurette"}
    filtered = [
        v for v in videos
        if v.get("site") == "YouTube" and v.get("type") in ALLOWED_TYPES
    ]
    # Sort: official first, then by published_at desc
    filtered.sort(key=lambda v: (
        0 if v.get("official") else 1,
        v.get("published_at", "") 
    ), reverse=False)
    # Also try fetching without language restriction if result empty
    return filtered
```

**New method for TV:**
```python
async def fetch_tv_videos(self, tv_id: int) -> Optional[list]:
    data = await self._get(f"/tv/{tv_id}/videos", params={"language": "en-US"})
    if not data:
        data = await self._get(f"/tv/{tv_id}/videos")
    ...same filter logic...

async def fetch_tv_season_videos(self, tv_id: int, season_number: int) -> Optional[list]:
    data = await self._get(f"/tv/{tv_id}/season/{season_number}/videos", params={"language": "en-US"})
    ...same filter logic...
```

**Why trailers sometimes fail to open:**
- TMDB has outdated YouTube keys (videos removed from YouTube)
- Some entries exist in TMDB but have wrong keys
- Language param restricts results (e.g., only Hindi dub found, not original)
- **Fix:** Always try `language=en-US` first, fallback to no language param, return multiple options so user can try alternatives

---

## C.3 Backend — New Endpoints

### C.3.1 Movie Videos

**Add to `movies.py`:** (must come before `/{movie_id}` route)

```python
@router.get("/{movie_id}/videos", summary="Movie trailers and teasers")
async def get_movie_videos(movie_id: int):
    cache_key = f"tmdb:videos:movie:{movie_id}"
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached

    videos = await tmdb.fetch_movie_videos(movie_id)
    videos = videos or []

    # Classify into types
    result = _classify_videos(videos)
    await set_cached(cache_key, result, 86400)   # 24h cache
    return result
```

**`_classify_videos()` helper:**
```python
def _classify_videos(videos: list) -> dict:
    trailers = [v for v in videos if v.get("type") == "Trailer"]
    teasers  = [v for v in videos if v.get("type") == "Teaser"]
    clips    = [v for v in videos if v.get("type") in ("Clip", "Featurette")]
    return {
        "trailers": [_video_shape(v) for v in trailers[:3]],
        "teasers":  [_video_shape(v) for v in teasers[:2]],
        "clips":    [_video_shape(v) for v in clips[:3]],
    }

def _video_shape(v: dict) -> dict:
    return {
        "key":          v["key"],           # YouTube video ID
        "name":         v.get("name", ""),
        "type":         v.get("type", ""),
        "official":     v.get("official", False),
        "published_at": v.get("published_at"),
        "youtube_url":  f"https://www.youtube.com/embed/{v['key']}?autoplay=1&rel=0",
    }
```

### C.3.2 TV Videos (show-level + per-season)

**Add to `tv.py`:**

```python
@router.get("/{tv_id}/videos", summary="TV show trailers + per-season")
async def get_tv_videos(tv_id: int):
    cache_key = f"tmdb:videos:tv:{tv_id}"
    cached = await get_cached(cache_key)
    if cached is not None:
        return cached

    # 1. Fetch show-level videos
    show_videos = await tmdb.fetch_tv_videos(tv_id) or []

    # 2. Fetch TV detail to get list of seasons (use existing Redis cache)
    tv_detail = await get_cached(key_tv_detail(tv_id))
    seasons = []
    if tv_detail:
        for s in tv_detail.get("seasons", []):
            sn = s.get("season_number", 0)
            if sn == 0:  # skip "Specials" season 0
                continue
            seasons.append({
                "season_number": sn,
                "name": s.get("name", f"Season {sn}"),
                "episode_count": s.get("episode_count", 0),
            })

    # 3. Fetch season videos in parallel (max 5 seasons to avoid TMDB overload)
    season_video_tasks = [
        tmdb.fetch_tv_season_videos(tv_id, s["season_number"])
        for s in seasons[:5]
    ]
    season_results = await asyncio.gather(*season_video_tasks, return_exceptions=True)

    season_videos = {}
    for i, s in enumerate(seasons[:5]):
        raw = season_results[i]
        if isinstance(raw, list):
            season_videos[s["season_number"]] = _classify_videos(raw)
        else:
            season_videos[s["season_number"]] = {"trailers": [], "teasers": [], "clips": []}

    result = {
        "show_videos": _classify_videos(show_videos),
        "seasons": seasons,
        "season_videos": season_videos,
    }
    await set_cached(cache_key, result, 86400)
    return result
```

---

## C.4 Frontend — Movie Trailer UI

**File:** `MovieDetail.jsx` + new `TrailerModal.jsx` component

### C.4.1 Play Button Overlay on Backdrop

Existing backdrop image gets a play button overlay:
```jsx
// Inside the backdrop container:
<div className="backdrop-wrapper">
  <img src={backdropUrl} ... />
  {hasTrailer && (
    <button className="trailer-play-btn" onClick={() => setTrailerOpen(true)}>
      <svg>/* play triangle */</svg>
    </button>
  )}
</div>
```

`.trailer-play-btn`:
```css
.trailer-play-btn {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 72px; height: 72px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  backdrop-filter: blur(8px);
  border: 2px solid rgba(255,255,255,0.5);
  cursor: pointer;
  transition: transform 0.2s, background 0.2s;
}
.trailer-play-btn:hover {
  transform: translate(-50%, -50%) scale(1.08);
  background: rgba(255,255,255,0.25);
}
```

### C.4.2 TrailerModal Component

**File:** `src/components/TrailerModal.jsx`

```jsx
// Props: videos (classified), isOpen, onClose, mediaType, tvSeasons, tvSeasonVideos

// Layout (matches reference image 3):
// - Full viewport overlay, dark backdrop
// - YouTube iframe (16:9, centered, responsive)
// - Bottom tab bar: [Teaser] [Trailer 1] [Trailer 2] [Trailer 3]
// - For TV: also [Season 1] [Season 2] ... tabs above the video tabs
// - Top-right X button
// - Keyboard: Escape closes

function TrailerModal({ videos, isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState(null)
  const [activeSeasonNum, setActiveSeasonNum] = useState(null)  // TV only

  // Build tab list from classified videos
  const tabs = [
    ...videos.teasers.map((v, i) => ({ label: `Teaser${i > 0 ? ` ${i+1}` : ""}`, video: v })),
    ...videos.trailers.map((v, i) => ({ label: `Trailer${i > 0 ? ` ${i+1}` : ""}`, video: v })),
  ]

  useEffect(() => {
    if (tabs.length > 0 && !activeTab) setActiveTab(tabs[0])
  }, [tabs])

  // YouTube iframe embed (not IFrame API — simpler, no JS SDK needed)
  const embedUrl = activeTab?.video?.youtube_url  // has autoplay=1&rel=0
}
```

**YouTube embed approach:**
```jsx
<iframe
  key={activeTab?.video?.key}   // force re-mount on tab switch → autoplay
  src={embedUrl}
  allow="autoplay; fullscreen"
  allowFullScreen
  frameBorder="0"
/>
```

**Why `key` on iframe:** React reuses DOM nodes. New `key` forces unmount+remount → YouTube reloads and autoplays the new video.

### C.4.3 TV Season Selector

For `TVDetail.jsx`, TrailerModal gets extra prop `mode="tv"`:
```jsx
{/* Season tab row (above video tabs) */}
<div className="season-tabs">
  <button onClick={() => setActiveSeasonNum(null)}>Show Trailers</button>
  {tvSeasons.map(s => (
    <button
      key={s.season_number}
      onClick={() => setActiveSeasonNum(s.season_number)}
      disabled={!tvSeasonVideos[s.season_number]?.trailers?.length &&
                !tvSeasonVideos[s.season_number]?.teasers?.length}
    >
      {s.name}
    </button>
  ))}
</div>
```

Active videos come from:
```js
const currentVideos = activeSeasonNum 
  ? tvSeasonVideos[activeSeasonNum] 
  : showVideos
```

---

## C.5 Data Fetch in Components

```js
// In MovieDetail.jsx useEffect:
const [videos, setVideos] = useState(null)

useEffect(() => {
  api.get(`/api/v1/movies/${id}/videos`)
    .then(r => setVideos(r.data))
    .catch(() => setVideos({ trailers: [], teasers: [], clips: [] }))
}, [id])

const hasTrailer = videos && (videos.trailers.length > 0 || videos.teasers.length > 0)
```

---

## C.6 File Change Summary

| File | Change |
|---|---|
| `services/tmdb_service.py` | Fix `fetch_movie_videos` + add `fetch_tv_videos`, `fetch_tv_season_videos` |
| `routers/movies.py` | Add `GET /{movie_id}/videos` route (before `/{movie_id}`) |
| `routers/tv.py` | Add `GET /{tv_id}/videos` route |
| `cache.py` | Cache key `tmdb:videos:movie:{id}`, `tmdb:videos:tv:{id}` |
| `MovieDetail.jsx` | Add backdrop play button + fetch videos + open modal |
| `TVDetail.jsx` | Add backdrop play button + fetch tv videos (seasons) + open modal |
| `TrailerModal.jsx` | NEW — fullscreen YouTube embed modal |
| `TrailerModal.css` | NEW — modal styles |
| `movieService.js` | Add `getMovieVideos(id)` |

---

---

# Improvement D: Explore Page Filter UI Redesign

## D.1 Overview

Current Explore page has basic filter inputs. Target: Moctale-style horizontal chip/pill filter bar with styled custom dropdowns. No backend changes needed — all filter params already supported by `/api/v1/movies/explore`.

---

## D.2 Current State

`Explore.jsx` already passes to backend: `genres`, `min_rating`, `year_from`, `year_to`, `sort`, `type`, `companies`, `countries`, `providers`.

Backend supports all. Only the frontend UI needs redesign.

---

## D.3 New Filter Bar Design

### D.3.1 Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ CATEGORY                                                         │
│ Adventure         ← (optional hero title if single genre)       │
├─────────────────────────────────────────────────────────────────┤
│ [All] [Movies] [Series] [Anime]  [Genre ▾] [Sort: Newest ▾] [Year ▾] [Rating ▾] │
├─────────────────────────────────────────────────────────────────┤
│ Active filters: Action ✕  2020-2026 ✕                           │
├─────────────────────────────────────────────────────────────────┤
│ [Card] [Card] [Card] [Card] [Card] ...                          │
│ [Load More]                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### D.3.2 Type Pills

```jsx
const TYPE_OPTIONS = [
  { label: "All",    value: null },
  { label: "Movies", value: "movie" },
  { label: "Series", value: "tv" },
  { label: "Anime",  value: "anime" },
]

<div className="filter-pills">
  {TYPE_OPTIONS.map(opt => (
    <button
      key={opt.label}
      className={`filter-pill ${type === opt.value ? "active" : ""}`}
      onClick={() => setType(opt.value)}
    >
      {opt.label}
    </button>
  ))}
</div>
```

### D.3.3 Genre Multi-Select Dropdown

**Component:** `FilterDropdown.jsx` (reusable)

```
[Genre ▾]  ← click to open

┌─────────────────┐
│ ☐ Action        │
│ ☐ Adventure     │
│ ☑ Drama         │   ← checked = selected
│ ☐ Horror        │
│ ☐ Romance       │
│ ...             │
└─────────────────┘
```

- Multi-select (checkboxes)
- Close on outside click
- Shows selected count in button: `[Genre (2) ▾]`
- On submit → genres string joined: `"Drama,Horror"`

### D.3.4 Sort Dropdown (Single-select)

```
[Sort: Newest ▾]

┌────────────────────┐
│ ● Newest           │  ← radio select
│ ○ Most Popular     │
│ ○ Highest Rated    │
│ ○ Alphabetical     │
└────────────────────┘
```

Sort map (frontend label → backend param):
| Label | Backend value |
|---|---|
| Newest | `release_date` |
| Most Popular | `popularity` |
| Highest Rated | `rating` |
| Alphabetical | `title` |

### D.3.5 Year Range Dropdown

```
[Year ▾]

┌─────────────────────────┐
│ From: [____] To: [____] │
│ [1990] [2000] [2010]    │ ← quick year presets
│ [2015] [2020] [2024]    │
│       [Apply]            │
└─────────────────────────┘
```

- Two numeric inputs (year_from, year_to)
- Preset chips for common decades
- Apply button to trigger filter

### D.3.6 Rating Filter Dropdown

```
[Rating ▾]

┌──────────────────────────┐
│ Min Rating: 7.0           │
│ ●───────────────○        │  ← range slider
│ 0               10       │
└──────────────────────────┘
```

Slider value → `min_rating` param.

---

## D.4 Active Filter Badges

Below filter bar, show active filters as dismissible pills:

```jsx
const activeFilters = []
if (selectedGenres.length) activeFilters.push({ label: selectedGenres.join(", "), clear: () => setSelectedGenres([]) })
if (yearFrom || yearTo) activeFilters.push({ label: `${yearFrom || "Any"}–${yearTo || "Any"}`, clear: () => { setYearFrom(null); setYearTo(null) } })
if (minRating > 0) activeFilters.push({ label: `Rating ≥ ${minRating}`, clear: () => setMinRating(0) })

// Render
{activeFilters.map(f => (
  <span className="active-filter-badge">
    {f.label} <button onClick={f.clear}>✕</button>
  </span>
))}
```

---

## D.5 State Debounce & API Calls

```jsx
// Debounce filter changes to avoid burst API calls:
useEffect(() => {
  const timer = setTimeout(() => {
    fetchExploreData()  // calls /api/v1/movies/explore with current filters
  }, 400)
  return () => clearTimeout(timer)
}, [type, selectedGenres, sort, yearFrom, yearTo, minRating, page])
```

---

## D.6 CSS Approach

**FilterDropdown.css:**
```css
.filter-dropdown {
  position: relative;
  display: inline-block;
}
.filter-dropdown-trigger {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px;
  border-radius: 20px;
  background: var(--surface-card);
  border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);
  transition: background 0.15s, border-color 0.15s;
}
.filter-dropdown-trigger:hover,
.filter-dropdown-trigger.open {
  background: rgba(255,255,255,0.08);
  border-color: rgba(255,255,255,0.25);
}
.filter-dropdown-panel {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 200px;
  background: rgba(15, 15, 25, 0.97);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  padding: 12px;
  z-index: 500;
  animation: dropdownReveal 0.15s ease-out;
}
@keyframes dropdownReveal {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.filter-pill {
  padding: 7px 16px;
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,0.12);
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.filter-pill.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: #fff;
}
.active-filter-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px;
  border-radius: 12px;
  background: rgba(var(--accent-primary-rgb), 0.2);
  border: 1px solid rgba(var(--accent-primary-rgb), 0.4);
  font-size: 12px;
  color: var(--accent-primary);
}
```

---

## D.7 File Change Summary

| File | Change |
|---|---|
| `Explore.jsx` | Full UI redesign — filter state management, debounce, grid layout |
| `Explore.css` | Full redesign for new layout |
| `FilterDropdown.jsx` | NEW — reusable dropdown component |
| `FilterDropdown.css` | NEW — dropdown styles |

No backend changes required.

---

---

# Improvement E: URL Params for Explore Page (Minor)

Sync filter state to URL query params so users can share/bookmark filtered views.

```js
// On filter change → update URL:
const params = new URLSearchParams()
if (type) params.set("type", type)
if (selectedGenres.length) params.set("genres", selectedGenres.join(","))
if (sort !== "popularity") params.set("sort", sort)
if (yearFrom) params.set("year_from", yearFrom)
if (yearTo) params.set("year_to", yearTo)
if (minRating > 0) params.set("min_rating", minRating)
navigate(`/explore?${params.toString()}`, { replace: true })

// On mount → read URL and initialize filters:
const searchParams = new URLSearchParams(location.search)
// set initial state from params
```

Uses React Router `useNavigate` + `useLocation`. Zero backend change.

---

---

# Improvement F: Admin Analytics Portal

## F.1 Overview

Admin-only portal showing site-wide user traffic, behavior aggregates, and platform health — all in one dashboard. Separate from the per-user `Analysis.jsx` page (that's personal stats). This is **global admin view**.

---

## F.2 Technology Choice

### Option 1: Custom-built (recommended for our stack)
- Route: `/admin` (protected, role=`admin` check)
- Backend: new `app/routers/admin.py` + `app/services/admin_service.py`
- Frontend: `src/pages/AdminPortal.jsx` + charts via **Recharts** (already likely in use by `Analysis.jsx`)
- Data: aggregated from our existing PostgreSQL tables (users, click_history, watch_history, ratings, requested_content)
- **Pros:** zero extra infra, works with existing Supabase DB, admin only sees own data
- **Cons:** must write all queries manually

### Option 2: Plausible / Umami (lightweight open-source analytics)
- Self-hosted or cloud, free tier available
- Embed analytics script in frontend → auto-collects page views, sessions, geography, referrers
- Gives pre-built dashboards without coding
- **Pros:** turnkey, beautiful dashboards, real traffic tracking (not just DB events)
- **Cons:** another service to manage, Vercel + Azure means cross-origin setup, GDPR considerations

### Option 3: Posthog (product analytics)
- Add JS SDK in `main.jsx` → auto-captures clicks, page views, user sessions
- Admin dashboard on Posthog cloud (free up to 1M events/month)
- Funnel analysis, session recording, feature flags
- **Pros:** very powerful, no backend work, great free tier
- **Cons:** sends data to third party (privacy), requires posthog account

### ✅ Recommended: Custom-built (Option 1) for sensitive data + Posthog (Option 3) for real traffic

Rationale: Our existing tables have rich behavioral data (clicks, watch history, ratings). Custom queries give precise domain-specific insights. Posthog handles the raw web traffic layer (page views, sessions, geography) without any backend work.

---

## F.3 Admin Auth Guard

Existing `User.role` column already has `"user" | "admin"`.

**Backend guard:**
```python
# In deps.py — new dependency
async def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
```

**Frontend guard:** `ProtectedRoute` extended to accept `requireAdmin` prop:
```jsx
<Route path="/admin" element={
  <ProtectedRoute requireAdmin>
    <AdminPortal />
  </ProtectedRoute>
} />
```

---

## F.4 Backend — New Endpoints

### New router: `app/routers/admin.py` prefix `/api/v1/admin`

| Endpoint | What it returns |
|---|---|
| `GET /overview` | Total users, total movies in DB, total ratings, total clicks, today's active users |
| `GET /traffic` | Daily active users last 30 days (from click_history + watch_history aggregated by date) |
| `GET /top_content` | Top 10 most clicked + watched items (movie/tv) all time |
| `GET /rating_distribution` | Global perfection/go_for_it/timepass/skip breakdown across all users |
| `GET /genre_heatmap` | Genre popularity across all users (aggregated from click_history, watch_history) |
| `GET /users` | Paginated user list: id, email, username, created_at, total_watched, total_rated, last_active |
| `GET /requested_content` | All entries from `requested_content` table (user content requests) |
| `GET /growth` | User signups grouped by week/month |

All endpoints require `require_admin` dependency. Cache TTL: 5 minutes per endpoint.

---

## F.5 Key Queries (admin_service.py)

### Daily Active Users (traffic)
```python
# DAU: distinct users with any click OR watch in a day
SELECT DATE(clicked_at AT TIME ZONE 'UTC') as day, COUNT(DISTINCT user_id) as dau
FROM click_history
WHERE clicked_at >= NOW() - INTERVAL '30 days'
GROUP BY day ORDER BY day
```

### Top Clicked Content
```python
SELECT item_id, media_type, COUNT(*) as clicks
FROM click_history
GROUP BY item_id, media_type
ORDER BY clicks DESC LIMIT 10
```
Then enrich with movie title/poster from `movies` table.

### Global Rating Distribution
```python
SELECT category, COUNT(*) as count
FROM ratings
GROUP BY category
```

### User Growth
```python
SELECT DATE_TRUNC('week', created_at) as week, COUNT(*) as signups
FROM users
GROUP BY week ORDER BY week
```

---

## F.6 Frontend — AdminPortal.jsx Layout

```
┌──────────────────────────────────────────────────────────┐
│ 👤 Admin Portal           [Last updated: 2 min ago]      │
├────────────┬────────────┬────────────┬───────────────────┤
│ Total Users│ Total Movies│ Total Clicks│ Today's Active   │
│   2,341    │   5,820     │  148,302   │       47          │
├────────────┴────────────┴────────────┴───────────────────┤
│ [DAU Chart — 30 days line graph]                         │
├────────────────────────┬─────────────────────────────────┤
│ Genre Heatmap          │ Rating Distribution (pie chart) │
├────────────────────────┴─────────────────────────────────┤
│ Top 10 Most Clicked Content (ranked cards)               │
├──────────────────────────────────────────────────────────┤
│ Content Requests (table: title, type, requested_at)      │
├──────────────────────────────────────────────────────────┤
│ Users Table (paginated: email, joined, watched, rated)   │
└──────────────────────────────────────────────────────────┘
```

Charts via **Recharts** (same library as `Analysis.jsx`):
- DAU trend: `LineChart`
- Rating distribution: `PieChart`
- Genre heatmap: `BarChart`
- User growth: `AreaChart`

---

## F.7 Posthog Integration (optional layer)

Add to `frontend/src/main.jsx`:
```js
import posthog from 'posthog-js'
posthog.init('<POSTHOG_PROJECT_KEY>', {
  api_host: 'https://app.posthog.com',
  person_profiles: 'identified_only',  // GDPR-conscious
})
```

Identify user on login:
```js
// In AuthContext.jsx on login success:
posthog.identify(user.id, { email: user.email, username: user.username })
```

This gives free real-time traffic dashboard on Posthog cloud — page views, user sessions, device breakdown, geography — without writing any backend code.

---

## F.8 File Change Summary

| File | Change |
|---|---|
| `app/utils/deps.py` | Add `require_admin` dependency |
| `app/routers/admin.py` | NEW — 8 admin endpoints |
| `app/services/admin_service.py` | NEW — all aggregate SQL queries |
| `app/main.py` | Register `/api/v1/admin` router |
| `src/pages/AdminPortal.jsx` | NEW — admin dashboard page |
| `src/pages/AdminPortal.css` | NEW — styles |
| `src/services/adminService.js` | NEW — API calls to admin endpoints |
| `src/components/ProtectedRoute.jsx` | Add `requireAdmin` role check |
| `src/App.jsx` | Add `/admin` route |
| `src/main.jsx` | Optionally add Posthog init |
| `.env` (frontend) | `VITE_POSTHOG_KEY` (optional) |

---

---

# Improvement G: Moctale Rating on Movie Cards (Priority over TMDB rating)

## G.1 Problem

`MovieCard.jsx` currently shows TMDB `vote_average` (numeric 0–10 with ★).
We now have 2–3k movies/shows with scraped moctale ratings in `movie_ratings` / `tv_ratings` tables (columns: `perfection`, `go_for_it`, `timepass`, `skip` as float percentages, plus `score` and `total_votes`).

The goal: MovieCard.jsx shows our logo badge (colored label + %) if mr.total_votes > 10, else falls back to TMDB ★.

---

## G.2 Data Structure in DB

```
movie_ratings / tv_ratings table:
  id          → TMDB movie/tv id (FK → movies.id)
  score       → 0–100 integer (moctale aggregate score)
  total_votes → int
  perfection  → float (e.g. 0.23 = 23%)
  go_for_it   → float (e.g. 0.41 = 41%)
  timepass    → float (e.g. 0.27 = 27%)
  skip        → float (e.g. 0.09 = 9%)
```

Dominant category = argmax of the four floats.

---

## G.3 Category → Color Map

| Category | Color | Label on card |
|---|---|---|
| `perfection` | `#A855F7` (purple) | ★ PERFECTION |
| `go_for_it` | `#22C55E` (green) | ✓ GO FOR IT |
| `timepass` | `#EAB308` (yellow) | ~ TIMEPASS |
| `skip` | `#EF4444` (red) | ✗ SKIP |

Percentage shown = the dominant category's float × 100.

Example card badge: `✓ GO FOR IT · 41%` in green.

---

## G.4 Solution Architecture

### G.4.1 Where moctale data already flows

Movie detail endpoint (`GET /api/v1/movies/{id}`) already fetches and attaches `moctale_rating` dict to the response. But the **list endpoints** (trending, top_rated, explore, genre rows) return simplified list items without moctale data — they hit TMDB directly and do NOT query `movie_ratings`.

**Problem:** List endpoints return 20–30 items each. Doing N individual SQL lookups per item = expensive. Need a bulk approach.

### G.4.2 Solution: Embed moctale data into list item responses via bulk lookup

**Strategy:** After fetching TMDB list (e.g. trending), collect all item IDs, do ONE bulk SQL query against `movie_ratings` + `tv_ratings`, build a lookup dict, then attach moctale data to each formatted item.

```python
# In movies.py helper:
async def _bulk_fetch_moctale(db: AsyncSession, item_ids: list[int], media_types: list[str]) -> dict:
    """Returns dict: {movie_id: {dominant_category, dominant_pct, score, total_votes}}"""
    from app.db.orm_models import MovieRating, TvRating

    movie_ids = [item_ids[i] for i, mt in enumerate(media_types) if mt != "tv"]
    tv_ids    = [item_ids[i] for i, mt in enumerate(media_types) if mt == "tv"]

    result = {}

    if movie_ids:
        rows = await db.execute(
            select(MovieRating).where(MovieRating.id.in_(movie_ids))
        )
        for r in rows.scalars().all():
            result[r.id] = _compute_dominant(r)

    if tv_ids:
        rows = await db.execute(
            select(TvRating).where(TvRating.id.in_(tv_ids))
        )
        for r in rows.scalars().all():
            result[r.id] = _compute_dominant(r)

    return result

def _compute_dominant(r) -> dict:
    cats = {
        "perfection": r.perfection or 0.0,
        "go_for_it":  r.go_for_it  or 0.0,
        "timepass":   r.timepass   or 0.0,
        "skip":       r.skip       or 0.0,
    }
    dominant = max(cats, key=cats.get)
    return {
        "dominant_category": dominant,
        "dominant_pct": round(cats[dominant] * 100, 1),
        "score": r.score,
        "total_votes": r.total_votes,
    }
```

### G.4.3 Attach to list formatter

In each list endpoint after formatting:
```python
# Collect ids and types
item_ids   = [item["id"] for item in formatted]
item_types = [item.get("media_type", "movie") for item in formatted]

# One bulk query
moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)

# Attach
for item in formatted:
    item["moctale_rating"] = moctale_map.get(item["id"])
```

**Affected endpoints:**
- `GET /trending` → after `formatted = [_tmdb_to_search_result(...)]`
- `GET /top_rated`
- `GET /genre/{id}`
- `GET /explore`
- `GET /upcoming`

TV detail endpoint already attaches moctale_rating individually — no change needed.

### G.4.4 Cache consideration

These endpoints are already cached. The moctale data is stable (scraped once, rarely changes). Including it in the cached payload is fine — it adds ~50 bytes per item but avoids repeated DB queries.

**Important:** Existing cached entries won't have `moctale_rating`. They'll have `null` until cache expires. TTL on trending is 5 hours, explore 10 min. No forced invalidation needed — stale cache serves old data, fresh hits get moctale data. Acceptable.

---

## G.5 Frontend — MovieCard.jsx Changes

**New prop: `moctale_rating`** passed through from parent.

```jsx
const MOCTALE_COLORS = {
  perfection: '#A855F7',
  go_for_it:  '#22C55E',
  timepass:   '#EAB308',
  skip:       '#EF4444',
}
const MOCTALE_LABELS = {
  perfection: '★ PERFECTION',
  go_for_it:  '✓ GO FOR IT',
  timepass:   '~ TIMEPASS',
  skip:       '✗ SKIP',
}

export default function MovieCard({ movie, variant = 'standard' }) {
  const mr = movie.moctale_rating  // { dominant_category, dominant_pct, score, total_votes }

  // Show our logo badge if available and total_votes > 10, else TMDB rating
  const hasMoctale = mr && mr.dominant_category && mr.total_votes > 10

  return (
    <BorderGlow ...>
      <div className="movie-card__poster-wrap">
        ...

        {/* Rating badge — Our logo badge preferred over TMDB */}
        {hasMoctale ? (
          <div
            className="movie-card__rating movie-card__rating--moctale"
            style={{ color: MOCTALE_COLORS[mr.dominant_category] }}
          >
            {MOCTALE_LABELS[mr.dominant_category]}
            <span className="movie-card__rating-pct">{mr.dominant_pct}%</span>
          </div>
        ) : movie.vote_average > 0 ? (
          <div className="movie-card__rating" style={{ color: ratingColor }}>
            ★ {movie.vote_average.toFixed(1)}
          </div>
        ) : null}
      </div>
      ...
    </BorderGlow>
  )
}
```

**CSS for moctale badge:**
```css
.movie-card__rating--moctale {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.movie-card__rating-pct {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0;
}
```

---

## G.6 Explore & Top Rated Sort by Moctale Score

Bonus: allow explore page to sort by moctale score when available.

```python
# In explore endpoint, if sort == "moctale":
# Can only sort items that HAVE moctale scores.
# After moctale_map lookup:
formatted.sort(
    key=lambda x: x.get("moctale_rating", {}).get("score") or 0,
    reverse=True
)
```

Frontend: add `"Moctale Score"` option to sort dropdown in `Explore.jsx`.

---

## G.7 File Change Summary

| File | Change |
|---|---|
| `routers/movies.py` | Add `_bulk_fetch_moctale()` + `_compute_dominant()` helpers; call in trending, top_rated, genre, explore, upcoming endpoints |
| `routers/tv.py` | Already handles moctale per-detail — no list endpoint changes needed |
| `components/MovieCard.jsx` | Add our logo rating badge logic (priority over TMDB when total_votes > 10) |
| `components/MovieCard.css` | Add logo badge styles |
| `pages/Explore.jsx` | Add "Moctale Score" sort option |

No schema migration needed — tables already exist.

---

---

# Improvement H: Help / Feature Guide Page

## H.1 Overview

Static informational page at `/help` explaining all Movientum features. No auth required. Contains:
- Platform overview
- Feature cards (each section = one feature)
- Image placeholders (user will fill manually)
- "What you get with an account" section
- Step-by-step tutorial for key flows

---

## H.2 Route & File

| | |
|---|---|
| Route | `/help` |
| File | `src/pages/Help.jsx` |
| CSS | `src/pages/Help.css` |
| Auth required | No |
| Navbar link | "Help" or `?` icon in navbar |

---

## H.3 Page Structure

```
┌──────────────────────────────────────────────────────┐
│ [Hero] Movientum — Your Movie & TV Universe          │
│ A complete guide to everything you can do here.      │
├──────────────────────────────────────────────────────┤
│ 🏠 What is Movientum?                                │
│ [IMAGE PLACEHOLDER]                                   │
│ Text: discover, rate, track, get recs...              │
├──────────────────────────────────────────────────────┤
│ 🔍 Searching (Predictive Search)                     │
│ [IMAGE PLACEHOLDER]                                   │
│ How to use the search overlay                         │
├──────────────────────────────────────────────────────┤
│ 🎬 Movie & TV Detail Pages                            │
│ [IMAGE PLACEHOLDER]                                   │
│ Trailers, ratings, cast, similar, requests            │
├──────────────────────────────────────────────────────┤
│ ⭐ Rating System                                     │
│ [IMAGE PLACEHOLDER]                                   │
│ Explain Skip / Timepass / Go For It / Perfection      │
├──────────────────────────────────────────────────────┤
│ 🔎 Explore & Filters                                 │
│ [IMAGE PLACEHOLDER]                                   │
│ How to use genre, year, type filters                  │
├──────────────────────────────────────────────────────┤
│ 📰 Movie News                                        │
│ [IMAGE PLACEHOLDER]                                   │
│ Personalized news feed based on your taste            │
├──────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐  │
│ │ 👤 LOGIN TO UNLOCK                               │  │
│ │ ✓ Watch History    ✓ Watchlist                  │  │
│ │ ✓ Your Ratings     ✓ Personalized Recs          │  │
│ │ ✓ Episode Notifs   ✓ Continue Watching          │  │
│ │ ✓ Your Analytics   ✓ Personalized News          │  │
│ │          [Create Free Account →]                 │  │
│ └─────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────┤
│ 📖 Tutorial: How to Rate a Movie                     │
│ Step 1 → Step 2 → Step 3 (numbered flow)             │
├──────────────────────────────────────────────────────┤
│ 📖 Tutorial: How to Use Continue Watching             │
├──────────────────────────────────────────────────────┤
│ FAQ (accordion)                                       │
│ Q: Is this free? Q: How are ratings calculated? ...  │
└──────────────────────────────────────────────────────┘
```

---

## H.4 Feature Cards Content

### Features (all users)
| Feature | Description |
|---|---|
| Predictive Search | Start typing anywhere → instant results without leaving the page. Typo-tolerant. |
| Explore & Filter | Browse by genre, type (Movies/TV/Anime), year range, rating, sort order. |
| Movie & TV Detail | Full info: trailer, cast, crew, similar titles, production company links, Moctale rating meter. |
| Moctale Rating System | Skip / Timepass / Go For It / Perfection — real audience sentiment in four buckets. |
| Person Pages | Full filmography and bio for any actor or director. |
| Movie News | Latest Hollywood/Bollywood news pulled fresh every 2 hours. |
| Request Missing Content | Can't find something? Submit a request. |

### Logged-in features
| Feature | Description |
|---|---|
| Rate Movies | Rate anything you've seen — your ratings build your profile. |
| Watch History | Keep a permanent log of everything you've watched. |
| Watchlist | Save movies/shows you want to watch later. |
| Continue Watching | Mark series as "Continue Watching" → get episode release notifications. |
| Episode Notifications | Bell icon alerts when a tracked show drops a new episode today. |
| Personalized Recommendations | Home feed adapts to your taste based on watch history + ratings. |
| Personalized News | News feed weighted toward genres you actually watch. |
| My Analytics | Visual breakdown of your genre tastes, watch patterns, rating style, and more. |

---

## H.5 Image Placeholder Component

```jsx
// In Help.jsx — placeholder for images user will fill later:
function ImageSlot({ label }) {
  return (
    <div className="help-img-slot">
      <span className="help-img-label">[{label}]</span>
    </div>
  )
}
// Usage:
<ImageSlot label="Search overlay screenshot" />
```

CSS:
```css
.help-img-slot {
  width: 100%;
  max-width: 860px;
  aspect-ratio: 16/9;
  background: rgba(255,255,255,0.04);
  border: 2px dashed rgba(255,255,255,0.15);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 14px;
  margin: 16px 0;
}
```

User can replace `<ImageSlot>` with `<img src="..." />` later.

---

## H.6 Tutorial Steps Component

Numbered step flow for key flows:

```jsx
function TutorialStep({ number, title, description }) {
  return (
    <div className="tutorial-step">
      <div className="tutorial-step__num">{number}</div>
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  )
}
```

**Tutorial: How to rate a movie**
1. Open any movie or TV show page.
2. Scroll to the Rating section below the overview.
3. Select one of four categories: Skip, Timepass, Go For It, or Perfection.
4. Your rating is saved instantly. You can change it anytime.

**Tutorial: How to use Continue Watching**
1. Open any TV series detail page.
2. Click the Watched button → choose "Continue Watching" from the dropdown.
3. When a new episode airs, you'll see a bell notification icon in the navbar.
4. Click the bell to see which shows dropped a new episode today.

---

## H.7 FAQ Accordion

Questions:
- Is Movientum free? → Yes, completely free.
- How are Moctale ratings different from TMDB ratings? → Moctale ratings come from our community rating system (Skip/Timepass/Go For It/Perfection). TMDB is shown as fallback when no community rating exists yet.
- How do personalized recommendations work? → Based on your watch history, genres you rate highly, and your click patterns.
- Is my data stored safely? → Passwords hashed with bcrypt, tokens stored in session/local storage only.
- How do I request missing content? → Use the search overlay — if no results found, a "Request Content" button appears.

---

## H.8 File Change Summary

| File | Change |
|---|---|
| `src/pages/Help.jsx` | NEW — full feature guide page |
| `src/pages/Help.css` | NEW — styles |
| `src/App.jsx` | Add `/help` route (no auth guard) |
| `src/components/Navbar.jsx` | Add Help link (? icon or text) |
