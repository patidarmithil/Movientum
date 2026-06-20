import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../utils/api'
import { useAuth } from '../context/AuthContext'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import './Explore.css' // Reuse Explore styles

export default function Recommendations() {
  const { isLoggedIn } = useAuth()
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  
  // For IntersectionObserver
  const loadMoreRef = useRef(null)

  // Fetch initial
  useEffect(() => {
    if (!isLoggedIn) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    setPage(1)

    api.get('/api/v1/recommendations', { params: { page: 1 } })
      .then((res) => {
        const data = res.data
        setMovies(data.movies || [])
        setHasMore(data.page < data.total_pages && data.movies.length > 0)
      })
      .catch((err) => {
        console.error('Failed to fetch recommendations:', err)
        setError('Failed to load recommendations.')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [isLoggedIn])

  // Fetch more
  const fetchMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || loading) return
    setIsLoadingMore(true)
    
    try {
      const nextPage = page + 1
      const res = await api.get('/api/v1/recommendations', { params: { page: nextPage } })
      const data = res.data
      
      setMovies((prev) => {
        const existingIds = new Set(prev.map(m => m.id))
        const newMovies = data.movies.filter(m => !existingIds.has(m.id))
        return [...prev, ...newMovies]
      })
      
      setPage(nextPage)
      setHasMore(data.page < data.total_pages && data.movies.length > 0)
    } catch (err) {
      console.error('Failed to load more recommendations:', err)
      setHasMore(false)
    } finally {
      setIsLoadingMore(false)
    }
  }, [isLoadingMore, hasMore, loading, page])

  // IntersectionObserver for Infinite Scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchMore()
        }
      },
      { rootMargin: '300px' }
    )

    const currentRef = loadMoreRef.current
    if (currentRef) observer.observe(currentRef)

    return () => {
      if (currentRef) observer.unobserve(currentRef)
    }
  }, [fetchMore])

  if (!isLoggedIn) {
    return (
      <main className="explore page-content">
        <div className="explore-header" style={{ paddingTop: '100px', textAlign: 'center' }}>
          <h2>Please log in to see recommendations.</h2>
        </div>
      </main>
    )
  }

  return (
    <main className="explore page-content">
      {/* ── Background Aurora Animation ── */}
      <div className="explore-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={['#3A29FF', '#FF94B4', '#FF3232']}
          blend={0.5}
          amplitude={1.0}
          speed={0.5}
        />
        <div className="explore-aurora-overlay" />
      </div>

      <div className="explore-container container" style={{ marginTop: '40px' }}>
        <header className="explore-header">
          <div className="explore-header-text">
            <h2>For You 🎯</h2>
            <p>Personalized recommendations powered by our ML models</p>
          </div>
        </header>

        <section className="explore-grid-section">
          {error && (
            <div className="explore-empty">
              <p>{error}</p>
            </div>
          )}

          {!error && loading && (
            <div className="explore-grid">
              {Array.from({ length: 20 }).map((_, i) => (
                <MovieCardSkeleton key={i} />
              ))}
            </div>
          )}

          {!error && !loading && movies.length === 0 && (
            <div className="explore-empty">
              <div className="explore-empty-icon">🍿</div>
              <h3>No recommendations found</h3>
              <p>Watch some movies to get personalized recommendations.</p>
            </div>
          )}

          {!error && !loading && movies.length > 0 && (
            <>
              <div className="explore-grid">
                {movies.map((m, i) => (
                  <MovieCard key={`${m.id}-${i}`} movie={m} index={i} />
                ))}
                
                {isLoadingMore && (
                  <>
                    {Array.from({ length: 4 }).map((_, i) => (
                      <MovieCardSkeleton key={`skeleton-${i}`} />
                    ))}
                  </>
                )}
              </div>
              
              {/* Infinite Scroll Trigger */}
              <div ref={loadMoreRef} className="explore-load-trigger" style={{ height: '40px' }} />
            </>
          )}
        </section>
      </div>
    </main>
  )
}
