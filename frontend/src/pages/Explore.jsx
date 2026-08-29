/**
 * Explore.jsx — Filtered movie browse with Infinite Scroll
 *
 * Route: /explore
 * Endpoint: GET /api/v1/movies/explore
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import axios from 'axios'
import api from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useSessionState } from '../hooks/useSessionState'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import FilterDropdown from '../components/FilterDropdown'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import './Explore.css'

const SORT_OPTIONS = [
  { value: 'popularity',   label: 'Most Popular' },
  { value: 'rating',       label: 'Top Rated' },
  { value: 'moctale',      label: 'Moctale Score' },
  { value: 'release_date', label: 'Newest First' },
  { value: 'title',        label: 'A – Z' },
]

const AGE_RATING_OPTIONS = [
  { value: '', label: 'Any Age' },
  { value: 'kids', label: 'Kids & Family (PG and below)' },
  { value: 'teens', label: 'Teens (PG-13 and below)' },
]

const TYPE_OPTIONS = [
  { value: '',      label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv',    label: 'Series' },
  { value: 'anime', label: 'Anime' },
]

const CINEMA_OPTIONS = [
  { value: '', label: 'All Cinema' },
  { value: 'hollywood', label: 'Hollywood' },
  { value: 'bollywood', label: 'Bollywood' },
  { value: 'tollywood', label: 'Tollywood' },
  { value: 'kollywood', label: 'Kollywood' },
  { value: 'mollywood', label: 'Mollywood' },
  { value: 'sandalwood', label: 'Sandalwood' },
  { value: 'kdrama', label: 'K-Drama' },
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
  { id: '194232', label: 'Apple Studios' },
  { id: '20580', label: 'Amazon Studios' },
  { id: '3268', label: 'HBO' },
  { id: '14439', label: 'Lionsgate' },
  { id: '25', label: '20th Century Studios' },
  { id: '10146', label: 'Focus Features' },
  { id: '1088', label: 'Illumination' },
  { id: '3', label: 'Pixar' },
  { id: '56', label: 'Amblin Entertainment' },
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
  { id: '122,337', label: 'Disney' },
  { id: '1899', label: 'HBO' },
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
  const { isLoggedIn } = useAuth()

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
  const [ageRating,  setAgeRating]  = useState(() => searchParams.get('age_rating') ?? '')
  const [selectedCinema, setSelectedCinema] = useState(() => searchParams.get('cinema') ?? '')
  const [page,       setPage]       = useSessionState('explore_page', () => Number(searchParams.get('page') ?? 1))

  // ── Debounced state for sliders/inputs ────────────────────
  const [debouncedMinRating, setDebouncedMinRating] = useState(minRating)
  const [debouncedYearFrom, setDebouncedYearFrom] = useState(yearFrom)
  const [debouncedYearTo, setDebouncedYearTo] = useState(yearTo)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedMinRating(minRating)
    }, 400)
    return () => clearTimeout(handler)
  }, [minRating])

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedYearFrom(yearFrom)
      setDebouncedYearTo(yearTo)
    }, 400)
    return () => clearTimeout(handler)
  }, [yearFrom, yearTo])

  // ── Data ──────────────────────────────────────────────────
  const [movies,    setMovies]    = useSessionState('explore_movies', [])
  const [allGenres, setAllGenres] = useSessionState('explore_allGenres', [])
  const [total,     setTotal]     = useSessionState('explore_total', 0)
  const [hasMore,    setHasMore]   = useSessionState('explore_hasMore', true)
  
  const [loading,   setLoading]   = useState(movies.length === 0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,     setError]     = useState(null)

  const [lastExploreQuery, setLastExploreQuery] = useSessionState('explore_query', '')

  const currentQueryStr = [
    selectedGenres.join(','),
    selectedCompanies.join(','),
    selectedCountries.join(','),
    selectedProviders.join(','),
    debouncedMinRating,
    debouncedYearFrom,
    debouncedYearTo,
    sort,
    selectedType,
    ageRating,
    selectedCinema
  ].join('|')

  const isMounted = useRef(false)
  const isPageMounted = useRef(false)
  const initialQueryMatch = useRef(currentQueryStr === lastExploreQuery)

  const LIMIT = 24
  const observerRef = useRef(null)
  const abortControllerRef = useRef(null)
  const isFetchingRef = useRef(false)

  // ── Fetch ─────────────────────────────────────────────────
  const fetchMovies = useCallback(async (p, isInitial = false) => {
    if (isFetchingRef.current && !isInitial) return
    isFetchingRef.current = true

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

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
      if (debouncedMinRating > 0)        params.min_rating = debouncedMinRating
      if (debouncedYearFrom > 1900)      params.year_from  = debouncedYearFrom
      if (debouncedYearTo < CURRENT_YEAR) params.year_to    = debouncedYearTo
      if (selectedType)                  params.type       = selectedType
      if (ageRating)                     params.age_rating = ageRating
      if (selectedCinema)                params.cinema     = selectedCinema

      const r = await api.get('/api/v1/movies/explore', { 
        params,
        signal: controller.signal 
      })
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
    } catch (err) {
      if (!axios.isCancel(err) && err.name !== 'AbortError') {
        setError('Failed to load movies')
      }
    } finally {
      isFetchingRef.current = false
      if (abortControllerRef.current === controller) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [selectedGenres, selectedCompanies, selectedCountries, selectedProviders, debouncedMinRating, debouncedYearFrom, debouncedYearTo, sort, selectedType, ageRating, selectedCinema])

  // Reset page and movies list when filters change
  useEffect(() => {
    console.log('[Explore Mount/Update] isMounted:', isMounted.current, 'initialQueryMatch:', initialQueryMatch.current, 'moviesCount:', movies?.length, 'currentQueryStr:', currentQueryStr, 'lastExploreQuery:', lastExploreQuery)
    
    if (!isMounted.current) {
      isMounted.current = true
      if (initialQueryMatch.current && movies.length > 0) {
        console.log('[Explore Mount] Cache hit! Keeping cached movies and skipping fetch')
        setLoading(false)
        return // Skip initial reset/fetch since cache matches URL
      }
      console.log('[Explore Mount] Cache miss or empty movies. Resetting states and fetching page 1')
    } else {
      // Scroll to top when filters are modified
      window.scrollTo(0, 0)
    }

    setLastExploreQuery(currentQueryStr)

    isFetchingRef.current = false
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
    if (debouncedMinRating > 0)    p.min_rating = String(debouncedMinRating)
    if (debouncedYearFrom > 1900)  p.year_from  = String(debouncedYearFrom)
    if (debouncedYearTo < CURRENT_YEAR) p.year_to = String(debouncedYearTo)
    if (sort !== 'popularity')     p.sort       = sort
    if (selectedType)              p.type       = selectedType
    if (ageRating)                 p.age_rating = ageRating
    if (selectedCinema)            p.cinema     = selectedCinema
    setSearchParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenres, selectedCompanies, selectedCountries, selectedProviders, debouncedMinRating, debouncedYearFrom, debouncedYearTo, sort, selectedType, ageRating, selectedCinema])

  // Fetch subsequent pages when page increments
  useEffect(() => {
    if (!isPageMounted.current) {
      isPageMounted.current = true
      if (initialQueryMatch.current && movies.length > 0) {
        return // Skip fetching subsequent pages on mount if cached
      }
    }

    if (page > 1) {
      fetchMovies(page, false)

      // Sync URL page parameter
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('page', String(page))
        return next
      }, { replace: true, preventScrollReset: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  // Infinite scroll trigger
  useEffect(() => {
    if (loading || loadingMore || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingRef.current && hasMore) {
          setPage((prev) => prev + 1)
        }
      },
      { threshold: 0.05, rootMargin: '300px' }
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

  // ── Toggles ──────────────────────────────────────────────
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
    setAgeRating('')
    setSelectedCinema('')
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
    selectedType !== '' ||
    ageRating !== '' ||
    selectedCinema !== ''

  const getHeroTitle = () => {
    if (selectedGenres.length === 1) {
      return selectedGenres[0]
    }
    if (selectedType === 'movie') return 'Movies'
    if (selectedType === 'tv') return 'Series'
    if (selectedType === 'anime') return 'Anime'
    return 'Explore'
  }

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

      <div className="explore-page__inner">
        {/* Category Hero Title */}
        <header className="explore-header-section">
          <span className="explore-category-tag">Category</span>
          <h1 className="explore-hero-title">{getHeroTitle()}</h1>
        </header>

        {/* ── Horizontal Filter Bar ── */}
        <div className="explore-filter-bar">
          <div className="explore-filter-row">
            {/* Type Pills */}
            <div className="filter-pills">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className={`filter-pill ${selectedType === opt.value ? 'active' : ''}`}
                  onClick={() => setSelectedType(opt.value)}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Cinema Dropdown */}
            <FilterDropdown
              label={`Cinema: ${CINEMA_OPTIONS.find(o => o.value === selectedCinema)?.label || 'All Cinema'}`}
              active={selectedCinema !== ''}
            >
              <div className="filter-dropdown__menu-list">
                {CINEMA_OPTIONS.map((o) => (
                  <label key={o.value} className={`filter-dropdown__menu-item ${selectedCinema === o.value ? 'filter-dropdown__menu-item--active' : ''}`}>
                    <input
                      type="radio"
                      name="cinema-option"
                      className="filter-dropdown__radio"
                      checked={selectedCinema === o.value}
                      onChange={() => setSelectedCinema(o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </FilterDropdown>

            {/* Genre Dropdown */}
            <FilterDropdown 
              label={selectedGenres.length > 0 ? `Genre (${selectedGenres.length})` : 'Genre'}
              active={selectedGenres.length > 0}
            >
              <div className="filter-dropdown__menu-list">
                {allGenres.map((g) => (
                  <label key={g} className={`filter-dropdown__menu-item ${selectedGenres.includes(g) ? 'filter-dropdown__menu-item--active' : ''}`}>
                    <input
                      type="checkbox"
                      className="filter-dropdown__checkbox"
                      checked={selectedGenres.includes(g)}
                      onChange={() => toggleGenre(g)}
                    />
                    <span>{g}</span>
                  </label>
                ))}
              </div>
            </FilterDropdown>

            {/* Sort Dropdown */}
            <FilterDropdown
              label={`Sort: ${SORT_OPTIONS.find(o => o.value === sort)?.label || 'Most Popular'}`}
              active={sort !== 'popularity'}
            >
              <div className="filter-dropdown__menu-list">
                {SORT_OPTIONS.map((o) => (
                  <label key={o.value} className={`filter-dropdown__menu-item ${sort === o.value ? 'filter-dropdown__menu-item--active' : ''}`}>
                    <input
                      type="radio"
                      name="sort-option"
                      className="filter-dropdown__radio"
                      checked={sort === o.value}
                      onChange={() => setSort(o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </FilterDropdown>

            {/* Countries Dropdown */}
            <FilterDropdown
              label={selectedCountries.length > 0 ? `Countries (${selectedCountries.length})` : 'Countries'}
              active={selectedCountries.length > 0}
            >
              <div className="filter-dropdown__menu-list filter-dropdown__custom-container--scrollable" style={{ maxHeight: '380px', overflowY: 'auto' }}>
                {COUNTRIES.map((c) => (
                  <label key={c.code} className={`filter-dropdown__menu-item ${selectedCountries.includes(c.code) ? 'filter-dropdown__menu-item--active' : ''}`}>
                    <input
                      type="checkbox"
                      className="filter-dropdown__checkbox"
                      checked={selectedCountries.includes(c.code)}
                      onChange={() => toggleCountry(c.code)}
                    />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            </FilterDropdown>

            {/* Year Dropdown */}
            <FilterDropdown
              label={(yearFrom > 1900 || yearTo < CURRENT_YEAR) ? `Year: ${yearFrom}–${yearTo}` : 'Year'}
              active={yearFrom > 1900 || yearTo < CURRENT_YEAR}
            >
              <div className="filter-dropdown__custom-container">
                <div className="filter-dropdown__input-group">
                  <div className="filter-dropdown__input-field">
                    <label>From</label>
                    <input
                      type="number"
                      min="1900"
                      max={CURRENT_YEAR}
                      value={yearFrom}
                      onChange={(e) => setYearFrom(Number(e.target.value) || 1900)}
                    />
                  </div>
                  <div className="filter-dropdown__input-field">
                    <label>To</label>
                    <input
                      type="number"
                      min="1900"
                      max={CURRENT_YEAR}
                      value={yearTo}
                      onChange={(e) => setYearTo(Number(e.target.value) || CURRENT_YEAR)}
                    />
                  </div>
                </div>
                
                {/* Preset Decades */}
                <div className="filter-dropdown__presets">
                  {[
                    { label: '2020s', start: 2020, end: CURRENT_YEAR },
                    { label: '2010s', start: 2010, end: 2019 },
                    { label: '2000s', start: 2000, end: 2009 },
                    { label: '1990s', start: 1990, end: 1999 },
                    { label: '1980s', start: 1980, end: 1989 },
                    { label: 'Clear', start: 1900, end: CURRENT_YEAR },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      className="filter-dropdown__preset-btn"
                      onClick={() => {
                        setYearFrom(preset.start)
                        setYearTo(preset.end)
                      }}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </FilterDropdown>

            {/* Rating Dropdown */}
            <FilterDropdown
              label={minRating > 0 ? `Rating: ★ ${minRating.toFixed(1)}+` : 'Rating'}
              active={minRating > 0}
            >
              <div className="filter-dropdown__custom-container" style={{ minWidth: '220px' }}>
                <RangeSlider
                  label="Min Rating"
                  min={0} max={10} step={0.5}
                  value={minRating}
                  onChange={setMinRating}
                  format={(v) => v === 0 ? 'Any' : `★ ${v.toFixed(1)}+`}
                />
              </div>
            </FilterDropdown>

            {/* Age Rating Dropdown */}
            <FilterDropdown
              label={`Age Rating: ${AGE_RATING_OPTIONS.find(o => o.value === ageRating)?.label || 'Any Age'}`}
              active={ageRating !== ''}
            >
              <div className="filter-dropdown__menu-list">
                {AGE_RATING_OPTIONS.map((o) => (
                  <label key={o.value} className={`filter-dropdown__menu-item ${ageRating === o.value ? 'filter-dropdown__menu-item--active' : ''}`}>
                    <input
                      type="radio"
                      name="age-rating-option"
                      className="filter-dropdown__radio"
                      checked={ageRating === o.value}
                      onChange={() => setAgeRating(o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </FilterDropdown>

            {/* More Filters Dropdown */}
            <FilterDropdown
              label={
                (selectedCompanies.length + selectedProviders.length) > 0 
                  ? `More (${selectedCompanies.length + selectedProviders.length})` 
                  : 'More'
              }
              active={(selectedCompanies.length + selectedProviders.length) > 0}
            >
              <div className="filter-dropdown__custom-container filter-dropdown__custom-container--scrollable" style={{ minWidth: '280px', maxHeight: '380px', overflowY: 'auto', gap: '16px' }}>
                {/* Production Companies */}
                <div>
                  <span className="filter-section-header">Production Houses</span>
                  <div className="filter-dropdown__options-grid" style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' }}>
                    {COMPANIES.map((c) => (
                      <label key={c.id} className={`filter-dropdown__menu-item ${selectedCompanies.includes(c.id) ? 'filter-dropdown__menu-item--active' : ''}`}>
                        <input
                          type="checkbox"
                          className="filter-dropdown__checkbox"
                          checked={selectedCompanies.includes(c.id)}
                          onChange={() => toggleCompany(c.id)}
                        />
                        <span>{c.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Providers */}
                <div>
                  <span className="filter-section-header">OTT Platforms</span>
                  <div className="filter-dropdown__options-grid" style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '6px' }}>
                    {PROVIDERS.map((p) => (
                      <label key={p.id} className={`filter-dropdown__menu-item ${selectedProviders.includes(p.id) ? 'filter-dropdown__menu-item--active' : ''}`}>
                        <input
                          type="checkbox"
                          className="filter-dropdown__checkbox"
                          checked={selectedProviders.includes(p.id)}
                          onChange={() => toggleProvider(p.id)}
                        />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </FilterDropdown>

            {/* Clear All Button */}
            {hasFilters && (
              <button 
                type="button" 
                className="filter-clear-all-btn"
                onClick={clearAll}
              >
                Reset Filters
              </button>
            )}
          </div>
        </div>

        {/* ── Results Meta & Active Chips ── */}
        <div className="explore-results-meta">
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

          {hasFilters && (
            <div className="explore-active-chips">
              {selectedType && (
                <button key="active-chip-type" className="explore-active-chip" onClick={() => setSelectedType('')}>
                  {selectedType === 'movie' ? 'Movies' : selectedType === 'tv' ? 'TV Shows' : 'Anime'} ×
                </button>
              )}
              {selectedCinema && (
                <button key="active-chip-cinema" className="explore-active-chip" onClick={() => setSelectedCinema('')}>
                  {CINEMA_OPTIONS.find(o => o.value === selectedCinema)?.label} ×
                </button>
              )}
              {selectedGenres.map((g) => (
                <button key={g} className="explore-active-chip" onClick={() => toggleGenre(g)}>
                  {g} ×
                </button>
              ))}
              {(yearFrom > 1900 || yearTo < CURRENT_YEAR) && (
                <button className="explore-active-chip" onClick={() => { setYearFrom(1900); setYearTo(CURRENT_YEAR) }}>
                  Year: {yearFrom > 1900 ? yearFrom : 'Any'}–{yearTo < CURRENT_YEAR ? yearTo : 'Now'} ×
                </button>
              )}
              {minRating > 0 && (
                <button className="explore-active-chip" onClick={() => setMinRating(0)}>
                  Rating: ★ {minRating.toFixed(1)}+ ×
                </button>
              )}
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
              {ageRating && (
                <button key="active-chip-age" className="explore-active-chip" onClick={() => setAgeRating('')}>
                  {AGE_RATING_OPTIONS.find(o => o.value === ageRating)?.label} ×
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="error-state">{error}</div>
        )}

        {/* Grid and Skeletons */}
        {!error && (movies.length > 0 || loading) && (
          <>
            <StaggerContainer className="explore-grid" instant={false}>
              {movies.map((m, index) => (
                <StaggerItem key={`${m.id}-${m.media_type}`} index={index}>
                  <MovieCard movie={m} />
                </StaggerItem>
              ))}
              {loading && <MovieCardSkeleton count={24} />}
              {loadingMore && <MovieCardSkeleton count={8} />}
            </StaggerContainer>

            <div ref={observerRef} style={{ height: 20, margin: '20px 0' }} />

            {!loading && !loadingMore && !hasMore && (
              <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', margin: '40px 0 20px', fontSize: '13px' }}>
                No more titles to load.
              </p>
            )}
          </>
        )}

        {!loading && !error && movies.length === 0 && (
          <div className="empty-state">
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
            <h3>No movies match these filters</h3>
            <p>Try removing some filters</p>
            <button className="filter-clear-all-btn" style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', borderRadius: '6px' }} onClick={clearAll}>
              Reset filters
            </button>
          </div>
        )}
      </div>
      <div className="fixed-bottom-fade" />
    </main>
  )
}

