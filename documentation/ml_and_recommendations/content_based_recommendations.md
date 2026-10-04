# Content DNA (Basket Recommendations)

On `/recommendations/content` a user puts several titles in a **basket** and asks "find more like these". This is powered by the **Content DNA** engine in `backend/app/services/dna/`, separate from the similar-items engine.

`POST /api/v1/recommendations/content`

## The idea

Each title has a "DNA": its keywords, genres, director/writer, cast and studio. The engine builds one combined DNA for the whole basket, then finds catalog titles whose DNA is closest.

Rare features count more than common ones. Sharing a niche keyword like "time loop" says more than sharing "Drama". This is **IDF** weighting (inverse document frequency).

## Pipeline

| Stage | File | What it does |
|---|---|---|
| IDF table | `idf.py` | How rare each feature is across the catalog. Built at startup, cached 24 h |
| Basket profile | `profile.py` | Merge the basket titles into one weighted feature profile; detect dominant language and type |
| Recall | `retrieval.py` | Inverted index: pull every title sharing strong features with the basket (at least 200 candidates, vote count ≥ 20) |
| Graph boost | `graph_rwr.py` | PageRank from each basket title over the shared graph, cached per title for 24 h |
| Scoring | `scoring.py` | Facet similarity + graph + quality, then language/type gates and MMR diversity |
| Orchestration | `service.py` | Caching, filters, sort, pagination, taste blend |

## Score weights

| Part | Weight |
|---|---|
| Keyword match | 0.30 |
| Genre match | 0.22 |
| Crew (director/writer) | 0.12 |
| Cast | 0.10 |
| Studio | 0.06 |
| Graph (PageRank) | 0.12 |
| Quality (Bayesian rating) | 0.05 |
| Popularity | 0.03 (tiebreak) |

Then:
- **Language gate** and **type gate** — if the basket is mostly one language or all TV, off-pattern titles are pushed down (not removed).
- **MMR diversity** — avoids a page full of the same franchise.

## Extras on the page

- **Filters** (type, year, language, rating, sort) run on the server over the cached ranked pool.
- **Negative basket** — "less like this" titles; matches to their DNA are subtracted.
- **Taste blend** — logged-in users get a small boost from `user_taste_profiles`; `ignore_taste` turns it off.
- **Fingerprint + "why" chips** — shows the top features of the basket and why each result matched.

## Caching

The ranked order (300 items) is computed once per basket and cached 30 min, then sliced into pages of 20. Basket profile and "why" map are cached the same way.

## Offline evaluation

The pure modules run without DB, Redis or network, so they can be tested on a catalog snapshot in seconds:

```bash
python debug/dna_offline.py --refresh
python debug/scratch_dna_eval.py
python debug/scratch_dna_sweep.py
```

The golden set is `debug/dna_baskets.json` (15 baskets, 5 held out). A 40-config parameter sweep found no real gain on held-out baskets, so the hand-picked weights above were kept.
