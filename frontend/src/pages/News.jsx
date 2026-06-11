/**
 * News Page — /news
 *
 * Shows personalized news based on user's watch history.
 * Infinite scroll via "Load More" button.
 * Matches Movientum design system.
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { newsService } from '../services/newsService'
import { useAuth } from '../context/AuthContext'
import NewsCard from '../components/NewsCard'
import Aurora from '../components/Aurora'
import './News.css'

const PAGE_SIZE = 12

function NewsSkeleton() {
  return (
    <div className="news-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="news-card-skeleton">
          <div className="skeleton news-card-skeleton__thumb" />
          <div className="news-card-skeleton__body">
            <div className="skeleton news-card-skeleton__tag" />
            <div className="skeleton news-card-skeleton__title" />
            <div className="skeleton news-card-skeleton__title-sm" />
            <div className="skeleton news-card-skeleton__meta" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function News() {
  const { isLoggedIn } = useAuth()

  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)
  const [loadMore, setLoadMore] = useState(false)

  const fetchRef = useRef(null)

  const fetchNews = useCallback(async (pg, append = false) => {
    if (!isLoggedIn) return
    
    const id = Symbol()
    fetchRef.current = id

    if (!append) setLoading(true)
    else setLoadMore(true)

    try {
      const data = await newsService.getForYou(pg, PAGE_SIZE)
      if (fetchRef.current !== id) return

      const incoming = data.articles || []
      setArticles((prev) => append ? [...prev, ...incoming] : incoming)
      setTotal(data.total || 0)
    } catch {
      if (fetchRef.current !== id) return
      if (!append) setArticles([])
    } finally {
      if (fetchRef.current === id) {
        setLoading(false)
        setLoadMore(false)
      }
    }
  }, [isLoggedIn])

  useEffect(() => {
    setPage(1)
    setArticles([])
    if (isLoggedIn) {
      fetchNews(1, false)
    }
  }, [isLoggedIn, fetchNews])

  const handleLoadMore = () => {
    const next = page + 1
    setPage(next)
    fetchNews(next, true)
  }

  const hasMore = articles.length < total
  const isEmpty = !loading && articles.length === 0

  return (
    <main className="news-page page-content">
      {/* Aurora bg */}
      <div className="news-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#FF4E50", "#F9D423", "#E100FF"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="news-aurora-overlay" />
      </div>

      <div className="container news-container">
        {/* ── Header ── */}
        <div className="news-header">
          <div className="news-header__title-group">
            <h1 className="news-header__title">
              <span className="news-header__icon">🎯</span> Personalized News
            </h1>
            <p className="news-header__sub">
              Articles tailored to your watch history and favourite genres
            </p>
          </div>
        </div>

        {/* ── Locked State ── */}
        {!isLoggedIn ? (
          <div className="news-locked-state">
            <div className="news-locked-state__icon">🔒</div>
            <h2>Sign in to see your news</h2>
            <p>Get news articles based on the movies and TV shows you've watched.</p>
            <Link to="/login" className="btn btn--primary btn--md" id="news-login-cta">
              Sign In to Unlock
            </Link>
          </div>
        ) : (
          <>
            {/* ── Content ── */}
            {loading ? (
              <NewsSkeleton />
            ) : isEmpty ? (
              <div className="news-empty">
                <span className="news-empty__icon">📭</span>
                <h3>No articles found</h3>
                <p>Rate and watch more titles to start getting personalized news!</p>
              </div>
            ) : (
              <div className="news-grid">
                {articles.map((article) => (
                  <NewsCard key={article.id} article={article} variant="standard" />
                ))}
              </div>
            )}

            {/* Load more */}
            {!loading && hasMore && (
              <div className="news-load-more">
                <button
                  id="news-load-more-btn"
                  className="btn btn--ghost btn--md"
                  onClick={handleLoadMore}
                  disabled={loadMore}
                >
                  {loadMore ? 'Loading…' : 'Load More'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
