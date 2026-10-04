# Scalability and Performance

Movientum has no budget for more servers, so every speed gain comes from how the code is written. This page lists the techniques in use and the limits that cannot be fixed.

## Techniques in use

| Problem | What the code does |
|---|---|
| Many parallel requests for the same uncached thing | `inflight_lock` in `db/cache.py`: the first request fetches, the others wait and then read the cache |
| Pages needing many API calls | **Page bundles** (`routers/pages.py`): one Redis key per rendered page; on a miss it rebuilds from section caches with one `MGET` |
| Slow side effects | Taste updates, TMDB ingestion and feedback processing run after the response (`BackgroundTasks`) |
| CPU-heavy work blocking the server | Graph walks and ranking run in `asyncio.to_thread` |
| Large responses | Gzip for anything over 1 KB |
| Repeated PageRank setup | `graph_cache.get_ppr_matrix_sync()` caches the matrix per graph version |
| Too many database round trips | Exclusion lists (watched, watchlisted, suppressed, low-rated) are fetched in one `UNION` query |
| TMDB rate limits | Titles saved locally after the first fetch; TMDB responses cached 7 days |
| Slow first paint | Home snapshot in `localStorage`, lazy below-the-fold sections, split JS chunks |
| Cold Azure start | Only the DB/Redis check runs before the port opens; warm-up runs after |

## Cache lifetimes are chosen on purpose

Things that rarely change (movie details, credits, trailers, providers) are cached for 7 days. Personal things are short (taste profile 2 min, recommendations 15 min, dropping to 3 min right after the user adds or watches something). Writes bust the exact keys they affect instead of waiting for expiry. See `../infrastructure_and_ops/redis_caching.md`.

## Limits that stay

- **Cold start**: the Azure container sleeps when idle; the first request waits 15–30 s. This is why the frontend timeout is 120 s.
- **Upstash eviction**: the free tier can drop keys under memory pressure regardless of TTL.

When a page is slow, check these two first before assuming a caching bug.

## The recommendation graph

The graph is held in memory per process (`graph_cache._GRAPH`). Each worker has its own copy, built at startup from `content_catalog`. New titles are spliced in live with `add_row_to_graph()` instead of rebuilding.

## Rule for future speed work

Speed changes may change **when** or **where** a result is computed, or how long it is cached. They must not change **which** recommendations come back or their order.
