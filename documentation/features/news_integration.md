# News

Movientum shows entertainment news on its own page, as a strip on Home, and as a rail on each movie/TV page. **All news lives in Redis — never in PostgreSQL.**

## How news gets in (one button)

There is no automatic crawling. An admin presses **"News Daily Fetch"** in the admin panel. That runs:

1. **Fetch** — NewsAPI (50), Currents (600) and ApiTube (50) articles, in parallel (`news_fetch_service.py`).
2. **Deduplicate** — same URL, same title fingerprint, or near-identical text → keep one. About 500 remain.
3. **Enrich** (`news_service.build_snapshot`):
   - **Categories** — rule-based keyword scoring (`news_taxonomy.py`), refined by a small TF-IDF + logistic-regression model trained on the batch itself (`news_nlp.py`).
   - **Entity links** — match headlines to real titles in the catalog, so "Dune" news links to the Dune page (`news_entity_linker.py`, index rebuilt nightly at 03:45).
   - **Quality score** and **taste facets** (genres, people, keywords of linked titles).
4. **Swap** — write everything as a new *generation* `news:v3:{N+1}:*`, point `news:v3:gen` to it, delete the old one after 10 s.

Readers always see a complete snapshot: the new one becomes visible only at the swap. A lock blocks two builds at once, and an empty fetch never replaces a good snapshot.

## Feed tabs

`GET /api/v1/news/feed?tab=...&category=...`

| Tab | Order |
|---|---|
| `latest` | Newest first |
| `editorial` | Highest quality score |
| `trending` | Views per hour, computed on demand |
| `for-you` | Personalised (below) |
| `category=` | Articles tagged with that category |

## "For You" scoring

Uses the same `user_taste_profiles` as recommendations (read-only). Each article gets:

| Part | Weight |
|---|---|
| Genre match | 0.30 |
| Person match | 0.20 |
| Linked title the user rated/watched/saved | 0.20 |
| Keyword match | 0.10 |
| Source reliability | 0.12 |
| Recency | 0.08 |
| Negative taste | −0.15 |
| Already seen | −0.25 |

Then a diversity pass stops one source or category from filling the page. The top 120 ids are cached 10 min per user so paging is stable. Guests and users with fewer than 5 interactions get `latest`.

## News feedback

Thumbs on a news card (`POST /news/article/{id}/feedback`) adjust only that user's news source/category/entity weights in Redis and hide a downvoted article. They **never** change movie recommendations.

## Other endpoints

`/news/for-title/{type}/{id}` (detail-page rail), `/news/article/{id}`, `/view` (counts views, once per user per hour), `/save` (bookmarks, max 500), `/search`, `/status`, `/categories`.
