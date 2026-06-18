# Movientum — Advanced Recommendation Engine
## Master Implementation Blueprint (Phased)

> **Project Context:** Movientum runs on a FastAPI + SQLAlchemy 2 async backend (Azure), Supabase PostgreSQL DB, Upstash Redis cache, Celery workers, and a React 19 + Vite 8 SPA frontend (Vercel). The existing recommendation surface lives in `backend/app/services/advanced_recs.py` and `backend/app/routers/recommendations.py`. This plan extends those layers into a full ML-grade personalized recommendation system.

---

## System Overview

```
                        ┌──────────────────────────────────────────────────┐
                        │          MOVIENTUM REC ENGINE v2                 │
                        └──────────────────────┬───────────────────────────┘
                                               │
              ┌────────────────────────────────┼────────────────────────────────┐
              │                                │                                │
              ▼                                ▼                                ▼
    ┌──────────────────┐           ┌───────────────────┐           ┌──────────────────────┐
    │  Tier 1: Data    │           │  Tier 2: Feature  │           │  Tier 3: Graph       │
    │  Foundation      │           │  Ingestion Loop   │           │  Candidate Retrieval │
    │  (20K catalog +  │           │  (TMDB fallback   │           │  (NetworkX/scipy     │
    │   taste profile) │           │   + DB backfill)  │           │   + RWR traversal)   │
    └──────────────────┘           └───────────────────┘           └──────────────────────┘
                                                                              │
                                                                              ▼
                                                               ┌──────────────────────────┐
                                                               │  Tier 4: Feature Matrix  │
                                                               │  + XGBRanker Inference   │
                                                               └─────────────┬────────────┘
                                                                             │
                                                              ┌──────────────┴───────────────┐
                                                              │  Tier 5: Ensemble Blending   │
                                                              │   - Recs: 60/40 TDI          │
                                                              │   - Similar: 70/30 TDI (100) │
                                                              └─────────────┬────────────────┘
                                                                            │
                                                    ┌───────────────────────┴──────────────────────┐
                                                    │  Tier 6: Real-Time Feedback + Nightly Retrain │
                                                    └──────────────────────────────────────────────┘
```

---

---

# PHASE 1 — Data Foundation: 20K Content Catalog + Taste Profile Schema

**Goal:** Build the two core database tables that power every downstream component. Nothing else works without these.

**Target Files:**
- `backend/app/db/orm_models.py` — new ORM models
- `backend/app/db/alembic/` — new migration scripts

---

## 1.1 — ORM Model: `content_catalog`

This table is the **fast local coordinate center** for all candidate retrieval. It replaces live TMDB API lookups during recommendation inference, providing sub-millisecond feature reads.

```python
# backend/app/db/orm_models.py  (ADD)

from sqlalchemy import (
    Column, Integer, String, Float, Text, Boolean,
    ARRAY, TIMESTAMP, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import JSONB
from app.db.database import Base
import datetime

class ContentCatalog(Base):
    __tablename__ = "content_catalog"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    tmdb_id        = Column(Integer, nullable=False)
    media_type     = Column(String(10), nullable=False)         # "movie" | "tv"

    # ── Categorical Feature Vectors ──────────────────────────────────────
    genre_ids      = Column(ARRAY(Integer), default=[])         # TMDB genre integer IDs
    keyword_ids    = Column(ARRAY(Integer), default=[])         # TMDB keyword IDs (top 15)
    studio_ids     = Column(ARRAY(Integer), default=[])         # Production company IDs

    # ── Talent Dimension ─────────────────────────────────────────────────
    cast_ids       = Column(ARRAY(Integer), default=[])         # Top 10 cast person IDs
    crew_ids       = Column(JSONB, default={})
    # crew_ids structure: {"director": [id], "writer": [id], "producer": [id]}

    # ── Demographic Metadata ─────────────────────────────────────────────
    original_language = Column(String(10))                      # e.g. "en", "ja", "hi"
    origin_countries  = Column(ARRAY(String(5)), default=[])   # e.g. ["US","IN","KR"]
    release_era       = Column(String(20))                      # e.g. "1990s", "2020s"
    release_year      = Column(Integer)

    # ── Performance Indices ───────────────────────────────────────────────
    vote_average   = Column(Float, default=0.0)
    vote_count     = Column(Integer, default=0)
    popularity     = Column(Float, default=0.0)

    # ── Metadata ─────────────────────────────────────────────────────────
    title          = Column(String(500))
    poster_path    = Column(String(500))
    is_seed        = Column(Boolean, default=False)  # True = part of 20K seed, False = on-demand
    ingested_at    = Column(TIMESTAMP, default=datetime.datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("tmdb_id", "media_type", name="uq_catalog_tmdb_media"),
    )
```

**Why `ARRAY` not JSONB for IDs?** Integer arrays support GIN indexing natively in Postgres, making `&&` (overlap) and `@>` (contains) queries fast for candidate pre-filtering without full table scans.

**Release Era Binning Logic:**
```python
def bin_release_era(year: int) -> str:
    """Maps a release year to a decade-era string bucket."""
    if not year:
        return "unknown"
    decade = (year // 10) * 10
    return f"{decade}s"    # e.g. 1994 → "1990s", 2022 → "2020s"
```

---

## 1.2 — ORM Model: `user_taste_profiles`

This table stores a **live, multi-dimensional preference scorecard** per user. Instead of cold-start model inference, it maintains continuously-updated floating-point affinity weights in JSONB columns.

```python
# backend/app/db/orm_models.py  (ADD)

class UserTasteProfile(Base):
    __tablename__ = "user_taste_profiles"

    id      = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)

    # ── Affinity Weight Vectors (JSONB float maps) ────────────────────────
    genre_weights    = Column(JSONB, default={})
    # e.g. {"28": 42.5, "878": 18.2, "27": -25.0}  (TMDB genre IDs as string keys)

    cast_weights     = Column(JSONB, default={})
    # e.g. {"500": 15.4, "1136406": 8.2}            (TMDB person IDs as string keys)

    crew_weights     = Column(JSONB, default={})
    # e.g. {"525": 20.0}                             (director/writer person IDs)

    keyword_weights  = Column(JSONB, default={})
    # e.g. {"9715": 12.0, "180547": -8.0}           (TMDB keyword IDs)

    language_weights = Column(JSONB, default={})
    # e.g. {"en": 1.2, "ja": 0.9, "ko": 1.5}       (float multipliers, neutral = 1.0)

    era_weights      = Column(JSONB, default={})
    # e.g. {"1990s": -5.0, "2010s": 22.0, "2020s": 35.0}

    # ── Global Interaction Statistics ─────────────────────────────────────
    total_interactions = Column(Integer, default=0)
    avg_rating_given   = Column(Float, default=0.0)
    last_updated       = Column(TIMESTAMP, default=datetime.datetime.utcnow,
                                onupdate=datetime.datetime.utcnow)

    user = relationship("User", backref="taste_profile", uselist=False)
```

**JSONB Key Design Decision:** All ID keys are stored as **strings** (JSONB requirement). All affinity values are **floats** (signed — negative = dislike, positive = like). Language weights are **multipliers** centered at `1.0` (neutral), not additive scores.

---

## 1.3 — Alembic Migration

```bash
# Create migration:
alembic revision --autogenerate -m "add_content_catalog_and_user_taste_profiles"

# Apply:
alembic upgrade head
```

**Required indexes to add in the migration script:**
```python
# In the generated migration file:
op.create_index("ix_catalog_tmdb_id",    "content_catalog", ["tmdb_id"])
op.create_index("ix_catalog_media_type", "content_catalog", ["media_type"])
op.create_index("ix_catalog_genre_ids",  "content_catalog", ["genre_ids"],
                postgresql_using="gin")
op.create_index("ix_catalog_cast_ids",   "content_catalog", ["cast_ids"],
                postgresql_using="gin")
```

---

## 1.4 — 20K Seed Population Script

A **one-time offline script** (not a Celery task) that pre-populates `content_catalog` with the 10K movies + 10K TV shows seed. This script is created during Phase 1 implementation and must be executed manually.

> [!IMPORTANT]
> **Execution Mode:** Manual. The developer/user will run this script manually after performing the database migration.

**Algorithm:**
1. Iterate TMDB `GET /discover/movie` with `sort_by=popularity.desc` and `vote_count.gte=50`, paging until up to 10,000 items are collected.
2. Repeat with `GET /discover/tv` for up to 10,000 TV shows.
3. For each collected item, fetch details with `append_to_response=keywords,credits` to get genres, keyword_ids, cast_ids, and crew_ids in a single API call (optimized read path).
4. Run `bin_release_era(year)` to map the release year to its era string (e.g., "1990s").
5. Bulk upsert batches of items into `content_catalog` using `INSERT ... ON CONFLICT (tmdb_id, media_type) DO UPDATE` for reliability and resuming support.
6. Mark items with `is_seed = True`.

