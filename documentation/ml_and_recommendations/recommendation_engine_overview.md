# Recommendation Engine

Movientum has **four recommendation surfaces**. They share one thing: every user's `user_taste_profiles` row.

| Surface | Where users see it | Engine |
|---|---|---|
| **Similar items** | "More Like This" on every movie/TV page | Graph walk + ranker (`advanced_recs.py`) |
| **For You** | Home and `/recommendations` | Same engine, run from several of the user's titles (`recommendation_service.py`) |
| **Content DNA** | `/recommendations/content` — "find titles like this basket" | Separate engine (`services/dna/`), see `content_based_recommendations.md` |
| **AI picks** | AI panel on detail pages | Gemini LLM, Groq fallback (`ai_rec_service.py`) |

## Building blocks

**1. `content_catalog`** — one row per title with its features: genres, keywords, top 10 cast, director/writer, studio, language, era (e.g. "2010s"), rating, popularity. About 20K seeded titles, plus any title a user opens (ingested from TMDB on demand).

**2. The graph** (`graph_cache.py`) — built in memory from the catalog. Titles connect to feature nodes. Heavier edges mean "more telling":

| Edge | Weight |
|---|---|
| Director | 2.5 |
| Studio (anime only) | 1.8 |
| Keyword | 1.5 (2.4 for anime) |
| Genre | 1.0 (Animation genre 0.35 for anime) |
| Cast | 0.8 |
| Era | 0.6 |
| Language | 0.4 |

Two titles are "close" if they share many heavy features.

**3. Taste profile** — per-user weights for genres, cast, crew, keywords, eras and languages, plus negative weights. Updated on every signal (see `feedback_loop.md`).

## Similar items, step by step

1. Load the seed title from the catalog (ingest it if missing).
2. **Personalized PageRank** from the seed over the graph → top ~100 nearby titles. This is a "random walk that keeps jumping back to the seed", so it finds titles connected through many paths.
3. **Filters** drop the seed, adult titles, and poor matches.
4. **Feature matrix** — 16 numbers per candidate: graph closeness (2), quality/popularity/recency (4), user-taste match (6), overlap with the seed (4).
5. **Ranker** (`ml/ranker.py`) scores them with a composite: 45% graph, 30% quality (rating × vote confidence), 25% taste. If a trained XGBRanker has been **approved**, its order is blended 50/50 with the composite.
6. **Blend with baseline** — Team-Draft Interleaving picks 70% from this list and 30% from a simpler genre-based list (`recommendation_service`), 100 items total.
7. **Final re-rank** — 40% relevance, 30% quality, 20% taste, 10% recency; baseline items ×0.85. Anime seeds use an anime-specific formula that pushes non-anime down.
8. **Exclude** what the user watched, saved, rated low, or thumbed down (one combined query).

Cached 6 h per user, 24 h for guests.

## For You feed

1. Pick **seeds** from the user's watch history and watchlist, in buckets. Seeds rotate every 15 minutes.
2. Run the similar-items engine per bucket and merge in these shares:

| Bucket | Share | Idea |
|---|---|---|
| Established | 65% | Titles matching long-term taste |
| Diverse | 17.5% | A weaker-matching title, to revive older interests |
| Recent | 12.5% | The latest thing watched/saved |
| Fresh | 7.5% | Popular titles, pure exploration |

3. Pad with baseline picks if short. Exclude seen/suppressed titles.
4. **Order** by 28% relevance + 26% quality + 36% taste + 10% novelty, times an era boost.
5. **Spread out** same-genre/same-language runs (MMR).
6. **Language diversity** — guarantees at least 3 other-language titles once the user's main language passes their threshold (default 70%).

Cached 15 min per 5-page block (3 min right after the user watches or saves something). Users with no history get a baseline feed; guests get `GET /recommendations/guest` (TMDB trending for their country).

## AI picks

`ai_rec_service.py` builds a prompt from the seed title (and, if logged in, the user's taste and past AI thumbs), asks Gemini (`gemini-flash-latest`), falls back to Groq models if Gemini fails, repairs malformed JSON, and matches each suggestion to a real TMDB title. Thumbs on AI cards update the same taste profile.

## Rule for changes

Performance work must not change which items come back or their order. Quality changes are allowed only with a before/after measurement (a `backend/debug/scratch_*_eval.py` probe) and no added latency.
