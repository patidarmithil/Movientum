/**
 * Explore.jsx — filtered browse with a filter rail and infinite scroll.
 *
 * Route: /explore?category=heist&countries=IN&…
 * Endpoint: GET /api/v1/movies/explore (TMDB discover proxy; facet slugs are mapped
 * to TMDB ids server-side in app/services/explore_service.py)
 *
 * The URL is the only source of filter state: the navbar menu and the hub pages
 * link here with a query string, and every rail control rewrites it. Results are
 * kept in sessionStorage keyed by that query so Back lands on the same scroll.
 *
 * Layout: sticky filter rail on the left (≥901px); a bottom sheet on mobile.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import { LuSlidersHorizontal, LuX } from 'react-icons/lu'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import { FilterPanel, FilterSheet, Select } from '../components/explore/ExploreFilters'
import { DEFAULT_FILTERS, MIN_YEAR, countActive } from '../utils/exploreFilters'
import { movieService } from '../services/movieService'
import { useSessionState } from '../hooks/useSessionState'
import { useMediaQuery } from '../hooks/useMediaQuery'
import {
  CATEGORY_BY_SLUG, CINEMAS, COMPANIES, COUNTRY_BY_CODE, CURRENT_YEAR, DURATIONS, FAMILY_BY_SLUG,
  GENRE_BY_SLUG, LANGUAGE_BY_SLUG, SORTS,
} from '../utils/exploreTaxonomy'
import { OTT, ottProviderIds } from '../utils/ott'
import ExploreAurora from '../components/explore/ExploreAurora'
import '../components/explore/explore-tokens.css'
import './ExploreResults.css'

const LIMIT = 24
const LEGACY_AGE = { kids: 'under10', teens: 'under16' }

const list = (sp, key) => sp.get(key)?.split(',').map((s) => s.trim()).filter(Boolean) ?? []

function parseFilters(sp) {
  const type = sp.get('type') ?? ''
  const num = (key, fallback) => {
    const n = Number(sp.get(key))
    return sp.get(key) != null && Number.isFinite(n) ? n : fallback
  }
  return {
    ...DEFAULT_FILTERS,
    sort: sp.get('sort') || 'popularity',
    type: type === 'movie' || type === 'tv' ? type : '',
    anime: type === 'anime' ? 'only' : (['hide', 'only'].includes(sp.get('anime')) ? sp.get('anime') : ''),
    genres: list(sp, 'genres').map((g) => g.toLowerCase()),
    category: sp.get('category') ?? '',
    language: sp.get('language') ?? '',
    countries: list(sp, 'countries').map((c) => c.toUpperCase()),
    family: sp.get('family') || LEGACY_AGE[sp.get('age_rating')] || '',
    award: sp.get('award') === '1' || sp.get('award') === 'true',
    duration: sp.get('duration') ?? '',
    yearFrom: num('year_from', MIN_YEAR),
    yearTo: num('year_to', CURRENT_YEAR),
    minRating: num('min_rating', 0),
    cinema: sp.get('cinema') ?? '',
    companies: list(sp, 'companies'),
    ott: list(sp, 'ott'),
  }
}

/** Filters -> URL query (defaults omitted, fixed key order so it doubles as a cache key). */
function toSearch(f) {
  const p = new URLSearchParams()
  if (f.category) p.set('category', f.category)
  if (f.genres.length) p.set('genres', f.genres.join(','))
  if (f.language) p.set('language', f.language)
  if (f.countries.length) p.set('countries', f.countries.join(','))
  if (f.family) p.set('family', f.family)
  if (f.award) p.set('award', '1')
  if (f.anime) p.set('anime', f.anime)
  if (f.type) p.set('type', f.type)
  if (f.duration) p.set('duration', f.duration)
  if (f.yearFrom > MIN_YEAR) p.set('year_from', String(f.yearFrom))
  if (f.yearTo < CURRENT_YEAR) p.set('year_to', String(f.yearTo))
  if (f.minRating > 0) p.set('min_rating', String(f.minRating))
  if (f.cinema) p.set('cinema', f.cinema)
  if (f.companies.length) p.set('companies', f.companies.join(','))
  if (f.ott.length) p.set('ott', f.ott.join(','))
  if (f.sort !== 'popularity') p.set('sort', f.sort)
  return p
}