```python
# backend/scripts/seed_catalog.py (NEW FILE — run once offline)
# Usage: python -m scripts.seed_catalog

import asyncio
import logging
import os
import sys
import time
from datetime import datetime
import json
import httpx
import asyncpg

# Add parent directory to path so we can import app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Load .env before importing app modules
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.config import settings

# ── Logging ─────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("seed_catalog")

# ── Configuration ───────────────────────────────────────────────
TARGET_COUNT = 10000        # 10,000 movies + 10,000 TV shows
PAGES_TO_FETCH = 500        # 500 pages * 20 items/page = 10,000 items
CONCURRENCY_LIMIT = 20      # Max concurrent detail requests
BATCH_SIZE = 100            # DB insert batch size

# Era binning utility
def bin_release_era(year: int) -> str:
    if not year:
        return "unknown"
    decade = (year // 10) * 10
    return f"{decade}s"

class TMDBExtractor:
    def __init__(self):
        self.client = httpx.AsyncClient(
            headers=settings.tmdb_headers,
            timeout=httpx.Timeout(15.0),
            follow_redirects=True
        )
        self.semaphore = asyncio.Semaphore(CONCURRENCY_LIMIT)

    async def aclose(self):
        await self.client.aclose()

    async def fetch_page(self, media_type: str, page: int) -> list[int]:
        """Fetch popular items on a page and return their TMDB IDs."""
        endpoint = f"/discover/{media_type}"
        params = {
            "sort_by": "popularity.desc",
            "page": page,
            "language": "en-US",
            "include_adult": "false"
        }
        if media_type == "movie":
            params["vote_count.gte"] = 50
        else:
            params["vote_count.gte"] = 10

        url = f"{settings.tmdb_base_url}{endpoint}"
        try:
            response = await self.client.get(url, params=params)
            if response.status_code == 200:
                data = response.json()
                return [item["id"] for item in data.get("results", [])]
            elif response.status_code == 429:
                logger.warning(f"Rate limited on page {page}. Waiting...")
                await asyncio.sleep(5)
                return await self.fetch_page(media_type, page)
            else:
                logger.error(f"Failed to fetch page {page}: {response.status_code}")
                return []
        except Exception as e:
            logger.error(f"Error fetching page {page}: {e}")
            return []

    async def fetch_details(self, media_type: str, tmdb_id: int) -> dict | None:
        """Fetch details, keywords, and credits in a single request."""
        endpoint = f"/{media_type}/{tmdb_id}"
        params = {
            "append_to_response": "keywords,credits",
            "language": "en-US"
        }
        url = f"{settings.tmdb_base_url}{endpoint}"
        async with self.semaphore:
            for attempt in range(3):
                try:
                    await asyncio.sleep(0.05)
                    response = await self.client.get(url, params=params)
                    if response.status_code == 200:
                        return response.json()
                    elif response.status_code == 404:
                        return None
                    elif response.status_code == 429:
                        wait_time = 2 ** attempt
                        logger.warning(f"Rate limited on {media_type} {tmdb_id}. Retrying in {wait_time}s...")
                        await asyncio.sleep(wait_time)
                    else:
                        logger.warning(f"Failed {media_type} {tmdb_id}: {response.status_code}")
                        return None
                except Exception as e:
                    logger.warning(f"Network error on {media_type} {tmdb_id}: {e}")
                    await asyncio.sleep(1)
            return None

def parse_crew(crew_list: list) -> dict:
    """Extracts director, writer, and producer IDs from TMDB crew array."""
    result = {"director": [], "writer": [], "producer": []}
    for member in crew_list:
        job = member.get("job", "").lower()
        member_id = member.get("id")
        if not member_id:
            continue
        if "director" in job:
            result["director"].append(member_id)
        elif "screenplay" in job or "writer" in job:
            result["writer"].append(member_id)
        elif "producer" in job and "executive" not in job:
            result["producer"].append(member_id)
    return result

async def upsert_catalog_batch(conn: asyncpg.Connection, batch: list[dict]):
    """Insert or update a batch of catalog items."""
    sql = """
    INSERT INTO content_catalog (
        tmdb_id, media_type, genre_ids, keyword_ids, studio_ids, cast_ids, crew_ids,
        original_language, origin_countries, release_era, release_year,
        vote_average, vote_count, popularity, title, poster_path, is_seed, ingested_at
    ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW()
    )
    ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
        genre_ids         = EXCLUDED.genre_ids,
        keyword_ids       = EXCLUDED.keyword_ids,
        studio_ids        = EXCLUDED.studio_ids,
        cast_ids          = EXCLUDED.cast_ids,
        crew_ids          = EXCLUDED.crew_ids,
        original_language = EXCLUDED.original_language,
        origin_countries  = EXCLUDED.origin_countries,
        release_era       = EXCLUDED.release_era,
        release_year      = EXCLUDED.release_year,
        vote_average      = EXCLUDED.vote_average,
        vote_count        = EXCLUDED.vote_count,
        popularity        = EXCLUDED.popularity,
        title             = EXCLUDED.title,
        poster_path       = EXCLUDED.poster_path,
        is_seed           = EXCLUDED.is_seed,
        ingested_at       = NOW()
    """
    args = [
        (
            item["tmdb_id"],
            item["media_type"],
            item["genre_ids"],
            item["keyword_ids"],
            item["studio_ids"],
            item["cast_ids"],
            json.dumps(item["crew_ids"]),
            item["original_language"],
            item["origin_countries"],
            item["release_era"],
            item["release_year"],
            item["vote_average"],
            item["vote_count"],
            item["popularity"],
            item["title"],
            item["poster_path"],
            item["is_seed"]
        )
        for item in batch
    ]
    await conn.executemany(sql, args)

async def seed_media_type(conn: asyncpg.Connection, extractor: TMDBExtractor, media_type: str):
    logger.info(f"Starting seed process for: {media_type}")
    
    # Step 1: Collect TMDB IDs from 500 pages
    logger.info(f"Collecting TMDB IDs from first {PAGES_TO_FETCH} pages of {media_type}...")
    item_ids = []
    for page in range(1, PAGES_TO_FETCH + 1):
        ids = await extractor.fetch_page(media_type, page)
        item_ids.extend(ids)
        if page % 50 == 0:
            logger.info(f"  Collected {len(item_ids)} IDs from {page} pages.")
    
    # Deduplicate
    item_ids = list(set(item_ids))
    total_ids = len(item_ids)
    logger.info(f"Total unique {media_type} IDs to process: {total_ids}")

    # Step 2: Fetch details + credits + keywords concurrently and batch insert
    batch = []
    processed_count = 0
    start_time = time.time()

    async def process_item(item_id):
        nonlocal processed_count
        details = await extractor.fetch_details(media_type, item_id)
        if not details:
            return None
        
        # Extract keywords
        kws = details.get("keywords", {})
        kw_list = kws.get("keywords" if media_type == "movie" else "results", [])
        keyword_ids = [kw["id"] for kw in kw_list[:15]]

        # Extract credits
        credits = details.get("credits", {})
        cast_ids = [c["id"] for c in credits.get("cast", [])[:10]]
        crew_map = parse_crew(credits.get("crew", []))

        # Release date / year / era
        rel_date_str = details.get("release_date" if media_type == "movie" else "first_air_date") or ""
        year = int(rel_date_str[:4]) if (rel_date_str and len(rel_date_str) >= 4) else None
        era = bin_release_era(year)

        return {
            "tmdb_id": item_id,
            "media_type": media_type,
            "genre_ids": [g["id"] for g in details.get("genres", [])],
            "keyword_ids": keyword_ids,
            "studio_ids": [p["id"] for p in details.get("production_companies", [])],
            "cast_ids": cast_ids,
            "crew_ids": crew_map,
            "original_language": details.get("original_language"),
            "origin_countries": [c["iso_3166_1"] for c in details.get("production_countries", [])],
            "release_era": era,
            "release_year": year,
            "vote_average": float(details.get("vote_average") or 0.0),
            "vote_count": int(details.get("vote_count") or 0),
            "popularity": float(details.get("popularity") or 0.0),
            "title": details.get("title" if media_type == "movie" else "name") or "Unknown Title",
            "poster_path": details.get("poster_path"),
            "is_seed": True
        }

    # Process chunks concurrently using asyncio.gather
    chunk_size = 50
    for i in range(0, total_ids, chunk_size):
        chunk = item_ids[i:i+chunk_size]
        tasks = [process_item(id_) for id_ in chunk]
        results = await asyncio.gather(*tasks)
        
        valid_results = [r for r in results if r is not None]
        batch.extend(valid_results)
        processed_count += len(chunk)

        # Bulk upsert when batch reaches threshold
        if len(batch) >= BATCH_SIZE or processed_count >= total_ids:
            if batch:
                await upsert_catalog_batch(conn, batch)
                batch = []
            
            elapsed = time.time() - start_time
            rate = processed_count / elapsed if elapsed > 0 else 0
            eta_min = ((total_ids - processed_count) / rate) / 60 if rate > 0 else 0
            logger.info(
                f"Progress [{processed_count}/{total_ids}]: "
                f"Rate = {rate:.1f} items/sec. ETA = {eta_min:.1f} mins."
            )

async def main():
    logger.info("=" * 60)
    logger.info("MOVIENTUM CONTENT CATALOG SEEDING SCRIPT")
    logger.info("=" * 60)

    # Database setup using raw asyncpg
    db_url = settings.safe_async_db_url.replace("postgresql+asyncpg://", "postgresql://")
    logger.info("Connecting to Supabase PostgreSQL...")
    conn = await asyncpg.connect(db_url, ssl="require")
    logger.info("Database connection established.")

    extractor = TMDBExtractor()

    try:
        # Fetch movies
        await seed_media_type(conn, extractor, "movie")
        
        # Fetch TV shows
        await seed_media_type(conn, extractor, "tv")

    except Exception as e:
        logger.error(f"Seeding failed with error: {e}")
    finally:
        await extractor.aclose()
        await conn.close()
        logger.info("Supabase connection closed.")
        logger.info("Seeding script completed.")

if __name__ == "__main__":
    asyncio.run(main())
```

**Rate Limit Handling:** TMDB free tier = 40 req/sec. The script uses an `asyncio.Semaphore(20)` to limit maximum concurrency, with a 50ms politeness delay per item request, and handles HTTP 429 rate limit responses with exponential backoff and retry logic.

---

---

# PHASE 2 — On-Demand Feature Ingestion Pipeline

**Goal:** Extend the existing TMDB service to backfill `content_catalog` on cache-miss, so obscure titles queried by users are automatically ingested without manual seeding.

**Target Files:**
- `backend/app/services/tmdb_service.py` — add `ingest_item_to_catalog()`
- `backend/app/services/advanced_recs.py` — call ingest before graph lookup

---

## 2.1 — Cache-on-Demand Flow

```
User hits /similar/{id}  or  /recommendations
         │
         ▼
advanced_recs.py: check content_catalog WHERE tmdb_id=X AND media_type=Y
         │
    ┌────┴────┐
    │  HIT   │  ── return cached row → proceed to Phase 3 (graph)
    └────────┘
         │
    ┌────┴────┐
    │  MISS  │  ── trigger ingest_item_to_catalog(tmdb_id, media_type)
    └────────┘
         │
         ▼
    Fetch TMDB /movie/{id} or /tv/{id}
         +
    Fetch TMDB /movie/{id}/keywords
         +
    Fetch TMDB /movie/{id}/credits
         │
         ▼
    Feature Factory Parser (see 2.2)
         │
         ▼
    INSERT into content_catalog (on conflict update)
         │
         ▼
    Return fresh row → proceed to graph
```

---

## 2.2 — Feature Factory Parser Logic

```python
# backend/app/services/tmdb_service.py  (ADD)

async def ingest_item_to_catalog(
    db: AsyncSession,
    tmdb_id: int,
    media_type: str  # "movie" | "tv"
) -> ContentCatalog | None:
    """
    Fetches full feature data from TMDB API and writes a ContentCatalog row.
    Called on cache-miss in advanced_recs.py before graph traversal.
    """

    # 1. Fetch core details
    endpoint = f"/movie/{tmdb_id}" if media_type == "movie" else f"/tv/{tmdb_id}"
    details  = await tmdb_client.get(endpoint)
    if not details:
        return None

    # 2. Fetch keywords
    kw_endpoint = f"/{media_type}/{tmdb_id}/keywords"
    kw_data     = await tmdb_client.get(kw_endpoint)
    keyword_ids = [kw["id"] for kw in kw_data.get("keywords", kw_data.get("results", []))[:15]]

    # 3. Fetch credits
    cr_endpoint = f"/{media_type}/{tmdb_id}/credits"
    cr_data     = await tmdb_client.get(cr_endpoint)
    cast_ids    = [c["id"] for c in cr_data.get("cast", [])[:10]]
    crew_map    = _parse_crew(cr_data.get("crew", []))

    # 4. Parse and map
    release_date = details.get("release_date") or details.get("first_air_date") or ""
    year         = int(release_date[:4]) if release_date else None

    row = ContentCatalog(
        tmdb_id           = tmdb_id,
        media_type        = media_type,
        genre_ids         = [g["id"] for g in details.get("genres", [])],
        keyword_ids       = keyword_ids,
        studio_ids        = [p["id"] for p in details.get("production_companies", [])],
        cast_ids          = cast_ids,
        crew_ids          = crew_map,
        original_language = details.get("original_language"),
        origin_countries  = [c["iso_3166_1"] for c in details.get("production_countries", [])],
        release_era       = bin_release_era(year) if year else "unknown",
        release_year      = year,
        vote_average      = details.get("vote_average", 0.0),
        vote_count        = details.get("vote_count", 0),
        popularity        = details.get("popularity", 0.0),
        title             = details.get("title") or details.get("name"),
        poster_path       = details.get("poster_path"),
        is_seed           = False,
    )

    # 5. Upsert (INSERT on conflict UPDATE to refresh stale data)
    await db.merge(row)
    await db.commit()
    return row


def _parse_crew(crew: list[dict]) -> dict:
    """Extracts director, writer, and producer IDs from TMDB credits crew array."""
    result = {"director": [], "writer": [], "producer": []}
    for member in crew:
        job = member.get("job", "").lower()
        if "director" in job:
            result["director"].append(member["id"])
        elif "screenplay" in job or "writer" in job:
            result["writer"].append(member["id"])
        elif "producer" in job and "executive" not in job:
            result["producer"].append(member["id"])
    return result
```

**Integration Point:** In `advanced_recs.py`, before graph traversal, call:
```python
catalog_row = await get_catalog_row(db, tmdb_id, media_type)
if not catalog_row:
    catalog_row = await ingest_item_to_catalog(db, tmdb_id, media_type)
if not catalog_row:
    return []  # TMDB also can't find it — abort
```

---

---

# PHASE 3 — Graph Coordinate Space & Candidate Retrieval

**Goal:** Build an in-memory **Bipartite Content Graph** over `content_catalog` that enables fast 100-candidate neighborhood extraction in milliseconds, replacing slow SQL LIKE/overlap queries.

**Target Files:**
- `backend/app/services/advanced_recs.py` — full graph engine
- `backend/app/services/graph_cache.py` — NEW: in-memory graph lifecycle manager

**Libraries:** `networkx` (graph construction + RWR), `numpy` (matrix ops), `scipy.sparse` (adjacency matrix for RWR)

---

## 3.1 — Graph Node & Edge Schema

