# Trailers, Notifications, Contact and Admin

Smaller features that do not need their own page.

## Home trailers row

- Four regions: **Hollywood, India, Anime, Other**. A title's region comes from its language and origin country (`trailer_service.matches_region`).
- A background job (`tasks/fetch_trailers.py`) crawls TMDB and writes a ranked trailer list per region into Redis. Beat runs it every 3 h (staggered per region), and the admin "Refresh Trailers" button runs it on demand. Entries older than 30 days are pruned.
- `GET /api/v1/trailers/home` only reads that list — no TMDB call on a warm index. Logged-in users see trailers of shows they follow first (cached 10 min).

## Notifications

Table `notifications`, shown in the navbar bell. A `type` column separates:
- `episode` — the 04:00 job found a new episode of a show you follow (`watching_tracker`).
- `admin_contact`, `admin_feedback` — tells admins a new contact message or bug report arrived.
- `admin_message` — an admin sent you a message.

## Contact form and bug reports

- **Contact** (`POST /api/v1/contact`, no login) from the Home/Intro footer. Admins read them in the admin panel.
- **Feedback / bug report** (`POST /api/v1/feedback`, login) with an optional screenshot, compressed and saved under `backend/uploads/feedback` (served at `/uploads`). Users see their own reports in Settings → My Issues.

Do not confuse `feedback.py` (bug reports) with `recommendation_signals.py` (`/rec-feedback`, thumbs on recommendations).

## Admin panel (`/admin`, `AdminDashboard.jsx`)

Tabs: Business Growth, System Tasks, API & Infra, Machine Learning, Messages, Users.

- **Manual triggers** call `POST /internal/trigger/{task}` (admin login required). The job runs inside the API process as a background task, with progress at `/internal/progress/{task}` and cancel at `/internal/cancel/{task}`.
- Task keys: `sync_movies`, `check_episodes`, `retrain_ranker`, `refresh_trailers`, `expire_trailers`, `build_title_index`, `news_daily_fetch`, and `nightly_job` (runs expire trailers → sync → retrain → title index → episodes → refresh trailers in order).
- **Users tab**: search accounts, make/remove admin, send a message, delete. An admin cannot target their own account.

To add a new admin task, add it to both `TASKS` in `AdminDashboard.jsx` and `trigger_task` in `routers/internal.py`. `AdminPage.jsx` and the `/admin/tasks/*` routes are old and unused.

## Analysis page (`/analysis`)

Shows the user their own taste and how the engine sees them: taste fingerprint, editable taste weights, engine "X-ray" (seeds, ranker status), feedback timeline, viewing habits, library highlights. Data from `/users/me/analysis`, `/engine`, `/feedback`, cached 2–10 min per user.
