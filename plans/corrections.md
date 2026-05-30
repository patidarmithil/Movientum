The system currently works but produces:
- inconsistent relevance
- occasional unnecessary recommendations
- high complexity with low real benefit

Your task is to SIMPLIFY and CLEAN the system while preserving correctness.

DO NOT redesign from scratch.
DO NOT break existing endpoints.
ONLY remove low-value components and simplify logic.

---

# CURRENT PROBLEM

System includes:
- keyword similarity scoring
- complex multi-factor scoring formula
- context-aware boosts
- diversity penalties
- rewatch injection
- trending injection inside recommendations
- bucket system (1–15, 16–30, etc.)

These are:
- increasing complexity
- not improving recommendation quality significantly
- introducing instability (especially with TMDB failures)

---

# GOAL

Transform system into:

- SIMPLE
- STABLE
- RELEVANT
- EASY TO MAINTAIN

---

# REQUIRED FINAL BEHAVIOR

Recommendations should be based mainly on:

1. TMDB recommendations endpoint (primary signal)
2. Genre similarity (fallback)
3. Basic user preference (genre-based)
4. Quality filtering
5. Deduplication
6. Stable sorting

Return 40 items.

---

# REMOVE THESE COMPONENTS COMPLETELY

1. Keyword similarity
   - remove keyword fetch calls
   - remove keyword_score
   - remove keyword-based bonuses

2. Context-aware boost
   - delete boost maps and multipliers

3. Diversity penalty system
   - remove genre/franchise penalties

4. Rewatch injection
   - do not insert watched items into recommendations

5. Trending injection inside recommendations
   - do not mix trending into recommendation results
   - (trending should be separate endpoint/section)

6. Bucket system
   - remove bucket splitting logic
   - return a flat sorted list

---

# SIMPLIFY SCORING

Replace complex formula:

OLD:
final_score =
  0.40 genre
+ 0.20 rating
+ 0.15 popularity
+ 0.15 keyword
+ 0.10 recency

NEW:

Use simple scoring:

score =
  (genre_match_score * 0.7)
+ (rating_score * 0.3)

OPTIONAL:
+ small boost if matches user preferred genres

---

# KEEP THESE (DO NOT REMOVE)

- TMDB recommendation fetch (/recommendations, /similar)
- Cross-type discovery (but keep minimal filtering)
- Quality filter:
  - vote_average >= 6.5
  - vote_count >= 100
  - poster exists
- Deduplication
- Redis caching
- Fallback handling when TMDB fails
- User personalization (only genre-based)

---

# SIMPLIFIED PIPELINE

Implement this exact flow:

STEP 1:
Fetch candidates:
- same-type recommendations
- fallback: similar
- fallback: discover by genre

STEP 2:
Merge results

STEP 3:
Apply quality filter

STEP 4:
Deduplicate

STEP 5:
Compute score:
- genre overlap
- rating

STEP 6:
Apply user genre boost (if user exists)

STEP 7:
Sort descending

STEP 8:
Return top 40 items

---

# IMPORTANT CONSTRAINTS

- System MUST NOT fail if TMDB partially fails
- System MUST return results even with limited data
- No dependency on keyword endpoints
- No over-injection of unrelated items
- Keep API response format unchanged

---

# OUTPUT REQUIRED

Return:

1. Updated recommendation service code (clean version)
2. List of removed components
3. Final simplified scoring function
4. Updated pipeline function

NO explanations.
NO theory.
ONLY implementation.
