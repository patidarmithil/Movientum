# Storage Estimation

Movientum fits inside free tiers by keeping each store small. Figures below are rough estimates, useful for spotting what grows.

## PostgreSQL (Supabase)

| Table | Size per row | Growth | Notes |
|---|---|---|---|
| `content_catalog` | ~2 KB | ~20K seed + titles people open | Features stored as arrays/JSONB, not join tables |
| `movies` | ~1–2 KB | Grows with browsing | Unused, unpopular rows older than 30 days are deleted at startup |
| `user_taste_profiles` | ~1–3 KB | One per user | Seven JSONB weight maps |
| `interaction_log` | ~300 B | Every thumbs/click/watch | Largest growing table. Training only reads the last 30 days |
| `tier_lists` | a few KB | Per saved board | Whole board in JSONB; capped at 12 rows / 300 items and a per-user limit |
| `rec_suppression` | ~100 B | Per dismissed title | Expires after 90 days |

**News is never written to PostgreSQL.** That is the single biggest saving.

## Redis (Upstash)

| Data | Size | Lifetime |
|---|---|---|
| News snapshot | ~500 articles plus indexes | Until the next News Daily Fetch replaces it |
| Page bundles, title details, credits | 5–50 KB each | 30 min to 7 days |
| Recommendation pools | ~100 items per user per block | 15 min |
| Trailer indexes | Per region | Refreshed every 3 h, entries pruned after 30 days |
| Token blacklist | Tiny | Until the token would have expired anyway |

Upstash free tier evicts keys under memory pressure. Everything in Redis must be rebuildable.

## Server memory

The in-memory recommendation graph holds tens of thousands of nodes (titles plus genre, keyword, cast, crew, era, language, studio nodes) and a few hundred thousand edges — roughly 100–150 MB per process. This is why the project runs a single worker.

## Files

- Watchlist cover images go to **Supabase Storage**, re-encoded to WebP first.
- Feedback screenshots are compressed and saved on the API server's disk under `backend/uploads/feedback`. The container disk is not permanent, so these can be lost on redeploy.
- Tier-list uploads made by guests stay in the browser (IndexedDB).