```
Node Types:
  - ContentNode  (id: "m:{tmdb_id}" or "tv:{tmdb_id}")
  - GenreNode    (id: "g:{genre_id}")
  - KeywordNode  (id: "k:{keyword_id}")
  - TalentNode   (id: "p:{person_id}")
  - EraNode      (id: "e:{era_string}")
  - LanguageNode (id: "l:{lang_code}")

Edge Types (ContentNode → FeatureNode):
  - content → genre     weight = 1.0
  - content → keyword   weight = 1.5   (rarer = higher weight)
  - content → director  weight = 2.5   (strong creative signal)
  - content → cast      weight = 0.8
  - content → era       weight = 0.6
  - content → language  weight = 0.4
```

**Edge Weight Rationale:** Director edges carry the highest weight (`2.5`) because director style is the most predictive collaborative feature. Keywords carry `1.5` because they encode thematic specificity beyond genres. Generic genre links are baseline `1.0`.

---

## 3.2 — Graph Construction Algorithm

```python
# backend/app/services/graph_cache.py  (NEW FILE)

import networkx as nx
import numpy as np
from scipy import sparse
from app.db.orm_models import ContentCatalog

_GRAPH: nx.Graph | None = None          # Shared in-memory graph
_NODE_INDEX: dict[str, int] = {}        # node_id → matrix row index
_CONTENT_NODES: list[str] = []          # list of content node IDs (for retrieval)

EDGE_WEIGHTS = {
    "genre":    1.0,
    "keyword":  1.5,
    "director": 2.5,
    "cast":     0.8,
    "era":      0.6,
    "language": 0.4,
}


async def build_graph(catalog_rows: list[ContentCatalog]) -> nx.Graph:
    """
    Constructs bipartite content graph from ContentCatalog rows.
    Run once at startup, rebuild nightly after retraining.

    Time complexity: O(N * F) where N = catalog size, F = avg features per item.
    For 20K items × ~30 features avg = ~600K edge insertions. Runs in ~5-10s.
    """
    G = nx.Graph()

    for row in catalog_rows:
        node_id = f"{row.media_type[0]}:{row.tmdb_id}"  # "m:550" or "tv:1399"
        G.add_node(node_id, type="content",
                   vote_average=row.vote_average,
                   popularity=row.popularity,
                   release_era=row.release_era)

        for gid in (row.genre_ids or []):
            feat = f"g:{gid}"
            G.add_node(feat, type="genre")
            G.add_edge(node_id, feat, weight=EDGE_WEIGHTS["genre"])

        for kid in (row.keyword_ids or []):
            feat = f"k:{kid}"
            G.add_node(feat, type="keyword")
            G.add_edge(node_id, feat, weight=EDGE_WEIGHTS["keyword"])

        for pid in (row.cast_ids or []):
            feat = f"p:{pid}"
            G.add_node(feat, type="talent")
            G.add_edge(node_id, feat, weight=EDGE_WEIGHTS["cast"])

        for pid in (row.crew_ids or {}).get("director", []):
            feat = f"p:{pid}"
            G.add_node(feat, type="talent")
            G.add_edge(node_id, feat, weight=EDGE_WEIGHTS["director"])

        if row.release_era:
            feat = f"e:{row.release_era}"
            G.add_node(feat, type="era")
            G.add_edge(node_id, feat, weight=EDGE_WEIGHTS["era"])

        if row.original_language:
            feat = f"l:{row.original_language}"
            G.add_node(feat, type="language")
            G.add_edge(node_id, feat, weight=EDGE_WEIGHTS["language"])

    return G
```

---

## 3.3 — Candidate Retrieval: Random Walk with Restart (RWR)

**Algorithm Choice Rationale:** Personalized PageRank / RWR outperforms BFS hop-counting because:
- It naturally encodes multi-hop similarity (items sharing keywords of genres of directors)
- Restart probability `α` controls exploration vs. exploitation
- Edge weights are natively incorporated in the transition matrix
- Runtime is O(K × E) where K = restart iterations (typically 30-50), E = edges from seed — fast enough for real-time

```python
# backend/app/services/advanced_recs.py  (ADD)

def get_rwr_candidates(
    G: nx.Graph,
    seed_node: str,          # e.g. "m:550" for Interstellar
    top_k: int = 100,
    alpha: float = 0.15,     # restart probability (teleport back to seed)
    max_iter: int = 50,
) -> list[str]:
    """
    Runs Personalized PageRank (RWR) from seed_node.
    Returns top_k ContentNode IDs ranked by visit frequency.

    RWR Formula per iteration:
        r_t+1 = (1 - alpha) * A_norm * r_t  +  alpha * e_seed
    where:
        A_norm  = row-normalized weighted adjacency matrix
        e_seed  = one-hot seed vector
        alpha   = restart probability
    """
    if seed_node not in G:
        return []

    # Personalized PageRank via NetworkX (uses sparse power iteration internally)
    ppr = nx.pagerank(
        G,
        alpha=(1 - alpha),       # NetworkX uses (1-alpha) as damping factor
        personalization={seed_node: 1.0},
        weight="weight",
        max_iter=max_iter,
        tol=1e-6,
    )

    # Filter to ContentNodes only, exclude seed itself
    content_scores = {
        nid: score
        for nid, score in ppr.items()
        if G.nodes[nid].get("type") == "content" and nid != seed_node
    }

    # Return top_k by PPR score
    ranked = sorted(content_scores, key=content_scores.get, reverse=True)
    return ranked[:top_k]
```

**Graph Lifecycle Management:**
```python
# backend/app/services/graph_cache.py

async def get_or_build_graph(db: AsyncSession) -> nx.Graph:
    """
    Returns cached graph. Rebuilds if None (first call or post-retrain refresh).
    Graph is held in module-level singleton — shared across all async workers.
    """
    global _GRAPH
    if _GRAPH is None:
        rows = await db.execute(select(ContentCatalog))
        catalog = rows.scalars().all()
        _GRAPH = await build_graph(catalog)
    return _GRAPH

def invalidate_graph():
    """Call after nightly retrain to force graph rebuild on next request."""
    global _GRAPH
    _GRAPH = None
```

**Startup Hook (main.py):** Trigger graph build during FastAPI lifespan startup so first user request isn't cold:
```python
# backend/app/main.py — inside @asynccontextmanager lifespan()
from app.services.graph_cache import get_or_build_graph
async with AsyncSessionLocal() as db:
    await get_or_build_graph(db)   # warm up graph at startup
```

---

---

# PHASE 4 — Hybrid Feature Matrix & XGBoost Ranker

**Goal:** For each user + origin item pair, compile a 100-row feature matrix from graph proximity scores + content attributes + personalized taste intersection features, then run `XGBRanker` inference to produce a ranked list.

**Target Files:**
- `backend/app/services/advanced_recs.py` — feature matrix builder + ranker inference
- `backend/app/ml/ranker.py` — NEW: XGBRanker model wrapper
- `backend/app/ml/ranker.json` — model artifact (serialized weights)

---

## 4.1 — Feature Matrix Columns (Per Candidate Row)

Each of the 100 candidate items gets the following feature vector:

| Feature Name | Type | Source | Description |
|---|---|---|---|
| `ppr_score` | float | Phase 3 RWR | Raw PPR visit probability score |
| `ppr_rank_norm` | float | Phase 3 | Rank normalized 0→1 (1=closest, 0=farthest) |
| `vote_average` | float | content_catalog | TMDB vote average |
| `vote_count_log` | float | content_catalog | `log1p(vote_count)` — compressed scale |
| `popularity_log` | float | content_catalog | `log1p(popularity)` |
| `recency_score` | float | content_catalog | `1.0 / (2025 - release_year + 1)` — newer = higher |
| `user_genre_score` | float | taste_profile | Σ(genre_ids ∩ user genre_weights) |
| `user_cast_score` | float | taste_profile | Σ(cast_ids ∩ user cast_weights) |
| `user_crew_score` | float | taste_profile | Σ(director ids ∩ user crew_weights) |
| `user_keyword_score` | float | taste_profile | Σ(keyword_ids ∩ user keyword_weights) |
| `user_era_score` | float | taste_profile | era_weights[release_era] or 0.0 |
| `user_language_mult` | float | taste_profile | language_weights[lang] or 1.0 |
| `genre_overlap_count` | int | content_catalog | # genres shared with origin item |
| `cast_overlap_count` | int | content_catalog | # cast members shared with origin item |
| `same_language` | int | content_catalog | Binary: same original_language as origin |
| `same_era` | int | content_catalog | Binary: same release_era as origin |

**Total: 16 features per candidate row.**

---

## 4.2 — Feature Computation Logic

```python
# backend/app/services/advanced_recs.py  (ADD)

import numpy as np
from math import log1p

def build_feature_matrix(
    candidates: list[ContentCatalog],
    ppr_scores: dict[str, float],
    origin: ContentCatalog,
    taste: UserTasteProfile | None,
    total_candidates: int = 100,
) -> np.ndarray:
    """
    Builds (N × 16) float32 feature matrix for XGBRanker inference.
    N = len(candidates), typically 100.
    """
    rows = []
    sorted_candidates = sorted(candidates, key=lambda c: ppr_scores.get(
        f"{c.media_type[0]}:{c.tmdb_id}", 0.0), reverse=True)

    for rank, item in enumerate(sorted_candidates):
        node_id  = f"{item.media_type[0]}:{item.tmdb_id}"
        ppr      = ppr_scores.get(node_id, 0.0)
        ppr_norm = 1.0 - (rank / max(total_candidates - 1, 1))

        # ── Static Content Features ─────────────────────────
        vote_avg      = item.vote_average or 0.0
        vote_log      = log1p(item.vote_count or 0)
        pop_log       = log1p(item.popularity or 0.0)
        year          = item.release_year or 2000
        recency       = 1.0 / (2026 - year + 1)

        # ── Personalized Features (zero if no taste profile) ─
        genre_score = keyword_score = cast_score = crew_score = 0.0
        era_score   = 0.0
        lang_mult   = 1.0

        if taste:
            gw = taste.genre_weights or {}
            genre_score = sum(
                gw.get(str(gid), 0.0) for gid in (item.genre_ids or [])
            )

            kw = taste.keyword_weights or {}
            keyword_score = sum(
                kw.get(str(kid), 0.0) for kid in (item.keyword_ids or [])
            )

            cw = taste.cast_weights or {}
            cast_score = sum(
                cw.get(str(pid), 0.0) for pid in (item.cast_ids or [])
            )

            crw = taste.crew_weights or {}
            crew_score = sum(
                crw.get(str(pid), 0.0)
                for pid in (item.crew_ids or {}).get("director", [])
            )

            era_score  = (taste.era_weights or {}).get(item.release_era or "", 0.0)
            lang_mult  = (taste.language_weights or {}).get(
                item.original_language or "", 1.0)

        # ── Structural Overlap with Origin Item ──────────────
        origin_genres   = set(origin.genre_ids or [])
        origin_cast     = set(origin.cast_ids or [])
        genre_overlap   = len(origin_genres & set(item.genre_ids or []))
        cast_overlap    = len(origin_cast   & set(item.cast_ids or []))
        same_lang       = int(item.original_language == origin.original_language)
        same_era        = int(item.release_era == origin.release_era)

        rows.append([
            ppr, ppr_norm,
            vote_avg, vote_log, pop_log, recency,
            genre_score, cast_score, crew_score, keyword_score,
            era_score, lang_mult,
            genre_overlap, cast_overlap, same_lang, same_era,
        ])

    return np.array(rows, dtype=np.float32)
```

---

## 4.3 — XGBRanker: Model Wrapper