function toApiParams(f, page) {
  const p = { page, limit: LIMIT, sort: f.sort }
  if (f.category) p.category = f.category
  if (f.genres.length) p.genres = f.genres.join(',')
  if (f.language) p.language = f.language
  if (f.countries.length) p.countries = f.countries.join(',')
  if (f.family) p.family = f.family
  if (f.award) p.award = true
  if (f.anime) p.anime = f.anime
  if (f.type) p.type = f.type
  if (f.duration) p.duration = f.duration
  if (f.yearFrom > MIN_YEAR) p.year_from = f.yearFrom
  if (f.yearTo < CURRENT_YEAR) p.year_to = f.yearTo
  if (f.minRating > 0) p.min_rating = f.minRating
  if (f.cinema) p.cinema = f.cinema
  if (f.companies.length) p.companies = f.companies.join(',')
  if (f.ott.length) p.providers = ottProviderIds(f.ott).join(',')
  return p
}

function pageTitle(f) {
  if (f.category) return CATEGORY_BY_SLUG[f.category]?.label ?? 'Explore'
  const genre = f.genres.length === 1 ? GENRE_BY_SLUG[f.genres[0]]?.label : null
  if (f.anime === 'only') return genre ? `${genre} Anime` : 'Anime'
  if (f.language) return LANGUAGE_BY_SLUG[f.language]?.label ?? 'Explore'
  if (f.countries.length === 1) return COUNTRY_BY_CODE[f.countries[0]]?.label ?? 'Explore'
  if (genre) return genre
  if (f.award) return 'Award Winners'
  if (f.family) return 'Family Friendly'
  if (f.type === 'movie') return 'Movies'
  if (f.type === 'tv') return 'Shows'
  return 'Explore'
}

const label = (arr, v, key = 'value') => arr.find((o) => o[key] === v)?.label ?? v

