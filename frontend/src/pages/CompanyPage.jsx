/**
 * CompanyPage.jsx
 *
 * Route: /company/:id
 * Shows movies & TV produced by a specific production company.
 * Hits GET /api/v1/movies/company/{company_id}
 */
import { useParams, useLocation, Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import api from '../utils/api'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import './CompanyPage.css'

export default function CompanyPage() {
  const { id } = useParams()
  const location = useLocation()
  const companyName = location.state?.companyName || `Company #${id}`

  const [companyInfo, setCompanyInfo] = useState({ name: companyName, logoPath: null })
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  const observerRef = useRef(null)

  // Reset page & data when company id changes
  useEffect(() => {
    setMovies([])
    setPage(1)
    setTotal(0)
    setHasMore(true)
    setLoading(true)
    setError(null)
    setCompanyInfo({ name: location.state?.companyName || `Company #${id}`, logoPath: null })
  }, [id, location.state?.companyName])

  // Fetch page data
  useEffect(() => {
    let cancelled = false
    const isFirstPage = page === 1

    if (isFirstPage) {
      setLoading(true)
    } else {
      setLoadingMore(true)
    }

    api.get(`/api/v1/movies/company/${id}`, { params: { page } })
      .then((r) => {
        if (cancelled) return
        const newMovies = r.data?.movies || []
        const totalCount = r.data?.total || 0
        setTotal(totalCount)

        if (r.data?.company_name) {
          setCompanyInfo({ name: r.data.company_name, logoPath: r.data.logo_path })
        }

        if (isFirstPage) {
          setMovies(newMovies)
        } else {
          setMovies((prev) => {
            const existingIds = new Set(prev.map(m => `${m.id}-${m.media_type}`))
            const uniqueNew = newMovies.filter(m => !existingIds.has(`${m.id}-${m.media_type}`))
            return [...prev, ...uniqueNew]
          })
        }

        if (newMovies.length < 30) {
          setHasMore(false)
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load titles')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
          setLoadingMore(false)
        }
      })

    return () => { cancelled = true }
  }, [id, page])

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

  return (
    <main className="company-page page-content">
      {/* ── Background Aurora Animation ── */}
      <div className="company-page-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#00c6ff", "#0072ff", "#7c3aed"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="company-page-aurora-overlay" />
      </div>

      <div className="container">
        {/* ── Header ── */}
        <div className="company-page__header">
          <Link to="/" className="company-page__back">← Back</Link>
          <div className="company-page__title-row">
            <span className="company-page__badge">Production House</span>
            <h1 className="company-page__title">
              {companyInfo.logoPath && (
                <img
                  src={`https://image.tmdb.org/t/p/w92${companyInfo.logoPath}`}
                  alt={companyInfo.name}
                  className="company-page__logo"
                />
              )}
              <span>{companyInfo.name}</span>
            </h1>
            {total > 0 && (
              <p className="company-page__count">
                {total.toLocaleString()} title{total !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>

        {/* ── Content ── */}
        {loading ? (
          <div className="movie-grid">
            <MovieCardSkeleton count={18} />
          </div>
        ) : error ? (
          <div className="error-state">{error}</div>
        ) : movies.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎬</div>
            <h3>No titles found</h3>
            <p>No movies or TV shows found for this production company.</p>
          </div>
        ) : (
          <>
            <div className="movie-grid">
              {movies.map((m) => (
                <MovieCard key={`${m.id}-${m.media_type}`} movie={m} />
              ))}
            </div>

            {loadingMore && (
              <div className="movie-grid" style={{ marginTop: '24px' }}>
                <MovieCardSkeleton count={8} />
              </div>
            )}

            <div ref={observerRef} style={{ height: 20, margin: '20px 0' }} />

            {!hasMore && (
              <p className="company-page__end-msg" style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', margin: '40px 0 20px', fontSize: '13px' }}>
                No more titles to load.
              </p>
            )}
          </>
        )}
      </div>
    </main>
  )
}