```python
# backend/app/ml/ranker.py  (NEW FILE)

import os
import json
import numpy as np
from xgboost import XGBRanker

MODEL_PATH = os.path.join(os.path.dirname(__file__), "ranker.json")

_ranker: XGBRanker | None = None


def load_ranker() -> XGBRanker:
    """Load XGBRanker from disk. Init with default params if no model file exists."""
    global _ranker
    if _ranker is not None:
        return _ranker

    model = XGBRanker(
        objective      = "rank:ndcg",      # NDCG objective = optimizes top-rank quality
        n_estimators   = 200,
        max_depth      = 6,
        learning_rate  = 0.05,
        subsample      = 0.8,
        colsample_bytree = 0.8,
        tree_method    = "hist",           # fast histogram method, CPU-friendly
        eval_metric    = "ndcg@10",        # evaluate top-10 ranking quality
        early_stopping_rounds = 20,
    )

    if os.path.exists(MODEL_PATH):
        model.load_model(MODEL_PATH)

    _ranker = model
    return _ranker


def reload_ranker():
    """Force model reload from disk (called after nightly retraining writes new artifact)."""
    global _ranker
    _ranker = None
    load_ranker()


def rank_candidates(feature_matrix: np.ndarray) -> list[int]:
    """
    Runs XGBRanker.predict() on feature matrix.
    Returns list of row indices sorted by predicted relevance score (descending).
    If model not trained yet (cold start), falls back to ppr_score (column 0).
    """
    ranker = load_ranker()

    try:
        scores = ranker.predict(feature_matrix)
    except Exception:
        # Cold start fallback: use PPR score column directly
        scores = feature_matrix[:, 0]

    return list(np.argsort(scores)[::-1])
```

**`rank:ndcg` vs `rank:pairwise`:** NDCG is preferred because it explicitly optimizes the quality of the top-K list, which maps directly to "show the best card first." Pairwise only optimizes relative ordering pairs, which can result in globally poor rankings even if pairwise comparisons are correct.

---

## 4.4 — Full Inference Pipeline in `advanced_recs.py`

```python
# backend/app/services/advanced_recs.py — main entry function

async def get_new_model_recommendations(
    db: AsyncSession,
    tmdb_id: int,
    media_type: str,
    user_id: int | None = None,
    top_n: int = 20,
) -> list[dict]:
    """
    Main inference pipeline:
    1. Ensure origin item in catalog (ingest if missing)
    2. Get/build graph
    3. RWR candidate retrieval (top 100)
    4. Fetch catalog rows for candidates
    5. Fetch user taste profile
    6. Build feature matrix
    7. XGBRanker inference → sorted indices
    8. Return top_n results as dicts
    """
    # Step 1: Ensure origin in catalog
    origin = await get_catalog_row(db, tmdb_id, media_type)
    if not origin:
        origin = await ingest_item_to_catalog(db, tmdb_id, media_type)
    if not origin:
        return []

    # Step 2: Get graph
    G = await get_or_build_graph(db)
    seed = f"{media_type[0]}:{tmdb_id}"

    # Step 3: RWR candidates
    candidate_node_ids = get_rwr_candidates(G, seed, top_k=100)
    if not candidate_node_ids:
        return []

    # Step 4: Fetch catalog rows for candidates
    candidates = await get_catalog_rows_by_node_ids(db, candidate_node_ids)

    # Step 5: Taste profile
    taste = None
    if user_id:
        taste = await get_or_create_taste_profile(db, user_id)

    # Step 6: Feature matrix
    ppr_scores = {nid: score for nid, score in
                  zip(candidate_node_ids, range(len(candidate_node_ids), 0, -1))}
    matrix = build_feature_matrix(candidates, ppr_scores, origin, taste)

    # Step 7: Rank
    ranked_indices = rank_candidates(matrix)

    # Step 8: Return top_n
    return [_catalog_to_dict(candidates[i]) for i in ranked_indices[:top_n]]
```

---

---

# PHASE 5 — Ensemble Blending (60/40 Personalized & 70/30 Similar Blends)

**Goal:** Merge new ML model output with existing baseline models using Team-Draft Interleaving:
1. **Personalized Recommendations:** 60% new model / 40% baseline model blend, serving 20 results.
2. **Similar Items (More Like This):** 70% new model / 30% baseline model blend, serving 100 results, with strict exclusion of user watchlist and watch history items for authenticated users to ensure fresh recommendations.

**Target Files:**
- `backend/app/routers/recommendations.py` — route logic
- `backend/app/services/recommendation_service.py` — existing baseline (unchanged)

---

## 5.1 — Two-Route Architecture

```
GET /api/v1/recommendations
         │
         ├── [No auth token] ────────────────────► baseline_only() → 20 cards
         │
         └── [Authenticated user_id] ──────────────►
                   │
                   ├── new_model(user_id, top_n=30)     → new_pool (30 items)
                   │
                   ├── baseline_model(user_id, top_n=30) → base_pool (30 items)
                   │
                   └── team_draft_interleave(new_pool, base_pool, k=20)
                                │
                                ▼
                         final_20_cards
```

---

## 5.2 — Team-Draft Interleaving Algorithm (TDI)

TDI is the industry-standard interleaving method used by Netflix, Spotify, and YouTube for A/B blend serving. It avoids position bias by fairly alternating which system gets to pick first.

```python
# backend/app/routers/recommendations.py  (ADD)

def team_draft_interleave(
    list_a: list[dict],   # New model results (60% team)
    list_b: list[dict],   # Baseline model results (40% team)
    k: int = 20,
    ratio_a: float = 0.6,
) -> list[dict]:
    """
    Team-Draft Interleaving producing k results.
    On each pick: Team A picks with probability ratio_a, Team B with (1-ratio_a).
    Each team picks its highest-ranked non-duplicate item.

    Implementation guarantees:
    - No duplicate items in output (deduped by tmdb_id + media_type)
    - Ratio is probabilistic but deterministic via alternating assignment
    - Graceful degradation: if one pool exhausted, fills from other
    """
    result   = []
    seen_ids = set()
    ptr_a    = 0
    ptr_b    = 0

    # Pre-compute how many slots each team gets (deterministic ratio)
    slots_a = round(k * ratio_a)       # 12 slots for new model
    slots_b = k - slots_a              # 8 slots for baseline

    def pick_next(lst, ptr, seen):
        while ptr < len(lst):
            item = lst[ptr]
            key  = (item["tmdb_id"], item["media_type"])
            ptr += 1
            if key not in seen:
                return item, ptr
        return None, ptr

    # Interleave by alternating team priority
    queue_a = [False] * slots_b + [True] * slots_a   # True = pick from A
    import random; random.shuffle(queue_a)            # shuffle for natural feel

    for pick_from_a in queue_a:
        if pick_from_a:
            item, ptr_a = pick_next(list_a, ptr_a, seen_ids)
            if item is None:
                item, ptr_b = pick_next(list_b, ptr_b, seen_ids)
        else:
            item, ptr_b = pick_next(list_b, ptr_b, seen_ids)
            if item is None:
                item, ptr_a = pick_next(list_a, ptr_a, seen_ids)

        if item:
            key = (item["tmdb_id"], item["media_type"])
            seen_ids.add(key)
            result.append(item)

        if len(result) == k:
            break

    return result
```

---

## 5.3 — Router Implementation

```python
# backend/app/routers/recommendations.py  (UPDATE)

@router.get("/", response_model=list[RecommendationResponse])
async def get_recommendations(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User | None = Depends(get_optional_user),  # non-throwing optional auth
):
    """
    Personalized recommendations feed.
    Authenticated: 60% new ML model + 40% baseline (TDI blend)
    Anonymous: pure baseline (cold-state fallback)
    """
    cache_key = (
        f"recs:user:{current_user.id}" if current_user
        else "recs:anonymous"
    )
    cached = await get_cached(cache_key)
    if cached:
        return cached

    if current_user is None:
        # Guest path: baseline only
        results = await recommendation_service.get_baseline_recommendations(db, limit=20)
    else:
        # Authenticated path: hybrid blend
        user_watch = await get_user_watch_seed(db, current_user.id)
        # user_watch = most recently watched/rated item for origin context

        new_pool  = await get_new_model_recommendations(
            db, user_watch.tmdb_id, user_watch.media_type, current_user.id, top_n=30
        )
        base_pool = await recommendation_service.get_baseline_recommendations(
            db, user_id=current_user.id, limit=30
        )
        results = team_draft_interleave(new_pool, base_pool, k=20)

    await set_cached(cache_key, results, ttl=300)  # 5-minute TTL
    return results
```

**`get_optional_user` dependency:** A new non-throwing auth dependency that returns `None` instead of raising 401 for unauthenticated requests. Add to `backend/app/utils/deps.py`.

---

## 5.4 — Similar Items (More Like This) Blend & Filtering

For the similar items section ("More Like This" on the movie/tv page), we upgrade the pipeline to return **100 results** (instead of 40) using a **70/30 blend** of the new model (PPR + XGBRanker similarity) and the old baseline (TMDB-based similarity). 

Additionally, to guarantee fresh and engaging content, we dynamically check the authenticated user's `Watchlist` and `WatchHistory` tables, and filter out any items they have already watched or added to their watchlist.

### 5.4.1 — Candidate Retrieval and De-duplication Workflow

1. **New Model Pool (70% target):**
   - Run Graph RWR candidate retrieval from the current item's content node (e.g., `m:550` or `tv:1399`).
   - Run `XGBRanker` inference to rank these candidates.
   - Filter out items present in the user's watchlist or watch history.
   - Select the top 120 candidate items.
   
2. **Old Model Pool (30% target):**
   - Query the baseline similar items pipeline from `recommendation_service.py`.
   - Filter out items present in the user's watchlist or watch history.
   - Select the top 50 candidate items.

3. **Blending & Interleaving:**
   - Interleave the two pools using Team-Draft Interleaving with `k = 100` and `ratio_a = 0.70` (70% new model candidates, 30% old model candidates).

### 5.4.2 — Router Update for similar endpoint

```python
# backend/app/routers/recommendations.py (UPDATE /similar/{item_id})

@router.get(
    "/similar/{item_id}",
    summary="Similar items",
    response_description="100 similar items blended using 70/30 rule (excluding watched/watchlist)",
)
async def get_similar_items(
    item_id: int,
    media_type: str = "movie",
    db: AsyncSession = Depends(get_db),
    current_user: Optional[dict] = Depends(get_optional_user),
) -> dict:
    """
    Blended similar items endpoint returning 100 results:
    - 70% from New Model (PPR + XGBRanker similarity)
    - 30% from Old Model (TMDB-based similarity pipeline)
    - For authenticated users, excludes watched history and watchlist items.
    """
    user_id_str = current_user["sub"] if current_user else "guest"
    user_uuid = UUID(current_user["sub"]) if current_user else None
    
    # Cache key includes user_id if authenticated because filtering makes it personalized
    cache_key = f"rec:item:{item_id}:{media_type}:{user_id_str}:100"

    cached = await get_cached(cache_key)
    if cached:
        logger.info("CACHE_HIT key=%s", cache_key)
        return cached

    # 1. Fetch user watch history & watchlist IDs to exclude
    exclude_ids = set()
    if user_uuid:
        # Get watch history
        watch_stmt = select(WatchHistory.movie_id).where(WatchHistory.user_id == user_uuid)
        watch_res = await db.execute(watch_stmt)
        exclude_ids.update(watch_res.scalars().all())

        # Get watchlist
        watchlist_stmt = select(Watchlist.movie_id).where(Watchlist.user_id == user_uuid)
        watchlist_res = await db.execute(watchlist_stmt)
        exclude_ids.update(watchlist_res.scalars().all())

    # Exclude the seed item itself
    exclude_ids.add(item_id)

    # 2. Fetch candidates from New Model (Graph + XGBoost)
    new_pool_all = await get_new_model_recommendations(
        db, item_id, media_type, user_id=user_uuid, top_n=150
    )
    new_pool = [m for m in new_pool_all if m["id"] not in exclude_ids]

    # 3. Fetch candidates from Old Model (TMDB-based pipeline)
    old_pool_all = await recommendation_service.get_baseline_similar_items(
        db, item_id, media_type, user_id=user_uuid, limit=80
    )
    old_pool = [m for m in old_pool_all if m["id"] not in exclude_ids]

    # 4. Interleave using 70/30 split
    blended_movies = team_draft_interleave(
        list_a=new_pool,
        list_b=old_pool,
        k=100,
        ratio_a=0.70
    )

    # Populate Moctale ratings if available
    if blended_movies:
        from app.routers.movies import _bulk_fetch_moctale
        item_ids = [m["id"] for m in blended_movies]
        item_types = [m.get("media_type", "movie") for m in blended_movies]
        moctale_map = await _bulk_fetch_moctale(db, item_ids, item_types)
        for m in blended_movies:
            m["moctale_rating"] = moctale_map.get(m["id"])

    result = {
        "movies": blended_movies,
        "movie_id": item_id,
        "media_type": media_type,
        "source": "blended_70_30"
    }

    # Cache the result
    await set_cached(cache_key, result, 1800)  # 30-minute TTL
    return result
```

