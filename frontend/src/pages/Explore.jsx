/**
 * Explore.jsx — Improvement 1.6
 *
 * Route: /explore
 * Endpoint: GET /api/v1/movies/explore
 *   ?genres=Action,Drama&min_rating=7&year_from=2000&year_to=2024&sort=popularity&page=1&limit=24
 *
 * Sidebar: genre multi-select pills, rating slider, year range, sort dropdown
 * Main: 4-col responsive poster grid + pagination
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import api from '../utils/api'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import './Explore.css'

const SORT_OPTIONS = [
  { value: 'popularity',   label: 'Most Popular' },
  { value: 'rating',       label: 'Top Rated' },
  { value: 'release_date', label: 'Newest First' },
  { value: 'title',        label: 'A – Z' },
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

  // ── Filter state ──────────────────────────────────────────
  const [selectedGenres, setSelectedGenres] = useState(
    () => searchParams.get('genres')?.split(',').filter(Boolean) ?? []
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
  const [error,     setError]     = useState(null)

  const LIMIT = 24
  const totalPages = Math.ceil(total / LIMIT) || 1

  // ── Fetch ─────────────────────────────────────────────────
  const fetchMovies = useCallback(async (filters) => {
    setLoading(true)
    setError(null)
    try {
      const params = {
        page:  filters.page,
        limit: LIMIT,
        sort:  filters.sort,
      }
      if (filters.genres.length)         params.genres     = filters.genres.join(',')
      if (filters.minRating > 0)         params.min_rating = filters.minRating
      if (filters.yearFrom > 1900)       params.year_from  = filters.yearFrom
      if (filters.yearTo < CURRENT_YEAR) params.year_to    = filters.yearTo

      const r = await api.get('/api/v1/movies/explore', { params })
      setMovies(r.data.movies ?? [])
      setTotal(r.data.total ?? 0)
      if (r.data.all_genres?.length) setAllGenres(r.data.all_genres)
    } catch {
      setError('Failed to load movies')
    } finally {
      setLoading(false)
    }
  }, [])

  // Sync URL params → fetch on every filter change
  useEffect(() => {
    const filters = { selectedGenres, minRating, yearFrom, yearTo, sort, page }

    // Update URL params
    const p = {}
    if (selectedGenres.length)     p.genres     = selectedGenres.join(',')
    if (minRating > 0)             p.min_rating = String(minRating)
    if (yearFrom > 1900)           p.year_from  = String(yearFrom)
    if (yearTo < CURRENT_YEAR)     p.year_to    = String(yearTo)
    if (sort !== 'popularity')     p.sort       = sort
    if (page > 1)                  p.page       = String(page)
    setSearchParams(p, { replace: true })

    fetchMovies({
      genres: selectedGenres,
      minRating,
      yearFrom,
      yearTo,
      sort,
      page,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [selectedGenres, minRating, yearFrom, yearTo, sort, page, fetchMovies])

  // Reset page when filters change (not page itself)
  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return }
    setPage(1)
  }, [selectedGenres, minRating, yearFrom, yearTo, sort])

  // ── Genre toggle ──────────────────────────────────────────
  const toggleGenre = (g) =>
    setSelectedGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]
    )

  const clearAll = () => {
    setSelectedGenres([])
    setMinRating(0)
    setYearFrom(1900)
    setYearTo(CURRENT_YEAR)
    setSort('popularity')
    setPage(1)
  }

  const hasFilters =
    selectedGenres.length > 0 || minRating > 0 ||
    yearFrom > 1900 || yearTo < CURRENT_YEAR || sort !== 'popularity'

  return (
    <main className="explore-page page-content">
      <div className="explore-page__inner">

        {/* ── Sidebar ── */}
        <aside className="explore-sidebar">
          <div className="explore-sidebar__header">
            <h2 className="explore-sidebar__title">Explore</h2>
            {hasFilters && (
              <button className="explore-sidebar__clear" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>

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
        </aside>

        {/* ── Main ── */}
        <div className="explore-main">
          {/* Header bar */}
          <div className="explore-main__header">
            <p className="explore-main__count">
              {!loading && !error && (
                <>{total.toLocaleString()} movie{total !== 1 ? 's' : ''}</>
              )}
            </p>
            {/* Active genre chips */}
            {selectedGenres.length > 0 && (
              <div className="explore-active-chips">
                {selectedGenres.map((g) => (
                  <button key={g} className="explore-active-chip" onClick={() => toggleGenre(g)}>
                    {g} ×
                  </button>
                ))}
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
            <div className="explore-grid">
              {movies.map((m) => <MovieCard key={m.id} movie={m} />)}
            </div>
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

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <nav className="explore-pagination">
              <button
                className="explore-pagination__btn"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >← Prev</button>

              <div className="explore-pagination__pages">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  const half = 3
                  let start = Math.max(1, page - half)
                  let end = Math.min(totalPages, start + 6)
                  start = Math.max(1, end - 6)
                  const p = start + i
                  if (p > end) return null
                  return (
                    <button
                      key={p}
                      className={`explore-pagination__page${p === page ? ' active' : ''}`}
                      onClick={() => setPage(p)}
                    >
                      {p}
                    </button>
                  )
                })}
              </div>

              <button
                className="explore-pagination__btn"
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
              >Next →</button>
            </nav>
          )}
        </div>

      </div>
    </main>
  )
}
