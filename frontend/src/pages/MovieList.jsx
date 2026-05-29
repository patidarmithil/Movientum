/**
 * MovieList Page — Phase 3.5C
 *
 * Replaces dummy data with live API:
 *   GET /api/v1/movies?page=N&genre=&sort=
 *
 * Features:
 *  - Genre filter buttons (loaded from API genres)
 *  - Sort dropdown: popularity / vote_average / release_year
 *  - Pagination (Load More)
 */
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { movieService } from '../services/movieService'
import api from '../utils/api'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import './MovieList.css'

const SORT_OPTIONS = [
  { value: 'popularity',    label: 'Most Popular' },
  { value: 'vote_average',  label: 'Top Rated' },
  { value: 'release_year',  label: 'Newest First' },
]

const LIMIT = 20

export default function MovieList() {
  const [searchParams, setSearchParams] = useSearchParams()

  const [movies,      setMovies]      = useState([])
  const [genres,      setGenres]      = useState(['All'])
  const [total,       setTotal]       = useState(0)
  const [page,        setPage]        = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error,       setError]       = useState(null)

  const activeGenre = searchParams.get('genre') || 'All'
  const activeSort  = searchParams.get('sort')  || 'popularity'

  const setGenre = (g) => {
    const p = new URLSearchParams(searchParams)
    if (g === 'All') p.delete('genre'); else p.set('genre', g)
    p.delete('sort') // keep sort, reset page
    setSearchParams(p)
    setPage(1)
    setMovies([])
  }

  const setSort = (s) => {
    const p = new URLSearchParams(searchParams)
    p.set('sort', s)
    setSearchParams(p)
    setPage(1)
    setMovies([])
  }

  // Fetch genres list from API
  useEffect(() => {
    api.get('/api/v1/movies/genres')
      .then((r) => setGenres(['All', ...(r.data?.genres || r.data || [])]))
      .catch(() => {})
  }, [])

  // Fetch movies
  const fetchMovies = useCallback(async (pg) => {
    const isFirst = pg === 1
    if (isFirst) setLoading(true); else setLoadingMore(true)
    setError(null)

    try {
      const params = { page: pg, limit: LIMIT, sort: activeSort }
      if (activeGenre !== 'All') params.genre = activeGenre

      const r = await api.get('/api/v1/movies', { params })
      const data = r.data
      const incoming = data?.movies || data || []
      setTotal(data?.total || 0)

      setMovies((prev) => isFirst ? incoming : [...prev, ...incoming])
    } catch {
      setError('Failed to load movies')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [activeGenre, activeSort])

  // Re-fetch when filters change
  useEffect(() => {
    setPage(1)
    setMovies([])
    fetchMovies(1)
  }, [activeGenre, activeSort]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLoadMore = () => {
    const next = page + 1
    setPage(next)
    fetchMovies(next)
  }

  const hasMore = movies.length < total

  return (
    <main className="movie-list-page page-content">
      {/* ── Hero banner ── */}
      <header className="movie-list__hero">
        <div className="hero__aurora-wrap">
          <Aurora
            colorStops={['#7cff67', '#B497CF', '#5227FF']}
            blend={0.6}
            amplitude={1.2}
            speed={0.6}
          />
        </div>
        <div className="hero__overlay" />
        <div className="container movie-list__hero-content">
          <h1 className="movie-list__hero-title">Browse Movies</h1>
          <p className="movie-list__hero-subtitle">
            {loading ? 'Loading…' : `${total} movies found`}
          </p>
        </div>
      </header>

      <div className="container">
        {/* ── Controls ── */}
        <div className="movie-list__controls">
          {/* Genre filter */}
          <div className="genre-filters" role="group" aria-label="Filter by genre">
            {genres.map((g) => (
              <button
                key={g}
                id={`genre-filter-${g.toLowerCase().replace(/\s+/g, '-')}`}
                className={`genre-filter-btn${activeGenre === g ? ' genre-filter-btn--active' : ''}`}
                onClick={() => setGenre(g)}
                aria-pressed={activeGenre === g}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Sort dropdown */}
          <div className="movie-list__sort">
            <label htmlFor="sort-select" className="movie-list__sort-label">Sort:</label>
            <select
              id="sort-select"
              className="movie-list__sort-select"
              value={activeSort}
              onChange={(e) => setSort(e.target.value)}
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Grid ── */}
        {error ? (
          <div className="error-state">
            <h3>Something went wrong</h3>
            <p>{error}</p>
            <button
              className="btn btn--ghost btn--md"
              style={{ marginTop: 16 }}
              onClick={() => fetchMovies(1)}
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="movie-grid">
            <MovieCardSkeleton count={20} />
          </div>
        ) : movies.length === 0 ? (
          <div className="empty-state">
            <h3>No movies found</h3>
            <p>Try a different genre or sort option</p>
            <button
              className="btn btn--ghost btn--md"
              style={{ marginTop: 16 }}
              onClick={() => { setGenre('All'); setSort('popularity') }}
            >
              Clear Filters
            </button>
          </div>
        ) : (
          <>
            <div className="movie-grid" id="movie-grid">
              {movies.map((m) => (
                <MovieCard key={m.id} movie={m} />
              ))}
              {loadingMore && <MovieCardSkeleton count={4} />}
            </div>

            {hasMore && !loadingMore && (
              <div className="movie-list__load-more">
                <button
                  id="load-more-btn"
                  className="btn btn--ghost btn--md"
                  onClick={handleLoadMore}
                >
                  Load More
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