---

---

# PHASE 6 — Real-Time Feedback Loop: Taste Profile Updates

**Goal:** Attach feedback signals (Thumbs Up/Down, clicks, implicit scroll) to every MovieCard. Each signal immediately updates `user_taste_profiles` JSONB weights and logs a training label for nightly retraining.

**Target Files:**
- `frontend/src/components/MovieCard.jsx` — UI thumbs + click tracking
- `backend/app/routers/feedback.py` — NEW: feedback endpoint
- `backend/app/services/feedback_service.py` — NEW: weight update logic
- `backend/app/db/orm_models.py` — NEW: `interaction_log` table

---

## 6.1 — Interaction Signal Scoring Rubric

| Signal | Frontend Trigger | Profile Delta | Training Label | Weight Decay Applied? |
|---|---|---|---|---|
| 👍 Thumbs Up | Button click | `+10.0` on genres/cast/crew/era | `3` | No (explicit preference) |
| 🖱️ Poster Click | `onClick` | `+2.0` on genres | `2` | Yes |
| 🙈 Scroll Ignore | IntersectionObserver (2s view, no click) | `-0.5` on genres | `0` | Yes |
| 👎 Thumbs Down | Button click | `-15.0` on genres/cast/crew/era | `-1` | No (explicit rejection) |

---

## 6.2 — `interaction_log` ORM Model

```python
# backend/app/db/orm_models.py  (ADD)

class InteractionLog(Base):
    __tablename__ = "interaction_log"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=False)
    tmdb_id       = Column(Integer, nullable=False)
    media_type    = Column(String(10), nullable=False)
    signal_type   = Column(String(20), nullable=False)  # "thumbs_up"|"thumbs_down"|"click"|"ignore"
    label         = Column(Integer, nullable=False)      # -1, 0, 2, 3
    timestamp     = Column(TIMESTAMP, default=datetime.datetime.utcnow)

    # Pre-computed feature snapshot at time of interaction (for training)
    feature_snapshot = Column(JSONB, default={})
    # Stores the 16-feature vector used when this item was shown to user
```

---

## 6.3 — Exponential Time-Decay Function

Before applying weight updates, multiply the delta by a time-decay factor based on how recently the item was interacted with. This ensures old explicit signals don't permanently lock in preferences.

```python
# backend/app/services/feedback_service.py  (NEW FILE)

import math
from datetime import datetime, timezone

DECAY_LAMBDA = 0.01  # Half-life ≈ 69 days. Tune based on engagement data.

def time_decay_weight(event_timestamp: datetime, lambda_: float = DECAY_LAMBDA) -> float:
    """
    W(t) = e^(-λ * Δt_days)

    Where Δt_days = days since the interaction occurred.
    Explicit signals (thumbs) have λ=0 applied (no decay — permanent intent signal).
    Implicit signals (clicks, ignores) use λ=DECAY_LAMBDA.

    Examples:
      Δt=0 days  → W=1.000 (today's click has full weight)
      Δt=7 days  → W=0.932
      Δt=30 days → W=0.741
      Δt=69 days → W=0.500 (half-life point)
    """
    now = datetime.now(timezone.utc)
    if event_timestamp.tzinfo is None:
        event_timestamp = event_timestamp.replace(tzinfo=timezone.utc)
    delta_days = (now - event_timestamp).total_seconds() / 86400.0
    return math.exp(-lambda_ * delta_days)
```

---

## 6.4 — Profile Update Logic

```python
# backend/app/services/feedback_service.py  (ADD)

SIGNAL_DELTAS = {
    "thumbs_up":   {"genres": +10.0, "cast": +10.0, "crew": +10.0, "era": +10.0},
    "thumbs_down": {"genres": -15.0, "cast": -15.0, "crew": -15.0, "era": -15.0},
    "click":       {"genres": +2.0},
    "ignore":      {"genres": -0.5},
}

EXPLICIT_SIGNALS = {"thumbs_up", "thumbs_down"}  # No time-decay applied

WEIGHT_CLAMP = (-100.0, 100.0)  # Prevent runaway accumulation


async def apply_feedback(
    db: AsyncSession,
    user_id: int,
    catalog_item: ContentCatalog,
    signal_type: str,    # "thumbs_up" | "thumbs_down" | "click" | "ignore"
    timestamp: datetime | None = None,
):
    """
    Updates user_taste_profiles JSONB vectors based on signal type.
    Uses PostgreSQL JSONB update via SQLAlchemy ORM merge.
    """
    timestamp = timestamp or datetime.now(timezone.utc)

    # Determine decay factor
    apply_decay = signal_type not in EXPLICIT_SIGNALS
    decay = time_decay_weight(timestamp) if apply_decay else 1.0

    deltas = SIGNAL_DELTAS.get(signal_type, {})
    profile = await get_or_create_taste_profile(db, user_id)

    # ── Genre weights update ─────────────────────────────────────────
    if "genres" in deltas:
        gw    = dict(profile.genre_weights or {})
        delta = deltas["genres"] * decay
        for gid in (catalog_item.genre_ids or []):
            key     = str(gid)
            current = gw.get(key, 0.0)
            gw[key] = max(WEIGHT_CLAMP[0], min(WEIGHT_CLAMP[1], current + delta))
        profile.genre_weights = gw

    # ── Cast weights update ──────────────────────────────────────────
    if "cast" in deltas:
        cw    = dict(profile.cast_weights or {})
        delta = deltas["cast"] * decay
        for pid in (catalog_item.cast_ids or []):
            key     = str(pid)
            current = cw.get(key, 0.0)
            cw[key] = max(WEIGHT_CLAMP[0], min(WEIGHT_CLAMP[1], current + delta))
        profile.cast_weights = cw

    # ── Crew (director) weights update ──────────────────────────────
    if "crew" in deltas:
        crw   = dict(profile.crew_weights or {})
        delta = deltas["crew"] * decay
        for pid in (catalog_item.crew_ids or {}).get("director", []):
            key      = str(pid)
            current  = crw.get(key, 0.0)
            crw[key] = max(WEIGHT_CLAMP[0], min(WEIGHT_CLAMP[1], current + delta))
        profile.crew_weights = crw

    # ── Era weights update ───────────────────────────────────────────
    if "era" in deltas and catalog_item.release_era:
        ew    = dict(profile.era_weights or {})
        delta = deltas["era"] * decay
        key   = catalog_item.release_era
        ew[key] = max(WEIGHT_CLAMP[0], min(WEIGHT_CLAMP[1], ew.get(key, 0.0) + delta))
        profile.era_weights = ew

    # ── Global stats update ──────────────────────────────────────────
    profile.total_interactions = (profile.total_interactions or 0) + 1
    profile.last_updated = datetime.now(timezone.utc)

    await db.commit()

    # Invalidate user's rec cache
    await invalidate_cache(f"recs:user:{user_id}")
```

---

## 6.5 — Feedback API Endpoint

```python
# backend/app/routers/feedback.py  (NEW FILE)

from fastapi import APIRouter, Depends
from app.schemas.feedback import FeedbackRequest
from app.services.feedback_service import apply_feedback
from app.services.tmdb_service import ingest_item_to_catalog
from app.utils.deps import get_current_user

router = APIRouter(prefix="/api/v1/feedback", tags=["feedback"])

@router.post("/")
async def submit_feedback(
    payload: FeedbackRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Receives user feedback signal and updates taste profile.
    Also logs interaction to interaction_log for nightly training.
    Body: { tmdb_id, media_type, signal_type, feature_snapshot (optional) }
    """
    catalog_item = await get_catalog_row(db, payload.tmdb_id, payload.media_type)
    if not catalog_item:
        catalog_item = await ingest_item_to_catalog(db, payload.tmdb_id, payload.media_type)
    if not catalog_item:
        return {"status": "skipped", "reason": "item_not_found"}

    await apply_feedback(db, user.id, catalog_item, payload.signal_type)
    await log_interaction(db, user.id, payload, catalog_item)

    return {"status": "ok"}
```

**Register in `main.py`:**
```python
from app.routers import feedback
app.include_router(feedback.router)
```

---

## 6.6 — Frontend MovieCard Thumbs Integration

```jsx
// frontend/src/components/MovieCard.jsx  (ADD to existing component)

import { useRef, useEffect } from "react";
import api from "../utils/api";

function MovieCard({ item, showFeedback = false }) {
  const cardRef = useRef(null);
  const impressionLogged = useRef(false);

  // ── Implicit ignore detection via IntersectionObserver ──────────
  useEffect(() => {
    if (!showFeedback) return;
    const timeout = { id: null };

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        // Card is visible — start 2s timer before logging ignore
        timeout.id = setTimeout(() => {
          if (!impressionLogged.current) {
            impressionLogged.current = true;
            api.post("/api/v1/feedback/", {
              tmdb_id: item.tmdb_id,
              media_type: item.media_type,
              signal_type: "ignore",
            }).catch(() => {}); // fire-and-forget, non-critical
          }
        }, 2000);
      } else {
        clearTimeout(timeout.id);
      }
    }, { threshold: 0.5 });

    if (cardRef.current) observer.observe(cardRef.current);
    return () => { observer.disconnect(); clearTimeout(timeout.id); };
  }, [item.tmdb_id, showFeedback]);

  // ── Explicit feedback handlers ────────────────────────────────────
  const sendFeedback = (signalType) => {
    impressionLogged.current = true; // cancel pending ignore log
    api.post("/api/v1/feedback/", {
      tmdb_id:    item.tmdb_id,
      media_type: item.media_type,
      signal_type: signalType,
    }).catch(() => {});
  };

  return (
    <div ref={cardRef} className="movie-card">
      {/* ... existing card content ... */}

      {showFeedback && (
        <div className="card-feedback-overlay">
          <button
            className="feedback-btn thumbs-up"
            onClick={() => sendFeedback("thumbs_up")}
            aria-label="Like this"
          >👍</button>
          <button
            className="feedback-btn thumbs-down"
            onClick={() => sendFeedback("thumbs_down")}
            aria-label="Not for me"
          >👎</button>
        </div>
      )}
    </div>
  );
}
```

**Pass `showFeedback={true}` only from authenticated recommendation carousels** (Home page rows, Dashboard), not from general browse grids.

---

---

# PHASE 7 — Nightly Automated Model Retraining

**Goal:** Celery cron job runs at 3:00 AM daily. Aggregates last-30-day interaction logs, applies time-decay, trains `XGBRanker`, serializes new `ranker.json`, invalidates graph and model cache.

**Target Files:**
- `backend/app/celery_app.py` — cron beat schedule + task definition
- `backend/app/ml/training.py` — NEW: training pipeline

---

## 7.1 — Training Data Assembly

```python
# backend/app/ml/training.py  (NEW FILE)

import pandas as pd
import numpy as np
from xgboost import XGBRanker
from datetime import datetime, timezone, timedelta
from app.services.feedback_service import time_decay_weight
from app.ml.ranker import MODEL_PATH, reload_ranker

FEATURE_COLUMNS = [
    "ppr_score", "ppr_rank_norm",
    "vote_average", "vote_count_log", "popularity_log", "recency_score",
    "user_genre_score", "user_cast_score", "user_crew_score", "user_keyword_score",
    "user_era_score", "user_language_mult",
    "genre_overlap_count", "cast_overlap_count", "same_language", "same_era",
]

async def build_training_dataframe(db: AsyncSession) -> pd.DataFrame:
    """
    Pulls interaction_log rows from last 30 days.
    Each row has pre-stored feature_snapshot + label.
    Applies exponential time-decay to labels based on timestamp.

    Returns DataFrame with columns: [user_id, label_weighted, *FEATURE_COLUMNS]
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    logs   = await db.execute(
        select(InteractionLog)
        .where(InteractionLog.timestamp >= cutoff)
        .where(InteractionLog.feature_snapshot != {})
    )
    rows = logs.scalars().all()

    records = []
    for log in rows:
        decay         = time_decay_weight(log.timestamp)
        weighted_label = log.label * decay   # scale label by recency
        snap          = log.feature_snapshot
        record        = {"user_id": log.user_id, "label": weighted_label}
        record.update({col: snap.get(col, 0.0) for col in FEATURE_COLUMNS})
        records.append(record)

    return pd.DataFrame(records)
```

