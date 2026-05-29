/**
 * Search.jsx — Search results page (Phase 3.5B)
 *
 * Reads ?q= from URL → GET /api/v1/search?q=...&page=N
 * Shows: MovieCard grid | loading skeletons | empty state | error state
 * Pagination: prev/next
 */
import { useEffect, useState, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { searchService } from '../services/searchService'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import './Search.css'

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const query = searchParams.get('q') ?? ''
  const genre = searchParams.get('genre') ?? ''
  const page  = parseInt(searchParams.get('page') ?? '1', 10)

  const [results, setResults]       = useState([])
  const [total, setTotal]           = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [isLoading, setIsLoading]   = useState(false)
  const [error, setError]           = useState(null)

  const doFetch = useCallback(async (q, g, p) => {
    if (!q.trim() && !g.trim()) return
    setIsLoading(true)
    setError(null)
    try {
      let data
      if (g.trim() && !q.trim()) {
        data = await searchService.searchByGenre(g, p)
      } else {
        data = await searchService.search(q, p)
      }
      setResults(data.results ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.pages ?? 1)
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Search failed. Try again.')
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (query.trim() || genre.trim()) {
      doFetch(query, genre, page)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } else {
      setResults([])
      setTotal(0)
      setTotalPages(1)
    }
  }, [query, genre, page, doFetch])

  const goPage = (p) => {
    const params = {}
    if (query) params.q = query
    if (genre) params.genre = genre
    params.page = String(p)
    setSearchParams(params)
  }

  // ── Empty (no q and no genre) ────────────────────────────
  if (!query.trim() && !genre.trim()) {
    return (
      <main className="search-page page-content">
        <div className="search-page__header container">
          <h1 className="search-page__title">Search Movies</h1>
          <p className="search-page__subtitle">Use the search bar above to find movies.</p>
        </div>
        <div className="empty-state container">
          <div className="search-empty-icon">🎬</div>
          <h3>What are you looking for?</h3>
          <p>Type a movie title in the search bar to get started.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="search-page page-content">
      <div className="search-page__header container">
        <h1 className="search-page__title">
          {genre && !query
            ? <>Movies — <span className="search-page__query">{genre}</span></>
            : <>Results for <span className="search-page__query">"{query}"</span></>}
        </h1>
        {!isLoading && !error && (
          <p className="search-page__count">
            {total > 0
              ? `${total.toLocaleString()} movie${total !== 1 ? 's' : ''} found`
              : ''}
          </p>
        )}
      </div>

      <div className="container">
        {/* Error */}
        {error && (
          <div className="error-state">
            <div className="search-error-icon">⚠️</div>
            <p>{error}</p>
            <button
              className="search-retry-btn"
              onClick={() => fetch(query, page)}
            >
              Try again
            </button>
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && !error && (
          <div className="movie-grid">
            <MovieCardSkeleton count={12} />
          </div>
        )}

        {/* Results grid */}
        {!isLoading && !error && results.length > 0 && (
          <>
            <div className="movie-grid">
              {results.map((movie) => (
                <MovieCard key={movie.id} movie={movie} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <nav className="search-pagination" aria-label="Search pagination">
                <button
                  className="search-pagination__btn"
                  id="search-prev-btn"
                  disabled={page <= 1}
                  onClick={() => goPage(page - 1)}
                  aria-label="Previous page"
                >
                  ← Prev
                </button>

                <div className="search-pagination__pages">
                  {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                    // Show pages around current
                    const half = 3
                    let start = Math.max(1, page - half)
                    let end   = Math.min(totalPages, start + 6)
                    start = Math.max(1, end - 6)
                    const p = start + i
                    if (p > end) return null
                    return (
                      <button
                        key={p}
                        className={`search-pagination__page${p === page ? ' search-pagination__page--active' : ''}`}
                        id={`search-page-${p}`}
                        onClick={() => goPage(p)}
                        aria-label={`Page ${p}`}
                        aria-current={p === page ? 'page' : undefined}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>

                <button
                  className="search-pagination__btn"
                  id="search-next-btn"
                  disabled={page >= totalPages}
                  onClick={() => goPage(page + 1)}
                  aria-label="Next page"
                >
                  Next →
                </button>
              </nav>
            )}
          </>
        )}

        {/* Empty results */}
        {!isLoading && !error && results.length === 0 && query.trim() && (
          <div className="empty-state">
            <div className="search-empty-icon">🔍</div>
            <h3>No results for "{query}"</h3>
            <p>Try a different title or check your spelling.</p>
            <button
              className="search-home-btn"
              id="search-go-home"
              onClick={() => navigate('/')}
            >
              Browse all movies
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