/** Removable chips for everything set, each with the patch that clears it. */
function activeChips(f) {
  const chips = []
  if (f.category) chips.push({ key: 'cat', text: `Category: ${CATEGORY_BY_SLUG[f.category]?.label ?? f.category}`, patch: { category: '' } })
  f.countries.forEach((c) => chips.push({ key: `c-${c}`, text: `Country: ${COUNTRY_BY_CODE[c]?.label ?? c}`, patch: { countries: f.countries.filter((x) => x !== c) } }))
  if (f.language) chips.push({ key: 'lang', text: `Language: ${LANGUAGE_BY_SLUG[f.language]?.label ?? f.language}`, patch: { language: '' } })
  f.genres.forEach((g) => chips.push({ key: `g-${g}`, text: `Genre: ${GENRE_BY_SLUG[g]?.label ?? g}`, patch: { genres: f.genres.filter((x) => x !== g) } }))
  if (f.family) chips.push({ key: 'fam', text: `Age: ${FAMILY_BY_SLUG[f.family]?.label ?? f.family}`, patch: { family: '' } })
  if (f.anime) chips.push({ key: 'anime', text: f.anime === 'only' ? 'Only anime' : 'Anime hidden', patch: { anime: '' } })
  if (f.type) chips.push({ key: 'type', text: f.type === 'movie' ? 'Movies' : 'Shows', patch: { type: '' } })
  if (f.duration) chips.push({ key: 'dur', text: label(DURATIONS, f.duration), patch: { duration: '' } })
  if (f.yearFrom > MIN_YEAR || f.yearTo < CURRENT_YEAR) {
    chips.push({ key: 'yr', text: `${f.yearFrom > MIN_YEAR ? f.yearFrom : 'Any'}–${f.yearTo < CURRENT_YEAR ? f.yearTo : 'now'}`, patch: { yearFrom: MIN_YEAR, yearTo: CURRENT_YEAR } })
  }
  if (f.minRating > 0) chips.push({ key: 'mr', text: `★ ${f.minRating}+`, patch: { minRating: 0 } })
  if (f.cinema) chips.push({ key: 'cin', text: label(CINEMAS, f.cinema), patch: { cinema: '' } })
  f.companies.forEach((c) => chips.push({ key: `co-${c}`, text: label(COMPANIES, c, 'id'), patch: { companies: f.companies.filter((x) => x !== c) } }))
  f.ott.forEach((o) => chips.push({ key: `o-${o}`, text: label(OTT, o, 'id'), patch: { ott: f.ott.filter((x) => x !== o) } }))
  return chips
}

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])
  const queryKey = useMemo(() => toSearch(filters).toString(), [filters])
  const isMobile = useMediaQuery('(max-width: 900px)')

  const [movies, setMovies] = useSessionState('explore_movies', [])
  const [total, setTotal] = useSessionState('explore_total', 0)
  const [hasMore, setHasMore] = useSessionState('explore_hasMore', true)
  const [page, setPage] = useSessionState('explore_page', 1)
  const [lastQuery, setLastQuery] = useSessionState('explore_query', null)

  const [loading, setLoading] = useState(() => !(lastQuery === queryKey && movies.length > 0))
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [sheetOpen, setSheetOpen] = useState(false)

  const filtersRef = useRef(filters)
  // Declared before the fetch effect so the ref is current when it runs.
  useEffect(() => { filtersRef.current = filters }, [filters])
  const abortRef = useRef(null)
  const fetchingRef = useRef(false)
  const sentinelRef = useRef(null)
  const firstRun = useRef(true)

  const setFilters = useCallback((next) => {
    setSearchParams(toSearch(next), { replace: true })
  }, [setSearchParams])
  const patch = useCallback((p) => setFilters({ ...filtersRef.current, ...p }), [setFilters])

  const fetchPage = useCallback(async (p) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    fetchingRef.current = true
    if (p === 1) setLoading(true)
    else setLoadingMore(true)
    setError(null)

    try {
      const data = await movieService.exploreTitles(toApiParams(filtersRef.current, p), controller.signal)
      const fresh = data.movies ?? []
      setTotal(data.total ?? 0)
      setHasMore(data.has_more ?? fresh.length >= LIMIT)
      setMovies((prev) => {
        if (p === 1) return fresh
        const seen = new Set(prev.map((m) => `${m.id}-${m.media_type}`))
        return [...prev, ...fresh.filter((m) => !seen.has(`${m.id}-${m.media_type}`))]
      })
    } catch (err) {
      if (!axios.isCancel(err) && err.name !== 'AbortError' && err.name !== 'CanceledError') {
        setError('Could not load titles.')
      }
    } finally {
      if (abortRef.current === controller) {
        fetchingRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [setMovies, setTotal, setHasMore])

  // New filter set -> page 1. On the very first run, a cached result for the
  // same query (Back navigation) is kept as-is.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false
      if (lastQuery === queryKey && movies.length > 0) return
    } else {
      window.scrollTo(0, 0)
    }
    setLastQuery(queryKey)
    setPage(1)
    setHasMore(true)
    fetchPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadMore = useCallback(() => {
    if (fetchingRef.current) return
    const next = page + 1
    setPage(next)
    fetchPage(next)
  }, [page, setPage, fetchPage])

  // Infinite scroll
  useEffect(() => {
    if (loading || loadingMore || !hasMore || error) return
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { rootMargin: '400px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [loading, loadingMore, hasMore, error, loadMore])

  const title = pageTitle(filters)
  useEffect(() => {
    document.title = title === 'Explore' ? 'Explore - Movientum' : `${title} - Explore - Movientum`
  }, [title])

  const chips = activeChips(filters)
  const nActive = countActive(filters)
  const clearAll = () => setFilters({ ...DEFAULT_FILTERS })
  const closeSheet = useCallback(() => setSheetOpen(false), [])

  return (
    <main className="xres page-content">
      <ExploreAurora variant="results" />
      <div className="xres__layout">
        {!isMobile && (
          <aside className="xres__rail" aria-label="Filters">
            <header className="xres__rail-head">
              <LuSlidersHorizontal aria-hidden />
              <h2>Filters</h2>
              {nActive > 0 && <span className="xres__badge">{nActive}</span>}
              {nActive > 0 && (
                <button type="button" className="xres__clear" onClick={clearAll}>
                  <LuX aria-hidden /> Clear
                </button>
              )}
            </header>
            <FilterPanel value={filters} onChange={setFilters} idPrefix="xr" />
          </aside>
        )}

        <section className="xres__main">
          <header className="xres__head">
            <h1 className="xres__title">{title}</h1>
            {!loading && !error && (
              <p className="xres__count">{total > 0 ? `${total.toLocaleString()} titles` : ''}</p>
            )}
          </header>

          {isMobile && (
            <div className="xres__mbar">
              <button type="button" className="xres__mbtn" onClick={() => setSheetOpen(true)}>
                <LuSlidersHorizontal aria-hidden /> Filters
                {nActive > 0 && <span className="xres__badge">{nActive}</span>}
              </button>
              <div className="xres__msort">
                <Select id="xm-sort-bar" label="Sort by" value={filters.sort} options={SORTS} onChange={(v) => patch({ sort: v || 'popularity' })} />
              </div>
            </div>
          )}

          <div className="xres__chips">
            {chips.map((c) => (
              <button key={c.key} type="button" className="xres__chip" onClick={() => patch(c.patch)} aria-label={`Remove ${c.text}`}>
                {c.text} <LuX aria-hidden />
              </button>
            ))}
            {!filters.award && (
              <button type="button" className="xchip xchip--sky" onClick={() => patch({ award: true })}>
                <span className="xchip__box" aria-hidden /> Award Winner
              </button>
            )}
            {filters.award && (
              <button type="button" className="xchip xchip--sky is-on" aria-pressed="true" onClick={() => patch({ award: false })}>
                <span className="xchip__box" aria-hidden /> Award Winner
              </button>
            )}
            {!filters.family && (
              <button type="button" className="xchip xchip--mint" onClick={() => patch({ family: 'under10' })}>
                <span className="xchip__box" aria-hidden /> Family Friendly
              </button>
            )}
          </div>

          {error && (
            <div className="xres__state">
              <p>{error} Check your connection and try again.</p>
              <button type="button" className="xres__btn" onClick={() => fetchPage(movies.length ? page : 1)}>Retry</button>
            </div>
          )}

          {!error && !loading && movies.length === 0 && (
            <div className="xres__state">
              <p>No titles match these filters. Remove one, or start over.</p>
              {nActive > 0 && <button type="button" className="xres__btn" onClick={clearAll}>Clear all filters</button>}
            </div>
          )}

          <div className="xres__grid">
            {loading
              ? <MovieCardSkeleton count={LIMIT} />
              : movies.map((m) => <MovieCard key={`${m.id}-${m.media_type}`} movie={m} />)}
            {loadingMore && <MovieCardSkeleton count={8} />}
          </div>

          {!loading && hasMore && !error && <div ref={sentinelRef} className="xres__sentinel" aria-hidden />}
          {!loading && !hasMore && movies.length > 0 && <p className="xres__end">That’s everything for these filters.</p>}
        </section>
      </div>

      {isMobile && sheetOpen && (
        <FilterSheet
          initial={filters}
          onClose={closeSheet}
          onApply={(next) => { setFilters(next); setSheetOpen(false) }}
        >
          {(draft, setDraft) => <FilterPanel value={draft} onChange={setDraft} idPrefix="xm" />}
        </FilterSheet>
      )}
    </main>
  )
}
