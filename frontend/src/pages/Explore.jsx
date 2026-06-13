/**
 * Explore.jsx — Filtered movie browse with Infinite Scroll
 *
 * Route: /explore
 * Endpoint: GET /api/v1/movies/explore
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../utils/api'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import './Explore.css'

const SORT_OPTIONS = [
  { value: 'popularity',   label: 'Most Popular' },
  { value: 'rating',       label: 'Top Rated' },
  { value: 'moctale',      label: 'Moctale Score' },
  { value: 'release_date', label: 'Newest First' },
  { value: 'title',        label: 'A – Z' },
]

const COMPANIES = [
  { id: '420', label: 'Marvel Studios' },
  { id: '2', label: 'Walt Disney' },
  { id: '174', label: 'Warner Bros.' },
  { id: '33', label: 'Universal' },
  { id: '4', label: 'Paramount' },
  { id: '34', label: 'Sony Pictures' },
  { id: '178464', label: 'Netflix Studios' },
  { id: '41077', label: 'A24' },
  { id: '3172', label: 'Blumhouse' },
  { id: '4439', label: 'Yash Raj Films' },
  { id: '7293', label: 'Dharma Productions' },
]

const COUNTRIES = [
  { code: 'US', label: 'USA' },
  { code: 'IN', label: 'India' },
  { code: 'GB', label: 'UK' },
  { code: 'KR', label: 'South Korea' },
  { code: 'JP', label: 'Japan' },
  { code: 'FR', label: 'France' },
  { code: 'ES', label: 'Spain' },
  { code: 'DE', label: 'Germany' },
  { code: 'CA', label: 'Canada' },
]

const PROVIDERS = [
  { id: '8', label: 'Netflix' },
  { id: '119', label: 'Prime Video' },
  { id: '122', label: 'Disney+ Hotstar' },
  { id: '220', label: 'JioCinema' },
  { id: '232', label: 'ZEE5' },
  { id: '237', label: 'SonyLIV' },
  { id: '350', label: 'Apple TV+' },
]

const CURRENT_YEAR = new Date().getFullYear()

function RangeSlider({ min, max, value, onChange, step = 1, label, format = (v) => v }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="explore-slider">
      <div className="explore-slider__header">
        <span className="explore-slider__label">{label}</span>
        <span className="explore-slider__value">{format(value)}</span>
      </div>
      <div className="explore-slider__track-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="explore-slider__input"
          style={{ '--pct': `${pct}%` }}
        />
      </div>
    </div>
  )
}

export default function Explore() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)

  // ── Filter state ──────────────────────────────────────────
  const [selectedGenres, setSelectedGenres] = useState(
    () => searchParams.get('genres')?.split(',').filter(Boolean) ?? []
  )
  const [selectedType, setSelectedType] = useState(
    () => searchParams.get('type') ?? ''
  )
  const [selectedCompanies, setSelectedCompanies] = useState(
    () => searchParams.get('companies')?.split(',').filter(Boolean) ?? []
  )
  const [selectedCountries, setSelectedCountries] = useState(
    () => searchParams.get('countries')?.split(',').filter(Boolean) ?? []
  )
  const [selectedProviders, setSelectedProviders] = useState(
    () => searchParams.get('providers')?.split(',').filter(Boolean) ?? []
  )
  const [minRating,  setMinRating]  = useState(() => Number(searchParams.get('min_rating') ?? 0))
  const [yearFrom,   setYearFrom]   = useState(() => Number(searchParams.get('year_from') ?? 1900))
  const [yearTo,     setYearTo]     = useState(() => Number(searchParams.get('year_to')   ?? CURRENT_YEAR))
  const [sort,       setSort]       = useState(() => searchParams.get('sort') ?? 'popularity')
  const [page,       setPage]       = useState(() => Number(searchParams.get('page') ?? 1))

  // ── Data ──────────────────────────────────────────────────
  const [movies,    setMovies]    = useState([])
  const [allGenres, setAllGenres] = useState([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore,    setHasMore]   = useState(true)
  const [error,     setError]     = useState(null)

  const LIMIT = 24
  const observerRef = useRef(null)

  // ── Fetch ─────────────────────────────────────────────────
  const fetchMovies = useCallback(async (p, isInitial = false) => {
    if (isInitial) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      const params = {
        page:  p,
        limit: LIMIT,
        sort:  sort,
      }
      if (selectedGenres.length)         params.genres     = selectedGenres.join(',')
      if (selectedCompanies.length)      params.companies  = selectedCompanies.join(',')
      if (selectedCountries.length)      params.countries  = selectedCountries.join(',')
      if (selectedProviders.length)      params.providers  = selectedProviders.join(',')
      if (minRating > 0)                 params.min_rating = minRating
      if (yearFrom > 1900)               params.year_from  = yearFrom
      if (yearTo < CURRENT_YEAR)         params.year_to    = yearTo
      if (selectedType)                  params.type       = selectedType

      const r = await api.get('/api/v1/movies/explore', { params })
      const newMovies = r.data.movies ?? []
      const totalCount = r.data.total ?? 0
      setTotal(totalCount)
      if (r.data.all_genres?.length) setAllGenres(r.data.all_genres)

      if (isInitial) {
        setMovies(newMovies)
      } else {
        setMovies((prev) => {
          const existingIds = new Set(prev.map(m => `${m.id}-${m.media_type}`))
          const uniqueNew = newMovies.filter(m => !existingIds.has(`${m.id}-${m.media_type}`))
          return [...prev, ...uniqueNew]
        })
      }

      if (r.data.has_more !== undefined) {
        setHasMore(r.data.has_more)
      } else {
        setHasMore(newMovies.length >= LIMIT)
      }
    } catch {
      setError('Failed to load movies')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [selectedGenres, selectedCompanies, selectedCountries, selectedProviders, minRating, yearFrom, yearTo, sort, selectedType])

  // Reset page and movies list when filters change
  useEffect(() => {
    setMovies([])
    setPage(1)
    setHasMore(true)
    fetchMovies(1, true)

    // Sync URL params (excluding page parameter on first load)
    const p = {}
    if (selectedGenres.length)     p.genres     = selectedGenres.join(',')
    if (selectedCompanies.length)  p.companies  = selectedCompanies.join(',')
    if (selectedCountries.length)  p.countries  = selectedCountries.join(',')
    if (selectedProviders.length)  p.providers  = selectedProviders.join(',')
    if (minRating > 0)             p.min_rating = String(minRating)
    if (yearFrom > 1900)           p.year_from  = String(yearFrom)
    if (yearTo < CURRENT_YEAR)     p.year_to    = String(yearTo)
    if (sort !== 'popularity')     p.sort       = sort
    if (selectedType)              p.type       = selectedType
    setSearchParams(p, { replace: true })
  }, [selectedGenres, selectedCompanies, selectedCountries, selectedProviders, minRating, yearFrom, yearTo, sort, selectedType, fetchMovies])

  // Fetch subsequent pages when page increments
  useEffect(() => {
    if (page > 1) {
      fetchMovies(page, false)

      // Sync URL page parameter
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('page', String(page))
        return next
      }, { replace: true })
    }
  }, [page, fetchMovies])

  // Infinite scroll trigger
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPage((prev) => prev + 1)
        }
      },
      { threshold: 0.1 }
    )

    const currentTrigger = observerRef.current
    if (currentTrigger) {
      observer.observe(currentTrigger)
    }

    return () => {
      if (currentTrigger) {
        observer.unobserve(currentTrigger)
      }
    }
  }, [loading, loadingMore, hasMore])

  // ── Genre toggle ──────────────────────────────────────────
  const toggleGenre = (g) =>
    setSelectedGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    )

  const toggleCompany = (c) =>
    setSelectedCompanies((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    )

  const toggleCountry = (c) =>
    setSelectedCountries((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    )

  const toggleProvider = (p) =>
    setSelectedProviders((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
    )

  const clearAll = () => {
    setSelectedGenres([])
    setSelectedCompanies([])
    setSelectedCountries([])
    setSelectedProviders([])
    setMinRating(0)
    setYearFrom(1900)
    setYearTo(CURRENT_YEAR)
    setSort('popularity')
    setSelectedType('')
    setPage(1)
  }

  const hasFilters =
    selectedGenres.length > 0 ||
    selectedCompanies.length > 0 ||
    selectedCountries.length > 0 ||
    selectedProviders.length > 0 ||
    minRating > 0 ||
    yearFrom > 1900 ||
    yearTo < CURRENT_YEAR ||
    sort !== 'popularity' ||
    selectedType !== ''

  return (
    <main className="explore-page page-content">
      {/* ── Background Aurora Animation ── */}
      <div className="explore-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#7928CA", "#FF0080", "#00DFD8"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="explore-aurora-overlay" />
      </div>

      {/* Mobile sidebar overlay */}
      <div 
        className={`explore-sidebar-backdrop${filtersOpen ? ' explore-sidebar-backdrop--open' : ''}`}
        onClick={() => setFiltersOpen(false)}
        aria-hidden="true"
      />
      <div className="explore-page__inner">

        {/* ── Sidebar ── */}
        <aside className={`explore-sidebar${filtersOpen ? ' explore-sidebar--open' : ''}`}>
          <div className="explore-sidebar__header">
            <h2 className="explore-sidebar__title">Explore</h2>
            <div className="explore-sidebar__header-actions">
              {hasFilters && (
                <button className="explore-sidebar__clear" onClick={clearAll}>
                  Clear all
                </button>
              )}
              <button 
                className="explore-sidebar__close"
                onClick={() => setFiltersOpen(false)}
                aria-label="Close filters"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="explore-sidebar__content">
            {/* Sort */}
            <div className="explore-section">
              <p className="explore-section__label">Sort by</p>
              <div className="explore-sort">
                {SORT_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    className={`explore-sort__btn${sort === o.value ? ' explore-sort__btn--active' : ''}`}
                    onClick={() => setSort(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Type */}
            <div className="explore-section">
              <p className="explore-section__label">Type</p>
              <div className="explore-sort">
                {[
                  { value: '',      label: 'All Types' },
                  { value: 'movie', label: 'Movies' },
                  { value: 'tv',    label: 'TV Shows' },
                  { value: 'anime', label: 'Anime' },
                ].map((o) => (
                  <button
                    key={o.value}
                    className={`explore-sort__btn${selectedType === o.value ? ' explore-sort__btn--active' : ''}`}
                    onClick={() => setSelectedType(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Genres */}
            <div className="explore-section">
              <p className="explore-section__label">Genres</p>
              <div className="explore-genres">
                {allGenres.map((g) => (
                  <button
                    key={g}
                    className={`explore-genre-pill${selectedGenres.includes(g) ? ' explore-genre-pill--active' : ''}`}
                    onClick={() => toggleGenre(g)}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            {/* Production Houses */}
            <div className="explore-section">
              <p className="explore-section__label">Production Houses</p>
              <div className="explore-genres">
                {COMPANIES.map((c) => (
                  <button
                    key={c.id}
                    className={`explore-genre-pill${selectedCompanies.includes(c.id) ? ' explore-genre-pill--active' : ''}`}
                    onClick={() => toggleCompany(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Countries */}
            <div className="explore-section">
              <p className="explore-section__label">Countries</p>
              <div className="explore-genres">
                {COUNTRIES.map((c) => (
                  <button
                    key={c.code}
                    className={`explore-genre-pill${selectedCountries.includes(c.code) ? ' explore-genre-pill--active' : ''}`}
                    onClick={() => toggleCountry(c.code)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* OTT Platforms */}
            <div className="explore-section">
              <p className="explore-section__label">OTT Platforms</p>
              <div className="explore-genres">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    className={`explore-genre-pill${selectedProviders.includes(p.id) ? ' explore-genre-pill--active' : ''}`}
                    onClick={() => toggleProvider(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Min rating */}
            <div className="explore-section">
              <RangeSlider
                label="Min Rating"
                min={0} max={10} step={0.5}
                value={minRating}
                onChange={setMinRating}
                format={(v) => v === 0 ? 'Any' : `★ ${v.toFixed(1)}+`}
              />
            </div>

            {/* Year from */}
            <div className="explore-section">
              <RangeSlider
                label="Released From"
                min={1920} max={CURRENT_YEAR} step={1}
                value={yearFrom}
                onChange={setYearFrom}
                format={(v) => v === 1920 ? 'Any' : String(v)}
              />
            </div>

            {/* Year to */}
            <div className="explore-section">
              <RangeSlider
                label="Released Until"
                min={1920} max={CURRENT_YEAR} step={1}
                value={yearTo}
                onChange={setYearTo}
                format={(v) => v === CURRENT_YEAR ? 'Now' : String(v)}
              />
            </div>
          </div>
        </aside>

        {/* ── Main ── */}
        <div className="explore-main">
          {/* Header bar */}
          <div className="explore-main__header">
            <button 
              className="explore-mobile-filter-btn"
              onClick={() => setFiltersOpen(true)}
              aria-label="Open filters"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
              </svg>
              <span>Filters</span>
            </button>
            <p className="explore-main__count">
              {total > 0 && (
                <>
                  {total.toLocaleString()}{' '}
                  {selectedType === 'movie'
                    ? `movie${total !== 1 ? 's' : ''}`
                    : selectedType === 'tv'
                    ? `TV show${total !== 1 ? 's' : ''}`
                    : selectedType === 'anime'
                    ? 'anime'
                    : `title${total !== 1 ? 's' : ''}`}
                </>
              )}
            </p>
            {/* Active chips */}
            {(selectedType !== '' || selectedGenres.length > 0 || selectedCompanies.length > 0 || selectedCountries.length > 0 || selectedProviders.length > 0) && (
              <div className="explore-active-chips">
                {selectedType && (
                  <button key="active-chip-type" className="explore-active-chip" onClick={() => setSelectedType('')}>
                    {selectedType === 'movie' ? 'Movies' : selectedType === 'tv' ? 'TV Shows' : 'Anime'} ×
                  </button>
                )}
                {selectedGenres.map((g) => (
                  <button key={g} className="explore-active-chip" onClick={() => toggleGenre(g)}>
                    {g} ×
                  </button>
                ))}
                {selectedCompanies.map((cId) => {
                  const company = COMPANIES.find(c => c.id === cId)
                  return (
                    <button key={cId} className="explore-active-chip" onClick={() => toggleCompany(cId)}>
                      {company ? company.label : cId} ×
                    </button>
                  )
                })}
                {selectedCountries.map((code) => {
                  const country = COUNTRIES.find(c => c.code === code)
                  return (
                    <button key={code} className="explore-active-chip" onClick={() => toggleCountry(code)}>
                      {country ? country.label : code} ×
                    </button>
                  )
                })}
                {selectedProviders.map((pId) => {
                  const provider = PROVIDERS.find(p => p.id === pId)
                  return (
                    <button key={pId} className="explore-active-chip" onClick={() => toggleProvider(pId)}>
                      {provider ? provider.label : pId} ×
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="error-state">{error}</div>
          )}

          {/* Grid */}
          {loading ? (
            <div className="explore-grid">
              <MovieCardSkeleton count={24} />
            </div>
          ) : movies.length > 0 ? (
            <>
              <div className="explore-grid">
                {movies.map((m) => <MovieCard key={`${m.id}-${m.media_type}`} movie={m} />)}
              </div>

              {loadingMore && (
                <div className="explore-grid" style={{ marginTop: '24px' }}>
                  <MovieCardSkeleton count={8} />
                </div>
              )}

              <div ref={observerRef} style={{ height: 20, margin: '20px 0' }} />

              {!hasMore && (
                <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', margin: '40px 0 20px', fontSize: '13px' }}>
                  No more titles to load.
                </p>
              )}
            </>
          ) : !error && (
            <div className="empty-state">
              <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
              <h3>No movies match these filters</h3>
              <p>Try removing some filters</p>
              <button className="explore-sidebar__clear" style={{ marginTop: 16 }} onClick={clearAll}>
                Reset filters
              </button>
            </div>
          )}
        </div>

      </div>
      <div className="fixed-bottom-fade" />
    </main>
  )
}
