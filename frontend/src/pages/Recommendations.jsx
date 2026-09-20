import { useState, useEffect, useCallback, useRef } from 'react'
import axios from 'axios'
import api from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useSessionState } from '../hooks/useSessionState'
import useFeedbackBuffer from '../hooks/useFeedbackBuffer'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import ShinyText from '../components/ShinyText'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import './Explore.css' // Reuse Explore styles

// Matches the backend's 15-minute recommendation rotation window
// (RECS_WINDOW_SECONDS in routers/recommendations.py).
const REC_MAX_AGE_MS = 15 * 60 * 1000

export default function Recommendations() {
  const { isLoggedIn } = useAuth()

  // ── States ────────────────────────────────────────────────
  const [page, setPage] = useSessionState('recommendations_page', 1)
  const [movies, setMovies] = useSessionState('recommendations_movies', [])
  const [hasMore, setHasMore] = useSessionState('recommendations_hasMore', true)
  const [fetchedAt, setFetchedAt] = useSessionState('recommendations_ts', 0)

  const [loading, setLoading] = useState(movies.length === 0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)

  const isMounted = useRef(false)
  const isPageMounted = useRef(false)

  const LIMIT = 20
  const isFetchingRef = useRef(false)
  const abortControllerRef = useRef(null)
  const observerRef = useRef(null)

  // Hide-and-replace. No visibleCount slice here: the grid already loads the
  // next page on scroll, so a dismissed card just closes the gap and the
  // existing sentinel tops the grid up as before.
  const { visible: visibleMovies, isExiting, dismiss } = useFeedbackBuffer(movies)

  // ── Fetch ─────────────────────────────────────────────────
  const fetchRecommendations = useCallback(async (p, isInitial = false) => {
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
      const res = await api.get('/api/v1/recommendations', {
        params: { page: p },
        signal: controller.signal
      })
      const data = res.data
      const newMovies = data.movies ?? []

      if (isInitial) {
        setMovies(newMovies)
        setFetchedAt(Date.now())
      } else {
        setMovies((prev) => {
          const existingIds = new Set(prev.map(m => m.id))
          const uniqueNew = newMovies.filter(m => !existingIds.has(m.id))
          return [...prev, ...uniqueNew]
        })
      }

      setHasMore(data.page < data.total_pages && newMovies.length > 0)
    } catch (err) {
      if (!axios.isCancel(err) && err.name !== 'AbortError') {
        console.error('Failed to load recommendations:', err)
        setError('Failed to load recommendations.')
      }
    } finally {
      isFetchingRef.current = false
      if (abortControllerRef.current === controller) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  // Initial mount fetch
  useEffect(() => {
    if (!isLoggedIn) return

    console.log('[Recommendations Mount/Update] isMounted:', isMounted.current, 'moviesCount:', movies?.length)

    if (!isMounted.current) {
      isMounted.current = true
      // Only keep the session copy while it is younger than the backend's
      // rotation window. Once it is stale we restart from page 1 rather than
      // appending pages of the new pool onto items from the old one.
      const isFresh = movies.length > 0 && Date.now() - (fetchedAt || 0) < REC_MAX_AGE_MS
      if (isFresh) {
        console.log('[Recommendations Mount] Cache hit! Keeping cached movies and skipping fetch')
        setLoading(false)
        return
      }
    }

    isFetchingRef.current = false
    setMovies([])
    setPage(1)
    setHasMore(true)
    fetchRecommendations(1, true)
  }, [isLoggedIn])

  // Fetch subsequent pages when page increments
  useEffect(() => {
    if (!isLoggedIn) return

    if (!isPageMounted.current) {
      isPageMounted.current = true
      if (movies.length > 0) {
        return
      }
    }

    if (page > 1) {
      fetchRecommendations(page, false)
    }
  }, [page, isLoggedIn])

  // Infinite scroll trigger
  useEffect(() => {
    if (!isLoggedIn || loading || loadingMore || !hasMore) return

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
  }, [isLoggedIn, loading, loadingMore, hasMore])

  if (!isLoggedIn) {
    return (
      <main className="explore-page page-content">
        <div className="explore-aurora-bg" aria-hidden="true">
          <Aurora
            colorStops={['#3A29FF', '#FF94B4', '#FF3232']}
            blend={0.5}
            amplitude={1.0}
            speed={0.5}
          />
          <div className="explore-aurora-overlay" />
        </div>
        <div className="explore-page__inner" style={{ paddingTop: '100px', textAlign: 'center' }}>
          <h2>Please log in to see recommendations.</h2>
        </div>
      </main>
    )
  }

  return (
    <main className="explore-page page-content">
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

      <div className="explore-page__inner">
        <header className="explore-header-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span className="explore-category-tag" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
              <circle cx="12" cy="12" r="10"></circle>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
            </svg> For You
          </span>
          <h1 className="explore-hero-title">
            <ShinyText text="Recommendations" />
          </h1>
        </header>

        {error && (
          <div className="error-state">{error}</div>
        )}

        {!error && (visibleMovies.length > 0 || loading) && (
          <>
            <StaggerContainer className="explore-grid" instant={false}>
              {visibleMovies.map((m, index) => (
                <StaggerItem key={`${m.id}-${index}`} index={index}>
                  <MovieCard
                    movie={m}
                    showFeedback={true}
                    feedbackSource="recommendations_page"
                    onDismiss={() => dismiss(m)}
                    isExiting={isExiting(m)}
                  />
                </StaggerItem>
              ))}
              {loading && <MovieCardSkeleton count={20} />}
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
            <div style={{ fontSize: 48, marginBottom: 16 }}>🍿</div>
            <h3>No recommendations found</h3>
            <p>Watch some movies to get personalized recommendations.</p>
          </div>
        )}
      </div>
      <div className="fixed-bottom-fade" />
    </main>
  )
}