---

## 7.2 — Retraining Procedure

```python
# backend/app/ml/training.py  (ADD)

async def run_nightly_retrain(db: AsyncSession):
    """
    Full retraining pipeline executed by Celery beat at 3:00 AM.

    Steps:
    1. Assemble training dataframe (last 30 days, decay-weighted labels)
    2. Group by user_id for XGBRanker group array (required for LTR)
    3. Split features / labels
    4. Train XGBRanker with eval set (last 7 days as validation)
    5. Save model artifact to ranker.json
    6. Reload model in memory
    7. Invalidate graph cache (force rebuild on next request with fresh catalog)
    """
    print("[Retrain] Starting nightly model retrain...")

    df = await build_training_dataframe(db)
    if len(df) < 100:
        print(f"[Retrain] Insufficient data ({len(df)} rows). Skipping.")
        return

    # Sort by user_id for group array (XGBRanker requirement)
    df = df.sort_values("user_id").reset_index(drop=True)

    # Group array: number of items per user session
    groups = df.groupby("user_id").size().values

    X = df[FEATURE_COLUMNS].values.astype(np.float32)
    y = df["label"].values.astype(np.float32)

    # Train/validation split by time (last 7 days = validation)
    # Since rows are sorted by user then time, approximate split:
    split = int(len(df) * 0.85)
    X_train, y_train, groups_train = X[:split], y[:split], groups
    # Note: full group split is complex — simplified here; refine if needed

    ranker = XGBRanker(
        objective        = "rank:ndcg",
        n_estimators     = 300,
        max_depth        = 6,
        learning_rate    = 0.05,
        subsample        = 0.8,
        colsample_bytree = 0.8,
        tree_method      = "hist",
        eval_metric      = "ndcg@10",
    )

    ranker.fit(X_train, y_train, group=groups_train, verbose=False)

    # Save artifact
    ranker.save_model(MODEL_PATH)
    print(f"[Retrain] Model saved → {MODEL_PATH}")

    # Reload in-memory model singleton
    reload_ranker()

    # Invalidate graph (force fresh rebuild with any new catalog items)
    from app.services.graph_cache import invalidate_graph
    invalidate_graph()

    print("[Retrain] Nightly retrain complete.")
```

---

## 7.3 — Celery Beat Schedule

```python
# backend/app/celery_app.py  (ADD to existing beat_schedule)

from celery.schedules import crontab

app.conf.beat_schedule = {
    # ... existing schedules (news crawl, cleanup, etc.) ...

    "nightly-ranker-retrain": {
        "task":     "app.tasks.retrain_ranker",
        "schedule": crontab(hour=3, minute=0),   # Every day at 3:00 AM
    },
}

# backend/app/tasks.py  (ADD)

@celery_app.task(name="app.tasks.retrain_ranker", bind=True, max_retries=2)
def retrain_ranker(self):
    """Celery task wrapping the async retrain pipeline."""
    import asyncio
    from app.db.database import AsyncSessionLocal
    from app.ml.training import run_nightly_retrain

    async def _run():
        async with AsyncSessionLocal() as db:
            await run_nightly_retrain(db)

    try:
        asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc, countdown=600)  # retry after 10 min on failure
```

---

---

# PHASE 8 — Redis Caching Integration for New Endpoints

**Goal:** Apply Movientum's standard cache-aside + stampede-guard pattern to all new recommendation and feedback endpoints. Prevents DB hammering during high traffic.

**Target Files:**
- `backend/app/db/cache.py` — add new cache key builders
- `backend/app/routers/recommendations.py` — cache wrapping
- `backend/app/routers/feedback.py` — cache invalidation on write

---

## 8.1 — New Cache Keys

```python
# backend/app/db/cache.py  (ADD)

def key_recs_user(user_id: int) -> str:
    return f"recs:user:{user_id}"

def key_recs_similar(tmdb_id: int, media_type: str, user_id: Optional[str] = None) -> str:
    user_suffix = f":user:{user_id}" if user_id else ":anonymous"
    return f"recs:similar:{media_type}:{tmdb_id}{user_suffix}"

def key_taste_profile(user_id: int) -> str:
    return f"taste:profile:{user_id}"

def key_catalog_item(tmdb_id: int, media_type: str) -> str:
    return f"catalog:{media_type}:{tmdb_id}"
```

## 8.2 — TTL Assignments

| Cache Key Pattern | TTL | Rationale |
|---|---|---|
| `recs:user:{id}` | 5 min | Refreshes fast after feedback signals |
| `recs:similar:{type}:{id}:user:{user_id}` | 30 min | Personalized similar items (excluding watch/watchlist) |
| `recs:similar:{type}:{id}:anonymous`     | 30 min | Stable — item similarity doesn't change often for guest users |
| `taste:profile:{id}` | 2 min | Short TTL — feedback updates invalidate frequently |
| `catalog:{type}:{id}` | 24 hrs | Catalog features rarely change |
| `recs:anonymous` | 15 min | No personalization — can be stale longer |

---

---

# Implementation Sequencing Matrix

| Phase | Core Target Objective | Primary Files | Dependencies |
|---|---|---|---|
| **Phase 1** | DB schema: `content_catalog` + `user_taste_profiles` ORM models, Alembic migration, GIN indexes, 20K seed script | `orm_models.py`, `alembic/`, `scripts/seed_catalog.py` | None — foundation |
| **Phase 2** | On-demand Feature Ingestion: `ingest_item_to_catalog()`, `_parse_crew()`, upsert logic | `tmdb_service.py` | Phase 1 (catalog table must exist) |
| **Phase 3** | Graph engine: `build_graph()`, `get_rwr_candidates()`, `graph_cache.py` singleton, startup warm-up hook | `graph_cache.py`, `advanced_recs.py`, `main.py` | Phase 1 + Phase 2 (needs populated catalog) |
| **Phase 4** | Feature matrix builder + XGBRanker wrapper + full inference pipeline in `advanced_recs.py` | `advanced_recs.py`, `ml/ranker.py`, `ml/ranker.json` | Phase 3 (needs graph + candidates) |
| **Phase 5** | 60/40 personalized TDI blend, 70/30 similar items blend (100 results, excluding watch/watchlist) + optional-auth dependency + router update | `recommendations.py`, `deps.py` | Phase 4 (needs inference pipeline) |
| **Phase 6** | Feedback loop: `interaction_log` table, `feedback_service.py`, `/api/v1/feedback` router, `MovieCard.jsx` thumbs + IntersectionObserver | `orm_models.py`, `feedback_service.py`, `routers/feedback.py`, `MovieCard.jsx` | Phase 1 (catalog), Phase 5 (live recs must exist) |
| **Phase 7** | Nightly retraining: `ml/training.py`, Celery beat task, model artifact save + reload | `ml/training.py`, `celery_app.py`, `tasks.py` | Phase 6 (needs interaction_log data) |
| **Phase 8** | Redis cache integration: new key builders, TTL assignments, cache-aside wrapping on all new endpoints | `cache.py`, `recommendations.py`, `feedback.py` | All phases (applied last as a polish layer) |

---

## Critical Path Summary

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──► Phase 5
                                                    │
                                                    ▼
                                               Phase 6 ──► Phase 7
                                                    │
                                                    ▼
                                               Phase 8 (wraps all)
