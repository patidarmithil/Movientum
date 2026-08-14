import { useState, useEffect, useRef, useCallback } from 'react'
import { movieService } from '../services/movieService'
import { searchService } from '../services/searchService'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import FilterDropdown from '../components/FilterDropdown'
import ShinyText from '../components/ShinyText'
import '../pages/Explore.css'
import './RecommendationsContent.css'
import '../components/AddContentModal.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const MAX_BASKET_ITEMS = 10

// --- Filter Constants ---
const SORT_OPTIONS = [
  { value: 'relevance', label: 'Best Match' },
  { value: 'popularity', label: 'Most Popular' },
  { value: 'rating',     label: 'Top Rated' },
  { value: 'year',       label: 'Newest First' },
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

// Providers/age-rating dropped (plans/dna.md §3.1) — content_catalog carries
// neither watch-provider nor certification data, so those controls would be
// dead weight the server can never honor.

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
function ResultCard({ item, isAdded, isLoading, onAdd, onAddNeg }) {
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
        {onAddNeg && (
          <button
            className="acm-card__add-btn"
            style={{ left: '6px', right: 'auto', background: 'rgba(255, 0, 128, 0.25)' }}
            onClick={() => onAddNeg(item)}
            title="Less like this"
            aria-label="Add to less-like-this"
          >
            &minus;
          </button>
        )}
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
  const [negBasket, setNegBasket] = useState([])          // "less like this" (§3.3)
  const [ignoreTaste, setIgnoreTaste] = useState(false)    // personalization opt-out (§3.2)
  const [dna, setDna] = useState(null)

  // Results state
  const [movies, setMovies] = useState([])
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  // Scroll loads 20 at a time up to a 200-item cap, then stops and asks
  // before loading the next 200 (rather than auto-scrolling indefinitely).
  const SCROLL_BATCH_CAP = 200
  const [capLimit, setCapLimit] = useState(SCROLL_BATCH_CAP)
  const cappedHasMore = hasMore && movies.length < capLimit
  const capReached = hasMore && movies.length >= capLimit

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

  // ── Filter state (server-side, §3.1) ────────────────────────
  const [selectedGenres, setSelectedGenres] = useState([])
  const [selectedType, setSelectedType] = useState('')
  const [selectedCompanies, setSelectedCompanies] = useState([])
  const [selectedCountries, setSelectedCountries] = useState([])
  const [minRating,  setMinRating]  = useState(0)
  const [yearFrom,   setYearFrom]   = useState(1900)
  const [yearTo,     setYearTo]     = useState(CURRENT_YEAR)
  const [sort,       setSort]       = useState('relevance')

  const filterDebounceRef = useRef(null)

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

  const addToNegBasket = (item) => {
    const itemId = Number(item.id)
    const mediaType = item.media_type || 'movie'
    if (negBasket.length >= MAX_BASKET_ITEMS) return
    if (negBasket.some(b => b.tmdb_id === itemId && b.media_type === mediaType)) return
    setNegBasket([...negBasket, {
      tmdb_id: itemId, media_type: mediaType,
      title: item.title || item.name, poster_path: item.poster_path,
    }])
  }

  const removeFromNegBasket = (id, type) => {
    setNegBasket(negBasket.filter(b => !(b.tmdb_id === id && b.media_type === type)))
  }

  // Server-side filters payload — narrows the full ranked pool, not the
  // 20 items on screen (§3.1).
  const buildFilters = useCallback(() => ({
    media_type: selectedType || null,
    genres: selectedGenres,
    languages: [],
    countries: selectedCountries,
    studios: selectedCompanies.map(Number),
    year_from: yearFrom > 1900 ? yearFrom : null,
    year_to: yearTo < CURRENT_YEAR ? yearTo : null,
    min_rating: minRating,
    sort,
  }), [selectedType, selectedGenres, selectedCountries, selectedCompanies, yearFrom, yearTo, minRating, sort])

  // 2. Fetch Recommendations
  const fetchRecommendations = useCallback(async (p, isInitial = false) => {
    if (basket.length === 0) return
    if (isFetchingRef.current && !isInitial) return
    isFetchingRef.current = true

    if (isInitial) {
      setLoading(true)
      setError(null)
      setMovies([])
      setCapLimit(SCROLL_BATCH_CAP)
    } else {
      setLoadingMore(true)
    }

    try {
      const data = await movieService.getContentBasketRecommendations(basket, p, {
        filters: buildFilters(),
        negativeItems: negBasket,
        ignoreTaste,
      })
      const newMovies = data.movies || []

      if (isInitial) {
        setMovies(newMovies)
        setDna(data.dna || null)
      } else {
        setMovies(prev => {
          const existing = new Set(prev.map(m => `${m.id}-${m.media_type}`))
          const unique = newMovies.filter(m => !existing.has(`${m.id}-${m.media_type}`))
          return [...prev, ...unique]
        })
      }
      setHasMore(newMovies.length > 0 && p < (data.total_pages || 1))
    } catch (err) {
      if (isInitial) setError("Failed to fetch recommendations. Try adjusting your basket.")
    } finally {
      isFetchingRef.current = false
      setLoading(false)
      setLoadingMore(false)
    }
  }, [basket, negBasket, ignoreTaste, buildFilters])

  const handleFindSimilar = () => {
    setPage(1)
    fetchRecommendations(1, true)
  }

  useEffect(() => {
    if (basket.length === 0) {
      setMovies([])
      setDna(null)
      setPage(1)
      setHasMore(false)
    }
  }, [basket.length])

  // Filters/sort/negative-basket change: refetch page 1, debounced (house
  // convention — 300ms) so a row of checkbox clicks doesn't fire N requests.
  useEffect(() => {
    if (basket.length === 0 || movies.length === 0) return
    clearTimeout(filterDebounceRef.current)
    filterDebounceRef.current = setTimeout(() => {
      setPage(1)
      fetchRecommendations(1, true)
    }, 300)
    return () => clearTimeout(filterDebounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType, selectedGenres, selectedCountries, selectedCompanies, yearFrom, yearTo, minRating, sort, negBasket, ignoreTaste])

  // Infinite Scroll Trigger
  useEffect(() => {
    if (page > 1) {
      fetchRecommendations(page, false)
    }
  }, [page, fetchRecommendations])

  useEffect(() => {
    if (loading || loadingMore || !cappedHasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingRef.current && cappedHasMore) {
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
  }, [loading, loadingMore, cappedHasMore])

  const loadNextBatch = () => {
    setCapLimit(c => c + SCROLL_BATCH_CAP)
    setPage(p => p + 1)
  }

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
  const toggleCompany = (c) =>
    setSelectedCompanies((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    )

  const toggleCountry = (c) =>
    setSelectedCountries((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
    )

  const clearAll = () => {
    setSelectedGenres([])
    setSelectedCompanies([])
    setSelectedCountries([])
    setMinRating(0)
    setYearFrom(1900)
    setYearTo(CURRENT_YEAR)
    setSort('relevance')
    setSelectedType('')
  }

  const hasFilters =
    selectedGenres.length > 0 ||
    selectedCompanies.length > 0 ||
    selectedCountries.length > 0 ||
    minRating > 0 ||
    yearFrom > 1900 ||
    yearTo < CURRENT_YEAR ||
    sort !== 'relevance' ||
    selectedType !== ''

  // Server already returns the filtered/sorted/paginated pool (§3.1) — no
  // client-side re-filtering.
  const filteredMovies = movies

  return (
    <main className="reccontent-page page-content">
      <div className="reccontent-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={['#00D4FF', '#FF006E', '#6A00D4']}
          blend={0.6}
          amplitude={1.2}
          speed={0.8}
        />
        <div className="reccontent-aurora-overlay" />
      </div>

      <div className="reccontent-page__inner">
        <header className="reccontent-header-section">
          <h1 className="reccontent-hero-title">
            <ShinyText text="Content DNA" />
          </h1>
          <p className="reccontent-hero-subtitle">
            Mix movies and shows to uncover recommendations unique to your taste
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
                          onAddNeg={addToNegBasket}
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

          {negBasket.length > 0 && (
            <div className="reccontent-basket" style={{ marginTop: '12px' }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '12px', alignSelf: 'center', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Less like:</span>
              {negBasket.map((b) => {
                const posterUrl = b.poster_path ? `${TMDB_IMAGE_BASE}/w92${b.poster_path}` : null
                return (
                  <div key={`neg-${b.tmdb_id}-${b.media_type}`} className="reccontent-chip" style={{ borderColor: 'rgba(255, 0, 128, 0.3)', background: 'rgba(255, 0, 128, 0.08)' }}>
                    {posterUrl ? (
                      <img src={posterUrl} alt="" className="reccontent-chip-poster" style={{ filter: 'grayscale(1)', opacity: 0.7 }} />
                    ) : (
                      <div className="reccontent-chip-poster" style={{ background: 'rgba(255,255,255,0.1)' }} />
                    )}
                    <span className="reccontent-chip-title">{b.title}</span>
                    <button
                      className="reccontent-chip-remove"
                      onClick={() => removeFromNegBasket(b.tmdb_id, b.media_type)}
                      aria-label="Remove item"
                    >
                      &times;
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {basket.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
              <button
                className="reccontent-find-btn"
                onClick={handleFindSimilar}
                disabled={loading || basket.length === 0}
              >
                {loading ? 'Analyzing DNA...' : `Find Content Similar to these ${basket.length} ${basket.length === 1 ? 'item' : 'items'}`}
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'rgba(255,255,255,0.55)', cursor: 'pointer', fontWeight: 500 }}>
                <input type="checkbox" checked={ignoreTaste} onChange={(e) => setIgnoreTaste(e.target.checked)} style={{ cursor: 'pointer' }} />
                Ignore my taste
              </label>
            </div>
          )}

          {dna && movies.length > 0 && (
            <div className="reccontent-dna-section">
              <div className="reccontent-dna-fingerprint">
                <div className="dna-content">
                  <div className="dna-header">
                    <span className="dna-precision-label">
                      {dna.precision === 'high' ? '🧬 High precision match'
                        : dna.precision === 'medium' ? `🧬 Add ${Math.max(0, 4 - basket.length)} more to sharpen results`
                        : '🧬 Add more titles to sharpen results'}
                    </span>
                    <div className="dna-traits">
                      {dna.language?.label && (
                        <span className="dna-trait dna-trait--language">
                          {dna.language.label} <span className="dna-trait-purity">{Math.round((dna.language.purity || 0) * 100)}%</span>
                        </span>
                      )}
                      {dna.media_type?.value && (
                        <span className="dna-trait dna-trait--media">
                          {dna.media_type.value === 'tv' ? 'TV' : 'Movies'} <span className="dna-trait-purity">{Math.round((dna.media_type.purity || 0) * 100)}%</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="dna-tags">
                    {(dna.keywords || []).map(k => (
                      <span key={`kw-${k.id}`} className="dna-tag dna-tag--keyword" style={{ opacity: 0.5 + Math.min(k.weight, 1) * 0.5 }}>{k.label}</span>
                    ))}
                    {(dna.genres || []).map(g => (
                      <span key={`g-${g.id}`} className="dna-tag dna-tag--genre">{g.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

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
                label={`Sort: ${SORT_OPTIONS.find(o => o.value === sort)?.label || 'Best Match'}`}
                active={sort !== 'relevance'}
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
                label={selectedCompanies.length > 0 ? `Studios (${selectedCompanies.length})` : 'Studios'}
                active={selectedCompanies.length > 0}
              >
                <div className="filter-dropdown__custom-container filter-dropdown__custom-container--scrollable" style={{ minWidth: '240px', maxHeight: '380px', overflowY: 'auto' }}>
                  <div className="filter-dropdown__options-grid" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
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

            {cappedHasMore && <div ref={observerRef} style={{ height: 20, margin: '20px 0' }} />}

            {!loading && !loadingMore && capReached && (
              <div style={{ textAlign: 'center', margin: '30px 0 20px' }}>
                <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '13px', marginBottom: '12px' }}>
                  Showing {movies.length} results. Keep going?
                </p>
                <button className="reccontent-find-btn" onClick={loadNextBatch}>
                  Load 200 more
                </button>
              </div>
            )}

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
