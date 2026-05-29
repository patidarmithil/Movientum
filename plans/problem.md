# Search Disappearance Analysis (Mushishi)

## The Problem

You reported that when you searched for "Mushishi" you saw results initially, but after refreshing, it showed no results. Looking at your `log.md`, we see exactly what happened:

```
TMDB network error (ConnectError) for /search/multi. Attempt 1/3
TMDB multi_search timeout for q='mushishi'
```

Here is the exact sequence of events that caused this:

1. **Conflicting Timeouts**: In our previous fix, we made `tmdb_service.py` retry on network errors. It waits 2 seconds, then 4 seconds on subsequent retries. However, in `search.py`, the `_safe_tmdb_search` function has a hard cutoff timeout of **5.0 seconds**:
   ```python
   await asyncio.wait_for(_tmdb.multi_search(query_str), timeout=5.0)
   ```
2. **Retry Defeat**: When a network glitch happened during your search, `tmdb_service.py` tried to sleep for 2s and then 4s (total 6s) to retry. But because `search.py` kills the task at 5.0 seconds, the retry never got a chance to finish!
3. **Empty Cache Trap**: Because the TMDB search was killed at 5 seconds, it returned `None`. The backend fell back to the local database. Since "Mushishi" is an anime (TV show), it isn't stored in the local database, so the result was `[]` (empty).
4. **The 10-second Curse**: The backend then cached this empty result `[]` for 10 seconds (`TTL_SEARCH_EMPTY = 10`). When you refreshed the page immediately after, you hit this 10-second cache of the empty result, which is why it instantly showed "no results".
5. **Why you saw it first**: The first time you saw it, the network request likely succeeded quickly without errors (or you saw it in the autocomplete dropdown). But when you pressed enter or refreshed, the network glitch happened, the 5s timeout killed it, and you got stuck in the 10-second empty cache.

*(Note: This has nothing to do with popularity. TV shows are fetched directly from TMDB, so they will always show up as long as the connection succeeds).*

## The Solution

We need to align the retry delays and the hard timeouts so that retries can actually happen before the task is killed.

**Proposed Fixes:**
1. **Reduce Retry Delay:** In `backend/app/services/tmdb_service.py`, change `RETRY_BASE_DELAY` from `2` to `1`. This means it will sleep for 1s on the first failure, and 2s on the second (total 3s). This allows 2 full retries to fit inside the 5.0s timeout.
2. **Increase Search Timeout:** In `backend/app/routers/search.py`, increase the `asyncio.wait_for` timeout from `5.0` to `8.0` seconds to give the API more breathing room during cold starts or network glitches.

Let me know if you want me to apply these fixes!
