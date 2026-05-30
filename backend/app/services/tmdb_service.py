"""
Movientum — TMDB API Service

All external TMDB API communication lives here.
Uses httpx AsyncClient with Bearer token auth (Read Access Token).
Rate limiting: 0.25s sleep between requests (≈4 req/s, well within 40 req/10s).
Retry on 429: exponential backoff 2s → 4s → 8s (max 3 attempts).
All functions return typed dicts or None on failure (caller handles None).
"""
import asyncio
import logging
from typing import Optional

import httpx

from app.config import settings
from app.db.cache import get_cached, set_cached, key_tmdb_config, TTL_TMDB_CONFIG

logger = logging.getLogger(__name__)

# ── Constants ────────────────────────────────────────────────────
REQUEST_DELAY = 0.25        # seconds between requests
REQUEST_TIMEOUT = 10.0      # seconds per request
MAX_RETRIES = 3
RETRY_BASE_DELAY = 1        # seconds (doubles each retry: 1, 2, 4)


class TMDBService:
    """
    TMDB API client. Instantiated once and reused across seed script.
    For FastAPI routes, import standalone functions at bottom of file.
    """

    def __init__(self):
        self.base_url = settings.tmdb_base_url
        self.headers = settings.tmdb_headers
        self._client: Optional[httpx.AsyncClient] = None
        self._semaphore: Optional[asyncio.Semaphore] = None

    def _get_semaphore(self) -> asyncio.Semaphore:
        if self._semaphore is None:
            self._semaphore = asyncio.Semaphore(4)  # max 4 concurrent TMDB calls
        return self._semaphore

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=self.headers,
                timeout=REQUEST_TIMEOUT,
                follow_redirects=True,
            )
        return self._client

    async def aclose(self):
        if self._client:
            await self._client.aclose()

    async def __aenter__(self):
        # for backwards compatibility with context manager
        self._get_client()
        return self

    async def __aexit__(self, *args):
        await self.aclose()

    # ── Core Request Handler ──────────────────────────────────────

    async def _get(self, endpoint: str, params: dict = None) -> Optional[dict]:
        """
        Make GET request to TMDB. Handles:
        - Rate limit delay (0.25s before each call)
        - Retry on 429 with exponential backoff
        - Returns None on failure (non-fatal for seed script)
        """
        url = f"{self.base_url}{endpoint}"
        params = params or {}
        client = self._get_client()
        semaphore = self._get_semaphore()

        async with semaphore:
            for attempt in range(1, MAX_RETRIES + 1):
                await asyncio.sleep(REQUEST_DELAY)  # respect rate limit
                try:
                    response = await client.get(url, params=params)

                    if response.status_code == 200:
                        logger.debug(f"TMDB OK: {endpoint}")
                        return response.json()

                    elif response.status_code == 429:
                        wait = RETRY_BASE_DELAY ** attempt
                        logger.warning(f"TMDB rate limited. Attempt {attempt}/{MAX_RETRIES}. Waiting {wait}s...")
                        await asyncio.sleep(wait)
                        continue

                    elif response.status_code == 404:
                        logger.debug(f"TMDB 404: {endpoint}")
                        return None

                    else:
                        logger.warning(f"TMDB FAIL: {response.status_code} for {endpoint}: {response.text[:100]}")
                        if attempt < MAX_RETRIES:
                            await asyncio.sleep(RETRY_BASE_DELAY * attempt)
                            continue
                        return None

                except (httpx.TimeoutException, httpx.RequestError) as e:
                    logger.warning(f"TMDB FAIL: network error ({type(e).__name__}) for {endpoint}. Attempt {attempt}/{MAX_RETRIES}")
                    if attempt < MAX_RETRIES:
                        await asyncio.sleep(RETRY_BASE_DELAY * attempt)
                        continue
                    return None

                except Exception as e:
                    logger.error(f"TMDB FAIL: request error for {endpoint}: {repr(e)}")
                    return None

        return None

    # ── TMDB Endpoints ────────────────────────────────────────────

    async def fetch_configuration(self) -> Optional[dict]:
        """
        GET /configuration — returns image base URL and available sizes.
        Cached in Redis for 24hrs (this data rarely changes).
        Used to build full image URLs: {base_url}{size}{poster_path}
        """
        cache_key = key_tmdb_config()
        cached = await get_cached(cache_key)
        if cached:
            return cached

        data = await self._get("/configuration")
        if data:
            await set_cached(cache_key, data, TTL_TMDB_CONFIG)
        return data

    async def fetch_popular_movies(self, page: int = 1) -> Optional[dict]:
        """
        GET /movie/popular?page=N
        Returns: { page, results: [...], total_pages, total_results }
        Each result has: id, title, overview, release_date, poster_path,
                         backdrop_path, popularity, vote_average, vote_count,
                         genre_ids, original_language, adult
        """
        return await self._get("/movie/popular", params={"page": page, "language": "en-US"})

    async def fetch_popular_tv(self, page: int = 1) -> Optional[dict]:
        """
        GET /tv/popular?page=N
        """
        return await self._get("/tv/popular", params={"page": page, "language": "en-US"})

    async def fetch_trending(self, media_type: str = "all", time_window: str = "day") -> Optional[dict]:
        """
        GET /trending/{media_type}/{time_window}
        media_type: 'all', 'movie', 'tv', 'person'
        time_window: 'day', 'week'
        """
        return await self._get(
            f"/trending/{media_type}/{time_window}",
            params={"language": "en-IN", "region": "IN"}
        )

    async def discover_movies(self, genres: str, page: int = 1) -> Optional[dict]:
        """
        GET /discover/movie
        """
        return await self._get("/discover/movie", params={
            "with_genres": genres,
            "language": "en-US",
            "sort_by": "popularity.desc",
            "page": page
        })

    async def discover_tv(self, genres: str, page: int = 1) -> Optional[dict]:
        """
        GET /discover/tv
        """
        return await self._get("/discover/tv", params={
            "with_genres": genres,
            "language": "en-US",
            "sort_by": "popularity.desc",
            "page": page
        })

    async def fetch_top_rated_movies(self, page: int = 1) -> Optional[dict]:
        """
        GET /movie/top_rated?page=N
        Same structure as popular. Used to extend initial seed dataset.
        """
        return await self._get("/movie/top_rated", params={"page": page, "language": "en-US"})

    async def fetch_top_rated_tv(self, page: int = 1) -> Optional[dict]:
        """
        GET /tv/top_rated?page=N
        """
        return await self._get("/tv/top_rated", params={"page": page, "language": "en-US"})

    async def fetch_on_the_air(self, page: int = 1) -> Optional[dict]:
        """
        GET /tv/on_the_air
        TV shows currently broadcasting.
        """
        return await self._get("/tv/on_the_air", params={"page": page, "language": "en-US"})

    async def fetch_now_playing(self, page: int = 1) -> Optional[dict]:
        """
        GET /movie/now_playing — movies currently in theaters.
        Used in daily cron sync.
        """
        return await self._get("/movie/now_playing", params={"page": page, "language": "en-US"})

    async def fetch_upcoming(self, page: int = 1) -> Optional[dict]:
        """
        GET /movie/upcoming — releasing soon.
        Used in daily cron sync.
        """
        return await self._get("/movie/upcoming", params={"page": page, "language": "en-US"})

    async def fetch_movie_detail(self, movie_id: int) -> Optional[dict]:
        """
        GET /movie/{id} — full movie detail.
        Returns everything: genres (full objects not just IDs), runtime,
        budget, revenue, status, imdb_id, production_companies, etc.
        """
        return await self._get(f"/movie/{movie_id}", params={"language": "en-US"})

    async def fetch_movie_credits(self, movie_id: int) -> Optional[dict]:
        """
        GET /movie/{id}/credits — cast and crew.
        We extract only directors from crew (job == "Director").
        Returns: { id, cast: [...], crew: [...] }
        Each crew member: id, name, job, department, profile_path
        """
        data = await self._get(f"/movie/{movie_id}/credits")
        return data

    async def fetch_movie_videos(self, movie_id: int) -> Optional[list]:
        """
        GET /movie/{id}/videos — trailers, teasers.
        Returns list of video objects with YouTube keys.
        Filter: type == "Trailer", site == "YouTube"
        """
        data = await self._get(f"/movie/{movie_id}/videos", params={"language": "en-US"})
        if not data:
            return None
        videos = data.get("results", [])
        # Filter to YouTube trailers only
        trailers = [
            v for v in videos
            if v.get("site") == "YouTube" and v.get("type") == "Trailer"
        ]
        return trailers

    async def search_movies(self, query: str, page: int = 1) -> Optional[dict]:
        """
        GET /search/movie?query={q} — TMDB search fallback.
        Used when local DB search returns < 5 results.
        """
        return await self._get("/search/movie", params={
            "query": query,
            "page": page,
            "language": "en-US",
            "include_adult": False,
        })

    async def fetch_person_details(self, person_id: int) -> Optional[dict]:
        """
        GET /person/{id} — biography, birthday, place_of_birth, profile_path.
        """
        return await self._get(f"/person/{person_id}", params={"language": "en-US"})

    async def fetch_person_credits(self, person_id: int) -> Optional[dict]:
        """
        GET /person/{id}/combined_credits — all movies+TV this person worked on.
        Returns { cast: [...], crew: [...] }
        """
        return await self._get(
            f"/person/{person_id}/combined_credits",
            params={"language": "en-US"},
        )

    async def fetch_tv_detail(self, tv_id: int) -> Optional[dict]:
        """
        GET /tv/{id} — full TV show detail.
        Returns name, overview, poster_path, backdrop_path,
        first_air_date, number_of_seasons, number_of_episodes,
        vote_average, vote_count, genres, created_by, status.
        Cached in Redis for 24 hours.
        """
        cache_key = f"tmdb:raw:tv:{tv_id}"
        cached = await get_cached(cache_key)
        if cached:
            return cached
        data = await self._get(f"/tv/{tv_id}", params={"language": "en-US"})
        if data:
            await set_cached(cache_key, data, 86400)
        return data

    async def fetch_tv_credits(self, tv_id: int) -> Optional[dict]:
        """
        GET /tv/{id}/credits — cast and crew.
        Same shape as movie credits: { cast: [...], crew: [...] }
        """
        return await self._get(f"/tv/{tv_id}/credits", params={"language": "en-US"})

    async def multi_search(self, query: str, page: int = 1) -> Optional[dict]:
        """
        GET /search/multi — returns mixed movie + TV results.
        Each item has media_type: 'movie' | 'tv' | 'person'.
        """
        return await self._get("/search/multi", params={
            "query": query,
            "page": page,
            "language": "en-US",
            "include_adult": "false",
        })

    async def fetch_similar_movies(self, movie_id: int) -> Optional[dict]:
        return await self._get(f"/movie/{movie_id}/similar", params={"language": "en-US", "page": 1})

    async def fetch_similar_tv(self, tv_id: int) -> Optional[dict]:
        return await self._get(f"/tv/{tv_id}/similar", params={"language": "en-US", "page": 1})

    async def fetch_movie_recommendations(self, movie_id: int) -> Optional[dict]:
        return await self._get(f"/movie/{movie_id}/recommendations", params={"language": "en-US", "page": 1})

    async def fetch_tv_recommendations(self, tv_id: int) -> Optional[dict]:
        return await self._get(f"/tv/{tv_id}/recommendations", params={"language": "en-US", "page": 1})

    async def fetch_movie_keywords(self, movie_id: int) -> Optional[dict]:
        return await self._get(f"/movie/{movie_id}/keywords")

    async def fetch_tv_keywords(self, tv_id: int) -> Optional[dict]:
        return await self._get(f"/tv/{tv_id}/keywords")



    # ── Data Extraction Helpers ───────────────────────────────────

    @staticmethod
    def extract_directors(credits_data: dict) -> list[dict]:
        """
        Extract director info from credits response.
        Returns list of: { id, name, biography, profile_path }
        """
        if not credits_data:
            return []
        crew = credits_data.get("crew", [])
        return [
            {
                "id": member["id"],
                "name": member["name"],
                "profile_path": member.get("profile_path"),
                "biography": None,  # Not in credits — fetched separately if needed
                "birthday": None,
                "place_of_birth": None,
                "tmdb_id": member["id"],
            }
            for member in crew
            if member.get("job") == "Director"
        ]

    @staticmethod
    def extract_movie_data(detail: dict) -> dict:
        """
        Normalize TMDB movie detail response into our DB schema fields.
        Handles missing/null fields gracefully.
        """
        genres = detail.get("genres", [])
        return {
            "id": detail["id"],
            "title": detail.get("title", "Unknown Title"),
            "original_title": detail.get("original_title"),
            "overview": detail.get("overview"),
            "release_date": detail.get("release_date") or None,  # empty str → None
            "runtime": detail.get("runtime"),
            "poster_path": detail.get("poster_path"),
            "backdrop_path": detail.get("backdrop_path"),
            "popularity": detail.get("popularity", 0.0),
            "vote_average": detail.get("vote_average", 0.0),
            "vote_count": detail.get("vote_count", 0),
            "adult": detail.get("adult", False),
            "status": detail.get("status"),
            "budget": detail.get("budget", 0),
            "revenue": detail.get("revenue", 0),
            "original_language": detail.get("original_language"),
            "imdb_id": detail.get("imdb_id"),
            "metadata_": {
                "tagline": detail.get("tagline"),
                "homepage": detail.get("homepage"),
                "production_companies": [
                    {"id": c["id"], "name": c["name"]}
                    for c in detail.get("production_companies", [])
                ],
            },
            "genres": [{"id": g["id"], "name": g["name"]} for g in genres],
        }

    @staticmethod
    def build_image_url(path: Optional[str], size: str = "w342") -> Optional[str]:
        """
        Build full TMDB image URL from relative path.
        sizes: w185 (small), w342 (card), w500 (detail), w780, w1280, original
        """
        if not path:
            return None
        base = settings.tmdb_image_base_url
        return f"{base}/{size}{path}"

# Global instance for FastAPI routers
tmdb_service = TMDBService()
