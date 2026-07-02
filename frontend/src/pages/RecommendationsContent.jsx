import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { movieService } from '../services/movieService'
import { searchService } from '../services/searchService'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import FilterDropdown from '../components/FilterDropdown'
import '../pages/Explore.css'
import './RecommendationsContent.css'
import '../components/AddContentModal.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const MAX_BASKET_ITEMS = 10

// --- Filter Constants ---
const SORT_OPTIONS = [
  { value: 'popularity',   label: 'Most Popular' },
  { value: 'rating',       label: 'Top Rated' },
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
  { id: '194232', label: 'Apple Studios' },
  { id: '20580', label: 'Amazon Studios' },
  { id: '3268', label: 'HBO' },
]

const COUNTRIES = [
  { code: 'US', label: 'USA' },
  { code: 'IN', label: 'India' },
  { code: 'GB', label: 'UK' },
  { code: 'KR', label: 'South Korea' },
  { code: 'JP', label: 'Japan' },
  { code: 'FR', label: 'France' },
]

const PROVIDERS = [
  { id: '8', label: 'Netflix' },
  { id: '119', label: 'Prime Video' },
  { id: '122', label: 'Disney+ Hotstar' },
  { id: '220', label: 'JioCinema' },
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

// --- Result Card (acm-panel style) ---
function ResultCard({ item, isAdded, isLoading, onAdd }) {
  const poster = item.poster_path ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}` : null
  const year   = item.release_year || (item.release_date ? item.release_date.slice(0, 4) : '')

  return (
    <div className="acm-card">
      <div className="acm-card__poster-wrap">
        {poster ? (
          <img src={poster} alt={item.title || item.name} className="acm-card__poster" loading="lazy" />
        ) : (
          <div className="acm-card__poster acm-card__poster--fallback">
            <span>{(item.title || item.name)?.[0] ?? '?'}</span>
          </div>
        )}
        <button
          className={`acm-card__add-btn ${isAdded ? 'is-added' : ''} ${isLoading ? 'is-loading' : ''}`}
          onClick={() => !isAdded && !isLoading && onAdd(item)}
          disabled={isAdded || isLoading}
        >
          {isLoading ? (
            <span className="acm-spinner" />
          ) : isAdded ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
        </button>
      </div>
      <div className="acm-card__info">
        <p className="acm-card__title">{item.title || item.name}</p>
        {year && <p className="acm-card__year">{year}</p>}
      </div>
    </div>
  )
}

export default function RecommendationsContent() {
  // Basket state
  const [basket, setBasket] = useState([])
  const [commonTraits, setCommonTraits] = useState({ genres: [] })

  // Results state
  const [movies, setMovies] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const isFetchingRef = useRef(false)
  const observerRef = useRef(null)

  // ACM Panel state
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)
  
  const inputRef    = useRef(null)
  const debounceRef = useRef(null)
  const abortRef    = useRef(null)

  // ── Filter state ──────────────────────────────────────────
  const [selectedGenres, setSelectedGenres] = useState([])
  const [selectedType, setSelectedType] = useState('')
  const [selectedCompanies, setSelectedCompanies] = useState([])
  const [selectedCountries, setSelectedCountries] = useState([])
  const [selectedProviders, setSelectedProviders] = useState([])
  const [minRating,  setMinRating]  = useState(0)
  const [yearFrom,   setYearFrom]   = useState(1900)
  const [yearTo,     setYearTo]     = useState(CURRENT_YEAR)
  const [sort,       setSort]       = useState('popularity')
  const [ageRating,  setAgeRating]  = useState('')

  // 1. Manage Basket
  const addToBasket = (item) => {
    if (basket.length >= MAX_BASKET_ITEMS) return
    const itemId = Number(item.id)
    if (basket.some(b => b.tmdb_id === itemId && b.media_type === (item.media_type || 'movie'))) return

    const newItem = {
      tmdb_id: itemId,
      media_type: item.media_type || 'movie',
      title: item.title || item.name,
      poster_path: item.poster_path
    }
    setBasket([...basket, newItem])
  }

  const removeFromBasket = (id, type) => {
    setBasket(basket.filter(b => !(b.tmdb_id === id && b.media_type === type)))
  }

  // 2. Fetch Recommendations
  const fetchRecommendations = useCallback(async (p, isInitial = false) => {
    if (basket.length === 0) return
    if (isFetchingRef.current && !isInitial) return
    isFetchingRef.current = true

    if (isInitial) {
      setLoading(true)
      setError(null)
      setMovies([])
    } else {
      setLoadingMore(true)
    }

    try {
      const data = await movieService.getContentBasketRecommendations(basket, p)
      const newMovies = data.movies || []
      
      if (isInitial) {
        setMovies(newMovies)
        setCommonTraits(data.common_traits || { genres: [] })
      } else {
        setMovies(prev => {
          const existing = new Set(prev.map(m => `${m.id}-${m.media_type}`))
          const unique = newMovies.filter(m => !existing.has(`${m.id}-${m.media_type}`))
          return [...prev, ...unique]
        })
      }
      setHasMore(newMovies.length > 0 && p < (data.total_pages || 10000))
    } catch (err) {
      if (isInitial) setError("Failed to fetch recommendations. Try adjusting your basket.")
    } finally {
      isFetchingRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [basket])

  const handleFindSimilar = () => {
    setPage(1)
    fetchRecommendations(1, true)
  }

  useEffect(() => {
    if (basket.length === 0) {
      setMovies([])
      setCommonTraits({ genres: [] })
      setPage(1)
      setHasMore(false)
    }
  }, [basket.length])

  // Infinite Scroll Trigger
  useEffect(() => {
    if (page > 1) {
      fetchRecommendations(page, false)
    }
  }, [page, fetchRecommendations])

  useEffect(() => {
    if (loading || loadingMore || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingRef.current && hasMore) {
          setPage(p => p + 1)
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

  // ACM Search Logic
  const handleQueryChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)

    clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()

    if (!val.trim() || val.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller

      setSearching(true)
      setSearchError(null)

      searchService
        .instantSearch(val.trim(), 'content', controller.signal)
        .then((data) => {
          const arr = Array.isArray(data) ? data : (data?.results || [])
          setResults(arr.slice(0, 20))
        })
        .catch((err) => {
          if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
            setSearchError('Search failed. Try again.')
          }
        })
        .finally(() => setSearching(false))
    }, 300)
  }, [])

  const showEmpty = !searching && !searchError && query.trim().length >= 2 && results.length === 0

  // 3. Filter Actions & Logic
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
    ageRating !== ''

  const filteredMovies = useMemo(() => {
    let result = [...movies]
    
    // Apply local filters since API does not support them currently for recommendations
    if (selectedType) {
      result = result.filter(m => m.media_type === selectedType)
    }
    if (minRating > 0) {
      result = result.filter(m => (m.vote_average || 0) >= minRating)
    }
    if (yearFrom > 1900 || yearTo < CURRENT_YEAR) {
      result = result.filter(m => {
        const dateStr = m.release_date || m.first_air_date
        if (!dateStr) return false
        const y = parseInt(dateStr.substring(0, 4), 10)
        return y >= yearFrom && y <= yearTo
      })
    }
    if (selectedGenres.length > 0) {
      result = result.filter(m => {
        if (!m.genre_ids) return false
        return true 
      })
    }
    
    // Apply sort
    result.sort((a, b) => {
      if (sort === 'rating') return (b.vote_average || 0) - (a.vote_average || 0)
      if (sort === 'release_date') {
        const aDate = new Date(a.release_date || a.first_air_date || '1900-01-01').getTime()
        const bDate = new Date(b.release_date || b.first_air_date || '1900-01-01').getTime()
        return bDate - aDate
      }
      if (sort === 'title') {
        const aTitle = a.title || a.name || ''
        const bTitle = b.title || b.name || ''
        return aTitle.localeCompare(bTitle)
      }
      return (b.popularity || 0) - (a.popularity || 0)
    })
    
    return result
  }, [movies, selectedType, minRating, yearFrom, yearTo, selectedGenres, sort])

  return (
    <main className="explore-page page-content">
      <div className="explore-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#00C2FF", "#7B2FBE", "#FF0080"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="explore-aurora-overlay" />
      </div>

      <div className="explore-page__inner" style={{ paddingTop: '60px' }}>
        <header className="explore-header-section" style={{ textAlign: 'center', marginBottom: '24px' }}>
          <h1 className="explore-hero-title">Content DNA</h1>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '16px', marginTop: '8px' }}>
            Mix movies and TV shows to discover unique recommendations
          </p>
        </header>

        <section className="reccontent-search-section">
          {/* ACM Panel integrated directly */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '24px' }}>
            <div className="acm-panel" style={{ position: 'relative', margin: '0 auto', animation: 'none', transform: 'none', borderBottom: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '20px' }}>
              <div className="acm-search-wrap">
                <svg className="acm-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={inputRef}
                  id="acm-search-input"
                  className="acm-search-input"
                  type="search"
                  value={query}
                  onChange={handleQueryChange}
                  placeholder="Search movies & TV shows..."
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Search content"
                />
                {searching && <span className="acm-search-spinner" />}
              </div>
              
              <div className="acm-results-wrap" style={{ maxHeight: query.trim().length >= 2 ? '400px' : '0px', overflowY: 'auto', overflowX: 'hidden', transition: 'max-height 0.3s ease', paddingBottom: 0 }}>
                {searchError && (
                  <div className="acm-state-msg acm-state-msg--error">
                    <p>{searchError}</p>
                  </div>
                )}
                {showEmpty && (
                  <div className="acm-state-msg">
                    <span className="acm-state-icon">😶</span>
                    <p>No results for "<strong>{query}</strong>"</p>
                  </div>
                )}
                {results.length > 0 && (
                  <>
                    <p className="acm-results-label">SEARCH RESULTS</p>
                    <div className="acm-results-scroll">
                      {results.map((item) => (
                        <ResultCard
                          key={item.id}
                          item={item}
                          isAdded={basket.some(b => b.tmdb_id === Number(item.id) && b.media_type === (item.media_type || 'movie'))}
                          isLoading={false}
                          onAdd={addToBasket}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="reccontent-basket">
            {basket.map((b) => {
              const posterUrl = b.poster_path ? `${TMDB_IMAGE_BASE}/w92${b.poster_path}` : null
              return (
                <div key={`${b.tmdb_id}-${b.media_type}`} className="reccontent-chip">
                  {posterUrl ? (
                    <img src={posterUrl} alt="" className="reccontent-chip-poster" />
                  ) : (
                    <div className="reccontent-chip-poster" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '0 4px' }}>
                    <span className="reccontent-chip-title">{b.title}</span>
                    <span style={{ display: 'flex' }}>
                      <span className="reccontent-chip-type">
                        {b.media_type === 'movie' ? 'MOVIE' : 'TV'}
                      </span>
                    </span>
                  </div>
                  <button 
                    className="reccontent-chip-remove"
                    onClick={() => removeFromBasket(b.tmdb_id, b.media_type)}
                    aria-label="Remove item"
                  >
                    &times;
                  </button>
                </div>
              )
            })}
          </div>

          {basket.length > 0 && (
            <button 
              className="reccontent-find-btn"
              onClick={handleFindSimilar}
              disabled={loading || basket.length === 0}
            >
              {loading ? 'Analyzing DNA...' : `Find Content Similar to these ${basket.length} ${basket.length === 1 ? 'item' : 'items'}`}
            </button>
          )}

          {commonTraits.genres && commonTraits.genres.length > 0 && movies.length > 0 && (
            <div className="reccontent-traits-bar">
              <span className="reccontent-traits-label">Shared DNA:</span>
              {commonTraits.genres.map(g => (
                <span key={g} className="reccontent-trait-tag">{g}</span>
              ))}
            </div>
          )}
        </section>

        <div style={{
          background: 'rgba(255, 165, 0, 0.1)',
          border: '1px solid rgba(255, 165, 0, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          margin: '0 auto 24px auto',
          maxWidth: '600px',
          color: '#ffb74d',
          textAlign: 'center',
          fontSize: '14px',
          fontWeight: '500'
        }}>
          🚧 Work in Progress: We're upgrading this page currently and upgrading its system to give more enhanced results till then you can try with our current system!
        </div>

        {/* DNA Graph Preview Animation */}
        <div style={{
          maxWidth: '800px',
          margin: '0 auto 32px auto',
          background: 'rgba(18, 18, 18, 0.6)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '16px',
          padding: '24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px'
        }}>
          <div style={{ fontSize: '15px', color: 'rgba(255,255,255,0.7)' }}>
            <strong>How it works:</strong> Our AI extracts content DNA (Genres, Keywords, Cast) to build a relational graph.
          </div>
          <div style={{ display: 'flex', gap: '40px', alignItems: 'center' }}>
            {/* Mock Node 1 */}
            <div style={{
              width: '100px', height: '140px', background: 'var(--surface-card)',
              borderRadius: '8px', border: '1px solid rgba(0, 194, 255, 0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 15px rgba(0, 194, 255, 0.2)', fontSize: '32px'
            }}>🎬</div>
            {/* Edges */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', color: '#00C2FF', fontSize: '12px', fontWeight: 'bold' }}>
              <span style={{ borderBottom: '2px dashed rgba(0, 194, 255, 0.4)', paddingBottom: '4px' }}>Shared Genre ↔</span>
              <span style={{ borderBottom: '2px dashed rgba(123, 47, 190, 0.4)', paddingBottom: '4px', color: '#c084fc' }}>Same Director ↔</span>
              <span style={{ borderBottom: '2px dashed rgba(255, 0, 128, 0.4)', paddingBottom: '4px', color: '#FF0080' }}>Shared Vibe ↔</span>
            </div>
            {/* Mock Node 2 */}
            <div style={{
              width: '100px', height: '140px', background: 'var(--surface-card)',
              borderRadius: '8px', border: '1px solid rgba(255, 0, 128, 0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 15px rgba(255, 0, 128, 0.2)', fontSize: '32px'
            }}>📺</div>
          </div>
        </div>



        {/* --- Explore Page Filter Section (shown after results come) --- */}
        {movies.length > 0 && (
          <div className="explore-filter-bar" style={{ marginTop: '32px', marginBottom: '32px' }}>
            <div className="explore-filter-row">
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

              <FilterDropdown
                label={
                  (selectedCompanies.length + selectedProviders.length) > 0 
                    ? `More (${selectedCompanies.length + selectedProviders.length})` 
                    : 'More'
                }
                active={(selectedCompanies.length + selectedProviders.length) > 0}
              >
                <div className="filter-dropdown__custom-container filter-dropdown__custom-container--scrollable" style={{ minWidth: '280px', maxHeight: '380px', overflowY: 'auto', gap: '16px' }}>
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
        )}

        {/* --- Results Section --- */}
        {error && (
          <div className="error-state">{error}</div>
        )}

        {!error && (filteredMovies.length > 0 || loading) && (
          <>
            <StaggerContainer className="explore-grid" instant={false}>
              {filteredMovies.map((m, index) => (
                <StaggerItem key={`${m.id}-${m.media_type}`} index={index}>
                  <MovieCard movie={m} />
                </StaggerItem>
              ))}
              {loading && <MovieCardSkeleton count={10} />}
              {loadingMore && <MovieCardSkeleton count={5} />}
            </StaggerContainer>

            <div ref={observerRef} style={{ height: 20, margin: '20px 0' }} />

            {!loading && !loadingMore && !hasMore && (
              <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', margin: '40px 0 20px', fontSize: '13px' }}>
                End of results.
              </p>
            )}
          </>
        )}
      </div>
      <div className="fixed-bottom-fade" />
    </main>
  )
}