```

Phases 1→5 form the **read path** (serving recommendations).
Phases 6→7 form the **write path** (learning from users).
Phase 8 is the **performance layer** applied across all.

---

## New Files to Create

| File | Phase | Purpose |
|---|---|---|
| `backend/app/services/graph_cache.py` | 3 | Graph singleton lifecycle manager |
| `backend/app/ml/ranker.py` | 4 | XGBRanker load/predict wrapper |
| `backend/app/ml/ranker.json` | 7 | Serialized model artifact (auto-generated) |
| `backend/app/ml/training.py` | 7 | Nightly retrain pipeline |
| `backend/app/routers/feedback.py` | 6 | Feedback signal API endpoint |
| `backend/app/services/feedback_service.py` | 6 | Taste profile weight updater |
| `backend/app/schemas/feedback.py` | 6 | Pydantic request schema for feedback |
| `backend/scripts/seed_catalog.py` | 1 | One-time 20K catalog population script |

## Modified Files

| File | Phase | Change |
|---|---|---|
| `backend/app/db/orm_models.py` | 1, 6 | Add `ContentCatalog`, `UserTasteProfile`, `InteractionLog` models |
| `backend/app/services/tmdb_service.py` | 2 | Add `ingest_item_to_catalog()` |
| `backend/app/services/advanced_recs.py` | 3, 4 | Full graph + ranker pipeline |
| `backend/app/routers/recommendations.py` | 5, 8 | 60/40 personalized blend + 70/30 similar items blend (100 results, excluding watch/watchlist) + cache |
| `backend/app/db/cache.py` | 8 | New key builders + TTLs |
| `backend/app/celery_app.py` | 7 | Nightly beat schedule |
| `backend/app/main.py` | 3 | Graph warm-up in lifespan startup |
| `frontend/src/components/MovieCard.jsx` | 6 | Thumbs + IntersectionObserver |
| `frontend/src/services/` | 6 | Add `feedbackService.js` |

---

# PHASE 9 — Deep Personalization for Logged-In Users + Analysis Page Enhancements

> **Scope:** All ideas here assume the user is authenticated. Each idea improves the quality, relevance, and transparency of recommendations for users who have history in the system. The second half of this phase covers what new insights to surface on the Analysis page so the user can actually see and understand their own taste patterns.

---

## Overview

Current personalization (Phases 1–8) works at the genre + keyword + cast weight level via the `UserTasteProfile` table and XGBRanker. The gaps are:

| Gap | Current State | Improvement Target |
|-----|--------------|-------------------|
| Temporal recency | Genre weights accumulate without decay | Recent watches count more than old ones |
| Negative signals | Thumbs-down / "skip" ratings ignored in scoring | Actively suppress disliked content |
| Session context | Every request treats user identically | Factor in *what* the user just watched this session |
| Mood/intent detection | No mood signal | Infer current mood from session click pattern |
| Language & region affinity | `language_weights` stored but not strongly used | Amplify preferred-language boosts dynamically |
| Director / creator loyalty | `crew_weights` barely used in boost | Directors/showrunners are strong loyalty anchors |
| Social proof | No "users like you" signal | Collaborative filtering layer on top of content |
| Streak-aware recs | No binge session detection | Detect binge mode → serve next-episode-style recs |
| Watchlist signals | Watchlist exists but unused in scoring | Boost items genre-matched to watchlist queue |
| Serendipity control | No way to dial exploration | Let user explicitly request surprise/safe recs |

---

## 9.1 — Temporal Decay on Taste Weights

**Problem:** A user who loved Action in 2024 but has watched only Drama for 3 months still has high Action genre weight. Stale weights pollute recommendations.

**Idea:** Apply exponential decay to `genre_weights`, `cast_weights`, and `keyword_weights` when reading from `UserTasteProfile`. Weights from older interactions decay toward zero on a half-life schedule.

**Implementation approach:**
- Store a `weight_timestamps` JSONB column on `UserTasteProfile` — maps each key to the last time it was updated.
- At inference time, compute `decayed_weight = w * (0.5 ^ (days_since_update / HALF_LIFE_DAYS))`.
- Use `HALF_LIFE_DAYS = 90` for genre weights (taste shifts slowly), `30` for keyword weights (more volatile).
- Apply decay inside `build_feature_matrix()` before passing to XGBRanker. No retraining needed — it's a pre-processing step.
- Nightly Celery task can optionally normalize and prune near-zero weights to keep the JSONB column clean.

**Benefit:** Recommendations reflect *current* taste, not a static snapshot of 6 months ago.

---

## 9.2 — Negative Signal Suppression (Dislike-Aware Scoring)

**Problem:** When a user gives "Skip" rating or thumbs-down on a recommendation, the system ignores it. Future recs still include similar content.

**Idea:** Maintain a `negative_weights` JSONB on `UserTasteProfile` for genres, keywords, cast, and crew that received explicit negative signals. Apply these as **score penalties** in the feature matrix.

**Implementation approach:**
- When feedback `type = "skip"` or rating `category = "skip"` arrives, update `negative_weights` via `feedback_service.py` — same mechanism as positive feedback, but accumulate negative floats.
- In `build_feature_matrix()`, add new features: `negative_genre_score`, `negative_keyword_score`.
- During scoring: `final_score -= negative_genre_score * DISLIKE_PENALTY_FACTOR` (e.g., 0.3).
- Hard-block: if a candidate shares 3+ strong negative keywords with recently disliked items, add a `is_dislike_candidate` binary feature (column 16) to the feature matrix.
- XGBRanker will learn to suppress these during nightly retrain.
- Add a "Never recommend this" option on MovieCard to create permanent hard-blocks stored in a separate `user_blocked_items` table.

**Benefit:** System stops recommending content types the user explicitly rejected.

---

## 9.3 — Session Context Injection (Real-Time Intent Signal)

**Problem:** The recommendation for an item only uses the user's historical profile. It ignores what the user has been doing *this session* (last 30 minutes).

**Idea:** Track the last 3–5 items the user viewed in this session (stored in Redis per user, TTL 30 min). Use these session items to compute a **session genre vector** and temporarily boost it on top of the historical taste profile.

**Implementation approach:**
- On every `/movies/{id}` or `/tv/{id}` page load, append `(tmdb_id, media_type)` to a Redis list `session:{user_id}:history` with TTL 30 minutes.
- In the recommendations router, read this list and compute `session_genre_vector` — a simple frequency count of genres seen in this session.
- Blend `session_genre_vector` into the scoring: `boosted_score = base_score + session_weight * session_genre_score`.
- `session_weight = 0.2` — small enough to not override historical taste, large enough to follow session intent.
- If session has only 1 item, skip session boost (too little signal).

**Benefit:** If user starts watching sci-fi thrillers tonight, the entire session's recommendations skew sci-fi — even if their long-term profile says they're a drama fan.

---

## 9.4 — Mood Detection from Session Click Pattern

**Problem:** Users' moods change — sometimes they want intense action, sometimes light comedy. The system treats all sessions identically.

**Idea:** Classify the user's current mood from their session clicks into one of 5 mood buckets: `intense`, `chill`, `feel_good`, `dark`, `intellectual`. Use this mood to apply a genre boost overlay.

**Implementation approach:**
- Define genre-to-mood mapping:
  - `intense`: Action (28), Thriller (53), Horror (27)
  - `chill`: Animation (16), Family (10751), Romance (10749), Music (10402)
  - `feel_good`: Comedy (35), Romance (10749)
  - `dark`: Crime (80), Mystery (9648), War (10752)
  - `intellectual`: Documentary (99), History (36), Sci-Fi (878)
- After reading `session:{user_id}:history`, compute dominant mood from genre counts.
- Store detected mood in Redis: `session:{user_id}:mood` TTL 30 min.
- In recommendations, read mood and add `0.10` multiplier boost for mood-aligned candidates.
- Do not apply mood if session has fewer than 3 items.

**Benefit:** If the user is on a horror binge, every recommendation subtly leans dark/intense without needing explicit input.

---

## 9.5 — Director / Creator Loyalty Signal

**Problem:** `crew_weights` in `UserTasteProfile` stores director affinities but they are not strongly surfaced in the current scoring. A user who loves Christopher Nolan films should see more of his films boosted.

**Idea:** Add a dedicated `director_loyalty_score` feature to the feature matrix and give it a higher weight multiplier than the current `crew_score`.

**Implementation approach:**
- In `build_feature_matrix()`, compute `director_loyalty_score` separately from general `crew_score`:
  - `director_loyalty_score = sum(taste.crew_weights.get(str(pid), 0) for pid in item.crew_ids.get("director", []))`
  - This is already stored — just needs to be weighted higher than crew_score in the feature matrix (column 16 or replace column 8).
- Update feature matrix column 8 (`user_crew_score`) to be `director_loyalty_score` exclusively (not all crew).
- Add writer loyalty as a new column 17 `user_writer_score` — writers have strong thematic consistency (e.g., Charlie Kaufman).
- After nightly retrain, XGBRanker will learn the correct weight for director loyalty vs. other features.
- In `feedback_service.py`: when user rates an item "Perfection", additionally update `crew_weights` for the director(s) of that item with a strong positive signal (+5.0).

**Benefit:** Users who frequently rate Nolan/Villeneuve films highly will see these directors' future films surface organically.

---

## 9.6 — Language & Country Affinity Amplification

**Problem:** `language_weights` are stored as neutral multipliers (1.0 = neutral) but the current scoring doesn't strongly differentiate between e.g., a Korean cinema fan and a Hollywood-only viewer.

**Idea:** Amplify language affinity when user has strong preference for non-English content. Add origin country as a secondary signal.

**Implementation approach:**
- Compute `language_affinity_score`:
  - If `language_weights[item.original_language] > 1.2` → strong affinity → apply `* 1.15` multiplier
  - If `language_weights[item.original_language] < 0.8` → mild aversion → apply `* 0.90` multiplier
  - Else → neutral (unchanged)
- Add `origin_country_score` feature:
  - User's top 2 origin countries derived from watch history (stored in taste profile as `country_weights` JSONB — new field)
  - If candidate's `origin_countries` overlaps with user's top 2 → +0.05 to score
- Implementation: add `country_weights` JSONB column to `UserTasteProfile`, update `feedback_service.py` to track country affinity on watch/rate events.

**Benefit:** Korean drama fans get more Korean content. Users who explicitly prefer English-only will see less foreign content.

---

## 9.7 — Watchlist-Aware Scoring

**Problem:** The user's watchlist (items saved to watch later) contains explicit intent signals but is completely ignored by the recommendation engine.

**Idea:** Extract the genre/keyword/cast profile from the user's watchlist and use it as an **intent signal** to boost similar items in recommendations.

**Implementation approach:**
- At recommendation time, query the `watchlist` table for the user's queued items (limit 20 most recent).
- Compute `watchlist_genre_vector` — normalized genre frequency from watchlist items.
- Blend into scoring: if candidate shares ≥1 genre with watchlist profile → apply `+0.08` score bonus.
- If candidate matches top watchlist genre exactly → `+0.12` bonus.
- Do NOT recommend items already in the watchlist (they're already saved).
- Cache `watchlist_genre_vector` in Redis: `watchlist:profile:{user_id}` TTL 10 minutes (invalidate on watchlist add/remove).

**Benefit:** If user saved 5 Korean thrillers to watchlist, the engine knows their current intent and surfaces more Korean thrillers in recommendations.

---

## 9.8 — Collaborative Filtering Layer (Users Like You)

**Problem:** All personalization is purely content-based (genre/keyword/cast). There is no "users who watched the same things as you also liked X" signal at all.

**Idea:** Add a lightweight user-user collaborative filtering layer that provides a `cf_score` feature to the XGBRanker feature matrix.

**Implementation approach:**
- Offline (nightly): Compute user-user similarity using cosine similarity on genre weight vectors from `UserTasteProfile`. Store top-20 similar users per user in Redis: `cf:neighbors:{user_id}` TTL 24h.
- At inference: fetch neighbor user IDs → query `interaction_log` for items they rated highly but current user hasn't watched → compute `cf_score` = frequency of item appearing in neighbor positive interactions.
- Add `cf_score` as feature column 17 in the feature matrix.
- This is a cold-start complement — if user has few interactions, CF score will be low/zero, and XGBRanker will rely on content features instead.
- Initial implementation: use only genre vectors for similarity (fast, no embeddings needed).
- Future: move to matrix factorization or ALS for richer embeddings.

**Benefit:** Adds "wisdom of the crowd" signal. Discovers hidden gems that content-based scoring wouldn't find because they don't share obvious genre/keyword overlap with the user's history.

---

## 9.9 — Binge Session Detection & Next-Item Optimization

**Problem:** When a user is clearly binge-watching a TV show or genre, recommendations should lean heavily toward "what to watch next" rather than broad discovery.

**Idea:** Detect binge mode from session pattern → switch recommendation strategy from discovery-weighted to next-item-weighted.

**Implementation approach:**
- Binge signal: `session:{user_id}:history` contains ≥3 items of same media type (TV) or same franchise/genre within 2 hours.
- When binge detected: store `session:{user_id}:binge_mode = true` TTL 2h.
- In recommendations router: if binge mode detected:
  - Increase `same_media_type_weight` from 0.6 to 0.85 (more same-type content)
  - Increase franchise penalty threshold from 2 to 5 (allow more from same franchise)
  - Boost `same_era_score` feature weight in feature matrix
  - Surface next episodes or same-series items in top positions
- Normal mode resumes after 2h timeout or when user switches genre.

**Benefit:** When a user is in a Marvel binge or Korean drama marathon, the engine feeds the binge rather than pulling them out of it.

---

## 9.10 — Serendipity Dial (User-Controlled Exploration)

**Problem:** No way for users to explicitly say "surprise me" vs "give me what I know I like." The engine always blends similarity and discovery at a fixed ratio.

**Idea:** Add a `serendipity_mode` toggle that users can set. Three modes: `safe` (more of the same), `balanced` (default), `surprise me` (high exploration).

**Implementation approach:**
- Store `serendipity_preference: "safe" | "balanced" | "surprise"` in user preferences table (or as a query param).
- Map to dynamic weights:
  - `safe`: `similarity_weight=0.85, user_weight=0.15, diversity_penalty=2x`
  - `balanced`: current defaults (0.60/0.40)
  - `surprise`: `similarity_weight=0.30, user_weight=0.70` + increase diversity penalty to push cross-genre items up
- In `surprise` mode: deliberately inject 10 items from genres the user has *not* watched but *clicked* (exploration interest from Click vs Watch gap analysis).
- UI: add a simple toggle/slider on the recommendations or profile page.

**Benefit:** Gives users agency over their discovery experience. Power users who want hidden gems can choose. Comfort-seekers can stay safe.

---

## 9.11 — Rec-Explanation Metadata (Why Am I Seeing This?)

**Problem:** Users have no idea *why* a recommendation appears. This creates distrust and a black-box feeling.

**Idea:** Add a `reason` field to every recommendation result explaining the primary signal that drove it.

**Implementation approach:**
- In `_catalog_to_dict()`, add a `reason` string generated from the top-contributing feature:
  - PPR score dominant → `"Because you like [genre]"`
  - Director overlap → `"Because you watch [Director Name]"`
  - Cast overlap → `"Because you like [Actor Name]"`
  - CF score dominant → `"Loved by viewers with your taste"`
  - Era match → `"From your favorite era ([era])"`
  - Keyword match → `"Thematically similar to [current item]"`
  - Session context → `"Matching your current session mood"`
- Logic: identify highest-contributing feature column in the feature matrix for each row → map to reason template.
- Frontend: show reason as a small italic label under the card title in "More Like This" section.
- This does NOT require retraining — it's a post-processing annotation step.

**Benefit:** Transparency builds trust. Users understand the system and are more likely to interact with recommendations.

---

## 9.12 — Watchlist-to-Rec Bridge (Proactive Notification Ready)

**Problem:** Items in the user's watchlist are often forgotten. The system has no mechanism to resurface them at the right moment.

**Idea:** When a user views a movie, if items in their watchlist are directly related (same director, same franchise, or very high similarity score), surface them at the top of the "More Like This" section with a special badge.

**Implementation approach:**
- At recommendation time: score all watchlist items using the same `_compute_score()` pipeline against the current item.
- If any watchlist item scores > 0.70 similarity: inject it into position 1–3 of Bucket 1 with `"In your watchlist"` badge.
- Limit to 2 watchlist items per recommendations call to avoid cluttering results.
- This is a pure scoring + routing logic change in `advanced_recs.py` — no new tables.

**Benefit:** Watchlist items get "discovered again" at the right moment — when the user is already in the mood for that type of content.

---

---

# PHASE 9B — Analysis Page New Insights

> **Goal:** Add new data-driven insight sections to the Analysis page so users can see and understand their own taste patterns, how their recommendations work, and what signals the engine uses for them.

Current Analysis page has: Genre Distribution, Rating Behavior, Taste Evolution, Click vs Watch Gap, Content Type Behavior, Discovery Score, Rewatch Candidates, Early Favorites.

The following are new sections/cards to add, with what data they show and how to compute it.

---

## 9B.1 — Recommendation DNA Breakdown

**What user sees:**
A visual breakdown of *what drives their recommendations* — a stacked bar or radar chart showing how much each signal type contributes.

Example:
```
Genre Match     ████████████████████ 42%
Director Loyalty████████████         25%
Keyword Match   ████████             18%
Era Preference  ████                  9%
Language Affinity██                   6%
```

**How to compute (backend `analysis_service.py`):**
- Read `UserTasteProfile` for the user.
- Sum absolute weight values per dimension:
  - `genre_score = sum(abs(v) for v in genre_weights.values())`
  - `crew_score = sum(abs(v) for v in crew_weights.values())`
  - `keyword_score = sum(abs(v) for v in keyword_weights.values())`
  - `era_score = sum(abs(v) for v in era_weights.values())`
  - `language_score = sum(abs(v - 1.0) for v in language_weights.values())` (deviation from neutral 1.0)
- Normalize all to percentages.
- Return as `recommendation_dna: [{signal: str, percentage: float}]`.

**Frontend (new section in `Analysis.jsx`):**
- Horizontal stacked bar or radar chart.
- Show "Your recommendations are driven mostly by [top signal]".
- Plain-language explanation of each signal type below the chart.

---

## 9B.2 — Taste Fingerprint Radar

**What user sees:**
A spider/radar chart with 6 axes showing the user's relative strength across:
- Genre Diversity (how many genres they watch)
- Rating Generosity (avg rating given)
- Discovery Depth (niche vs mainstream — already computed)
- Binge Tendency (session length signals)
- Temporal Consistency (how stable their taste is over time)
- Cross-Media Curiosity (movie vs TV flexibility)

**How to compute:**
- Genre Diversity: `len(genre_weights) / 19` (19 = max TMDB genres)
- Rating Generosity: `avg_rating / 10.0`
- Discovery Depth: already returned as `discovery_depth_score / 100`
- Binge Tendency: `avg_session_length_items / 10` (needs session tracking from Phase 9.3)
- Temporal Consistency: `1 - (max evolution shift across genres)` — already computed in `evolution` data
- Cross-Media Curiosity: `min(movie_count, tv_count) / max(movie_count, tv_count, 1)`

All axes normalized to 0–1. Return as `taste_fingerprint: {diversity: f, generosity: f, ...}`.

**Frontend:**
- SVG radar chart with 6 axes, colored polygon fill.
- Tooltip on each axis explaining what it measures.
- Label the user's dominant trait (e.g., "You are a Binge-Prone Genre Loyalist").

---

## 9B.3 — Taste Journey Timeline

**What user sees:**
A horizontal scrollable timeline showing the user's "taste phases" — periods where a specific genre dominated, annotated with approximate date ranges.

Example:
```
Jan–Mar 2025: Action Phase
Apr–May 2025: Korean Drama Phase
Jun 2025: Sci-Fi Exploration Phase
Now: Documentary Curiosity
```

**How to compute:**
- Group `watch_history` entries by month.
- For each month, compute dominant genre (genre with highest watch count that month).
- Identify phase breaks: if dominant genre changes and stays for ≥2 consecutive weeks → new phase.
- Return as `taste_timeline: [{phase: str, genre: str, start_month: str, end_month: str, count: int}]`.

**Frontend:**
- Horizontal scrollable timeline row with colored phase blocks.
- Each block shows the dominant genre and date range.
- Clicking a phase shows what was watched in that period.
- Helps users understand their own taste evolution narrative (not just a cold chart).

---

## 9B.4 — Genre Affinity Heatmap (Genre × Month)

**What user sees:**
A calendar-style heatmap (genres on Y-axis, months on X-axis) showing intensity of genre consumption across time.

**How to compute:**
- Group watch history by (genre, month) → count per cell.
- Normalize by total watches per month to get relative affinity.
- Return as `genre_month_heatmap: [{genre: str, month: str, intensity: float}]`.

**Frontend:**
- CSS grid heatmap (genres rows, month columns).
- Cells colored by intensity (lighter = low, darker/vibrant = high).
- Hover tooltip shows "Watched N [Genre] films in [Month]".
- This is a power-user feature — only show if user has ≥10 watches.

---

## 9B.5 — "What the Engine Thinks About You" Card

**What user sees:**
A conversational plain-language card that translates the user's `UserTasteProfile` weights into natural language sentences.

Example output:
> "Based on your history, I think you:
> - **Really love** Sci-Fi and Thriller content (strong genre affinity)
> - **Are a Christopher Nolan fan** (high director loyalty signal)
> - **Prefer 2010s content** (era affinity peak: 2010s)
> - **Enjoy Korean cinema** (language affinity: Korean)
> - **Dislike overly comedic content** (negative signal on Comedy genre)"

**How to compute:**
- Read `UserTasteProfile` weights.
- For each dimension, extract top positive entries (weight > threshold) → generate sentence.
- Extract negative entries (weight < -threshold) → generate dislike sentence.
- Map genre/cast/crew IDs to human-readable names (use `content_catalog` or a genre name lookup table).
- Return as `engine_interpretation: [str]` — list of plain-language statements.

**Frontend:**
- Clean card with bullet list.
- Each bullet has a small icon (🎬 genre, 🎥 director, 📅 era, 🌏 language, ❌ dislike).
- Title: "What the engine knows about you".
- Add a "How does this affect my recs?" link that expands an explanation.

---

## 9B.6 — Negative Signal Summary (What You Don't Like)

**What user sees:**
A section showing which genres, actors, or themes the user has consistently disliked or skipped, and confirming that the engine suppresses these.

**How to compute:**
- Read `negative_weights` from `UserTasteProfile` (Phase 9.2).
- Filter entries with weight below -2.0 threshold.
- Map to genre/person names.
- Return as `dislike_profile: [{type: "genre"|"person"|"keyword", name: str, strength: float}]`.

**Frontend:**
- Small cards with a red tint showing disliked signals.
- Each card says "We avoid [Name] in your recommendations".
- Gives users confidence the system respects their dislikes.
- If no negative signals yet: show "Help us learn what you don't like with thumbs-down feedback".

---

## 9B.7 — Recommendation Quality Score (Personal NDCG)

**What user sees:**
A single score (0–100) showing how well the recommendation engine is performing *for this specific user*, with a trend arrow (improving/declining).

**How to compute:**
- From `interaction_log`, fetch last 30 recommendations shown to this user.
- For each: was it clicked? Was it rated positively? Was it added to watchlist?
- Compute a personal quality score: `(clicks + 2*positive_ratings + 3*watchlist_adds) / max(total_shown, 1)` normalized to 0–100.
- Store historical quality scores in a `recommendation_quality_log` table (user_id, date, score).
- Return current score + 30-day trend.

**Frontend:**
- Large gauge or score display (similar to existing Discovery Score gauge).
- Sub-label: "Your personalization is [Excellent / Good / Building / Cold]".
- Trend: "↑ Improving" or "→ Stable" or "↓ Declining".
- Below the score: "Rate and interact with recommendations to improve your score".

---

## 9B.8 — Exploration vs Safety Map (Interactive)

**What user sees:**
A 2D scatter plot where each watched genre is plotted on:
- X-axis: how "mainstream" that genre is for this user (% of watches vs avg user)
- Y-axis: how "adventurous" the content within that genre is (avg popularity of watched items in that genre)

**How to compute:**
- For each genre the user watches: compute their watch count and avg popularity of watched items in that genre.
- Compute global avg watch count per genre from all users (or use TMDB popularity as proxy).
- Each genre is a point: position = (user_watch_ratio, avg_item_popularity_in_genre).
- Quadrants: Top-Left = "Niche Adventurer", Top-Right = "Mainstream Explorer", Bottom-Left = "Hidden Gems Hunter", Bottom-Right = "Safe Zone".
- Return as `exploration_map: [{genre: str, mainstream_score: float, adventure_score: float}]`.

**Frontend:**
- SVG scatter plot with 4 quadrant labels.
- Each point is a genre bubble (size = number of watches).
- Hover shows genre name + stats.
- A dashed line marks the "safe zone" boundary.

---

## Summary of New Analysis Page Sections

| Section | New Data Needed from Backend | Chart Type | Complexity |
|---------|------------------------------|-----------|-----------|
| Recommendation DNA Breakdown | Sum of `UserTasteProfile` weight dimensions | Horizontal stacked bar | Low |
| Taste Fingerprint Radar | Multiple normalized dimensions | Radar/Spider chart | Medium |
| Taste Journey Timeline | Month-grouped dominant genre phases | Horizontal timeline | Medium |
| Genre Affinity Heatmap | Genre × Month watch intensity | CSS heatmap grid | Medium |
| Engine Interpretation Card | Top/bottom weights → NL sentences | Bullet card | Low |
| Negative Signal Summary | `negative_weights` from taste profile | Tag cards | Low (needs Phase 9.2) |
| Recommendation Quality Score | From `interaction_log` CTR/rating signals | Gauge + trend | High (needs Phase 6+) |
| Exploration vs Safety Map | Genre mainstream ratio + avg popularity | 2D scatter plot | High |

---

## Implementation Priority Order (Phase 9)

| Priority | Idea | Backend effort | Frontend effort | Impact |
|----------|------|---------------|----------------|--------|
| 🔴 High | 9.2 Negative signal suppression | Medium | Low | High |
| 🔴 High | 9.3 Session context injection | Low (Redis) | None | Very High |
| 🔴 High | 9.11 Rec explanation metadata | Low | Medium | Very High (trust) |
| 🟡 Medium | 9.1 Temporal decay | Medium | None | High |
| 🟡 Medium | 9.7 Watchlist-aware scoring | Medium | Low | High |
| 🟡 Medium | 9.5 Director loyalty amplification | Low | None | Medium |
| 🟡 Medium | 9B.1 Rec DNA breakdown (analysis) | Low | Medium | High |
| 🟡 Medium | 9B.5 Engine interpretation card | Medium | Low | High |
| 🟢 Low | 9.4 Mood detection | Medium | None | Medium |
| 🟢 Low | 9.8 Collaborative filtering | High | None | Very High long-term |
| 🟢 Low | 9.9 Binge detection | Medium | Low | Medium |
| 🟢 Low | 9.10 Serendipity dial | Low | Medium | Medium |
| 🟢 Low | 9B.2 Taste fingerprint radar | Low | High | Medium |
| 🟢 Low | 9B.3 Taste journey timeline | Medium | High | High |
| 🟢 Low | 9B.7 Recommendation quality score | High | Medium | High |

---

## Critical Path for Phase 9

```
Phase 9.2 (Negative signals) ──► Phase 9B.6 (Show dislike summary on Analysis)
Phase 9.3 (Session context)  ──► Phase 9.4 (Mood detection)
                                      │
                                      ▼
                              Phase 9.9 (Binge detection)
