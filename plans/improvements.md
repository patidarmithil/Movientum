# Improvements Plan — Movientum
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
