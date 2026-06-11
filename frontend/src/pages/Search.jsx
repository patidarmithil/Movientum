/**
 * Search.jsx — Search results page with Infinite Scroll
 *
 * Reads ?q= and ?genre= from URL → GET /api/v1/search?q=...&page=N
 * Shows: MovieCard grid | loading skeletons | empty state | error state
 * Infinite Scrolling uses IntersectionObserver.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { searchService } from '../services/searchService'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import RequestContentModal from '../components/RequestContentModal'
import './Search.css'

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const query = searchParams.get('q') ?? ''
  const genre = searchParams.get('genre') ?? ''

  const [results, setResults] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [error, setError] = useState(null)
  const [showRequestModal, setShowRequestModal] = useState(false)

  const observerRef = useRef(null)

  // Reset state when query or genre changes
  useEffect(() => {
    setResults([])
    setPage(1)
    setTotal(0)
    setHasMore(true)
    setIsLoading(true)
    setError(null)
  }, [query, genre])

  const doFetch = useCallback(async (q, g, p) => {
    if (!q.trim() && !g.trim()) {
      setIsLoading(false)
      setLoadingMore(false)
      return
    }

    const isFirstPage = p === 1
    if (isFirstPage) {
      setIsLoading(true)
    } else {
      setLoadingMore(true)
    }
    setError(null)

    try {
      let data
      if (g.trim() && !q.trim()) {
        data = await searchService.searchByGenre(g, p)
      } else {
        data = await searchService.search(q, p)
      }

      const newResults = data?.results ?? []
      const totalCount = data?.total ?? 0
      setTotal(totalCount)

      if (isFirstPage) {
        setResults(newResults)
      } else {
        setResults((prev) => {
          const existingIds = new Set(prev.map(m => `${m.id}-${m.media_type}`))
          const uniqueNew = newResults.filter(m => !existingIds.has(`${m.id}-${m.media_type}`))
          return [...prev, ...uniqueNew]
        })
      }

      // If we received less results than the default limit (20), we reached the end
      if (newResults.length < 20) {
        setHasMore(false)
      } else {
        setHasMore(true)
      }
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Search failed. Try again.')
      if (isFirstPage) setResults([])
    } finally {
      setIsLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => {
    if (query.trim() || genre.trim()) {
      doFetch(query, genre, page)
    } else {
      setResults([])
      setTotal(0)
      setHasMore(false)
      setIsLoading(false)
    }
  }, [query, genre, page, doFetch])

  // Infinite scroll trigger
  useEffect(() => {
    if (isLoading || loadingMore || !hasMore) return

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
  }, [isLoading, loadingMore, hasMore])

  // Empty (no q and no genre)
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
        {total > 0 && (
          <p className="search-page__count">
            {total.toLocaleString()} movie{total !== 1 ? 's' : ''} found
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
              onClick={() => doFetch(query, genre, 1)}
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
                <MovieCard key={`${movie.id}-${movie.media_type}`} movie={movie} />
              ))}
            </div>

            {loadingMore && (
              <div className="movie-grid" style={{ marginTop: '24px' }}>
                <MovieCardSkeleton count={8} />
              </div>
            )}

            <div ref={observerRef} style={{ height: 20, margin: '20px 0' }} />

            {!hasMore && (
              <div style={{ textAlign: 'center', margin: '40px 0 40px', paddingBottom: '20px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '20px' }}>
                <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px', marginBottom: '8px' }}>
                  Could not find what you're looking for?{' '}
                  <button 
                    onClick={() => setShowRequestModal(true)}
                    style={{ background: 'none', border: 'none', color: 'white', fontWeight: 'bold', cursor: 'pointer', padding: 0, fontSize: '14px' }}
                  >
                    Request Content
                  </button>
                </p>
              </div>
            )}
          </>
        )}

        {/* Empty results */}
        {!isLoading && !error && results.length === 0 && (query.trim() || genre.trim()) && (
          <div className="empty-state">
            <div className="search-empty-icon">🔍</div>
            <h3>No results found</h3>
            <p>Try a different title or check your filters.</p>
              <button
              className="search-home-btn"
              id="search-go-home"
              onClick={() => navigate('/')}
            >
              Browse all movies
            </button>
            <div style={{ marginTop: '24px' }}>
              <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '14px' }}>
                Could not find what you're looking for?{' '}
                <button 
                  onClick={() => setShowRequestModal(true)}
                  style={{ background: 'none', border: 'none', color: 'white', fontWeight: 'bold', cursor: 'pointer', padding: 0, fontSize: '14px' }}
                >
                  Request Content
                </button>
              </p>
            </div>
          </div>
        )}
      </div>

      {showRequestModal && (
        <RequestContentModal 
          query={query || genre} 
          onClose={() => setShowRequestModal(false)} 
        />
      )}
    </main>
  )
}