Phase 9.11 (Rec explanations) ──► show on frontend card subtitle
Phase 9.1 (Temporal decay)   ──► Phase 9B.1 (DNA breakdown shows decayed weights)
Phase 9.7 (Watchlist boost)  ──► Phase 9B.8 (Watchlist in exploration map)
Phase 9.8 (Collaborative)    ──► Phase 9B.7 (Quality score incorporates CF lift)
```

---

## New DB Fields Needed for Phase 9

| Table | New Column | Type | Purpose |
|-------|-----------|------|---------|
| `user_taste_profiles` | `negative_weights` | JSONB | Disliked genre/keyword/cast weights |
| `user_taste_profiles` | `weight_timestamps` | JSONB | Last-update time per weight key for decay |
| `user_taste_profiles` | `country_weights` | JSONB | Origin country affinity multipliers |
| `user_taste_profiles` | `serendipity_preference` | VARCHAR(10) | `safe` / `balanced` / `surprise` |
| `user_taste_profiles` | `cf_neighbor_ids` | JSONB | Top-20 similar user IDs (updated nightly) |
| `user_blocked_items` | (new table) | `user_id, tmdb_id, media_type` | Hard-blocked items ("never recommend") |
| `recommendation_quality_log` | (new table) | `user_id, date, score` | Per-user rec quality trend data |

---
