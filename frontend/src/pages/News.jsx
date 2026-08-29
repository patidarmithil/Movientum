/**
 * News Page — /news
 *
 * v2: taxonomy fetched from GET /news/categories (server-driven, fixes the old
 * three-disagreeing-copies problem) instead of a hardcoded array. The four
 * viewing-mode pills (All / For You / Trending / Editorial) map to `tab`; every
 * other pill is a real taxonomy category and maps to `category` (which the
 * backend honours regardless of `tab`).
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { newsService } from '../services/newsService'
import { useAuth } from '../context/AuthContext'
import NewsCard from '../components/NewsCard'
import ShinyText from '../components/ShinyText'
import Aurora from '../components/Aurora'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import './News.css'

const PAGE_SIZE = 12
const WARMING_RETRY_CAP = 1

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

const CategoryIcon = ({ id, color, size = 15 }) => {
  const props = {
    width: size, height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: '2.5',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: 'nav-icon-svg',
    'aria-hidden': true,
  }
  switch (id) {
    case 'all':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    case 'for-you':
      return <svg {...props}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
    case 'trending':
      return <svg {...props}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
    case 'editorial':
      return <svg {...props}><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
    case 'bollywood':
      return <svg {...props}><path d="M7 2h13a2 2 0 0 1 2 2v13"/><path d="M3 6H2v16a2 2 0 0 0 2 2h16v-1"/><path d="M5 2h2l1 4H5z"/><path d="M11 2h2l1 4h-2z"/><path d="M17 2h2l1 4h-2z"/><rect x="2" y="6" width="20" height="16" rx="2"/></svg>
    case 'hollywood':
      return <svg {...props}><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/></svg>
    case 'anime':
      return <svg {...props}><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/></svg>
    case 'k-drama':
      return <svg {...props}><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
    case 'sci-fi':
      return <svg {...props}><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>
    case 'horror':
      return <svg {...props}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
    case 'action':
      return <svg {...props}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
    case 'comedy':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
    case 'drama':
      return <svg {...props}><path d="M2 10s3-3 3-8c2.667 1.333 5.333 2 8 2s5.333-.667 8-2c0 5-3 8-3 8"/><path d="M6 13c.667 2 2.333 3 5 3"/><path d="M18 13c-.667 2-2.333 3-5 3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="9" r="1"/></svg>
    case 'awards':
      return <svg {...props}><polyline points="8 17 12 17 12 21"/><line x1="8" y1="21" x2="16" y2="21"/><path d="M17 3H7l1.5 8.5c.5 2.5 2 3.5 3.5 3.5s3-.5 3.5-3.5z"/><path d="M17 3c0 0 2 0 2 2v1c0 2-2 3-2 3"/><path d="M7 3c0 0-2 0-2 2v1c0 2 2 3 2 3"/></svg>
    case 'trailers':
      return <svg {...props}><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
    case 'web-series':
      return <svg {...props}><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
    default:
      // Unknown/new icon name from the server — fall back to the 'all' glyph
      // rather than rendering a blank chip.
      return <svg {...props}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
  }
}

// Fixed viewing-mode pills — these map to `tab`, not `category`, and are not
// part of the server-driven taxonomy (they aren't content categories).
const TAB_PILLS = [
  { id: 'all',       label: 'All',       color: '#A0AEC0' },
  { id: 'for-you',   label: 'For You',   color: '#B048FF' },
  { id: 'trending',  label: 'Trending',  color: '#FF9F1C' },
  { id: 'editorial', label: 'Editorial', color: '#4CC9F0' },
]
const TAB_IDS = new Set(TAB_PILLS.map((t) => t.id))

export default function News() {
  const { isLoggedIn } = useAuth()

  const [categories, setCategories] = useState([])
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)
  const [loadMore, setLoadMore] = useState(false)
  const [newsStatus, setNewsStatus] = useState(null)
  const [personalized, setPersonalized] = useState(true)
  const [warming, setWarming] = useState(null)   // { label, retryAfter } | null

  const fetchRef = useRef(null)
  const retryCountRef = useRef(0)

  const [activePill, setActivePill] = useState('for-you')

  useEffect(() => {
    document.title = 'News - Movientum'
    newsService.getStatus().then(setNewsStatus).catch(() => {})
    newsService.getCategories().then(setCategories).catch(() => setCategories([]))
  }, [])

  const pills = [...TAB_PILLS, ...categories]

  const fetchNews = useCallback(async (pg, pillId, append = false) => {
    const id = Symbol()
    fetchRef.current = id

    if (!append) setLoading(true)
    else setLoadMore(true)

    try {
      // Map 'all' tab to 'latest' for backend compatibility
      const tabValue = pillId === 'all' ? 'latest' : pillId
      const params = TAB_IDS.has(pillId)
        ? { tab: tabValue, page: pg, pageSize: PAGE_SIZE }
        : { tab: 'latest', category: pillId, page: pg, pageSize: PAGE_SIZE }

      const data = await newsService.getFeed(params)
      if (fetchRef.current !== id) return

      if (data.warming) {
        setWarming({ label: pillId, retryAfter: data.retry_after || 20 })
        setArticles([])
        setTotal(0)
        return
      }
      setWarming(null)

      const incoming = data.articles || []
      setArticles((prev) => {
        if (!append) return incoming
        const existingIds = new Set(prev.map((a) => a.id))
        const uniqueIncoming = incoming.filter((a) => !existingIds.has(a.id))
        return [...prev, ...uniqueIncoming]
      })
      setTotal(data.total || 0)
      setPersonalized(data.personalized !== false)
    } catch {
      if (fetchRef.current !== id) return
      if (!append) setArticles([])
    } finally {
      if (fetchRef.current === id) {
        setLoading(false)
        setLoadMore(false)
      }
    }
  }, [])

  async function handlePillChange(pillId) {
    if (activePill === pillId) return
    setActivePill(pillId)
    setPage(1)
    setArticles([])
    retryCountRef.current = 0
    fetchNews(1, pillId, false)
  }

  useEffect(() => {
    setPage(1)
    setArticles([])
    retryCountRef.current = 0
    fetchNews(1, activePill, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, activePill])

  // Auto-retry once while a category is warming up.
  useEffect(() => {
    if (!warming) return
    if (retryCountRef.current >= WARMING_RETRY_CAP) return
    retryCountRef.current += 1
    const timer = setTimeout(() => fetchNews(1, activePill, false), warming.retryAfter * 1000)
    return () => clearTimeout(timer)
  }, [warming, activePill, fetchNews])

  const observerRef = useRef(null)      // sentinel div ref
  const isFetchingRef = useRef(false)   // prevent double-fetch

  const hasMore = articles.length < total

  // IntersectionObserver setup
  useEffect(() => {
    if (!observerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0]
        if (first.isIntersecting && hasMore && !isFetchingRef.current) {
          isFetchingRef.current = true
          const next = page + 1
          setPage(next)
          fetchNews(next, activePill, true).finally(() => {
            isFetchingRef.current = false
          })
        }
      },
      { threshold: 0.1 }
    )

    observer.observe(observerRef.current)
    return () => observer.disconnect()
  }, [hasMore, page, fetchNews, activePill])

  const activeLabel = pills.find((p) => p.id === activePill)?.label || activePill
  const isEmpty = !loading && !warming && articles.length === 0

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
            <h1 className="news-header__title" style={{ display: 'flex', alignItems: 'center' }}>
              <span className="news-header__icon" style={{ display: 'flex', alignItems: 'center', marginRight: '10px' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" />
                  <path d="M2 12h10" />
                  <path d="M2 17h10" />
                  <path d="M2 7h4" />
                </svg>
              </span>
              <ShinyText text="Personalized News" />
              <span className="news-badge" style={{ marginLeft: '12px', fontSize: '0.75rem', padding: '2px 8px', background: 'var(--surface-card)', borderRadius: '12px', color: 'var(--accent-primary)', border: '1px solid var(--border)' }}>
                Refreshes every 30m
              </span>
            </h1>
            <p className="news-header__sub">
              Articles tailored to your watch history and favourite genres
              {newsStatus?.last_fetched && (
                <span style={{ marginLeft: '8px', opacity: 0.6, fontSize: '0.85em' }}>
                  • Last updated: {new Date(newsStatus.last_fetched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* ── Filter Bar ── */}
        <div className="news-filter-bar" role="tablist">
          {pills.map((pill) => {
            const isActive = activePill === pill.id
            return (
              <button
                key={pill.id}
                role="tab"
                aria-selected={isActive}
                className={`news-filter-pill ${isActive ? 'news-filter-pill--active' : ''}`}
                onClick={() => handlePillChange(pill.id)}
                style={isActive ? { '--pill-glow': pill.color + '55', borderColor: pill.color + '88' } : {}}
              >
                <span
                  className="news-filter-pill__icon"
                  style={{ opacity: isActive ? 1 : 0.55 }}
                >
                  <CategoryIcon id={pill.icon || pill.id} color={isActive ? pill.color : 'currentColor'} size={15} />
                </span>
                <span>{pill.label}</span>
              </button>
            )
          })}
        </div>

        {/* ── Guest Banner (Soft Lock) ── */}
        {!isLoggedIn && activePill === 'for-you' && (
          <div className="news-guest-banner" style={{ textAlign: 'center', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span style={{ marginRight: '1rem', color: 'var(--text-secondary)' }}>Showing latest news. Log in to get personalized recommendations!</span>
            <Link to="/login" className="btn btn--primary btn--sm" style={{ padding: '0.4rem 1rem' }}>Log In</Link>
          </div>
        )}
        {isLoggedIn && activePill === 'for-you' && !personalized && (
          <div className="news-guest-banner" style={{ textAlign: 'center', padding: '1rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '8px', marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Watch and rate a few titles to unlock a personalized feed.</span>
          </div>
        )}

        {/* ── Content ── */}
        {warming ? (
          <div className="news-empty">
            <span className="news-empty__icon news-scroll-spinner" style={{ display: 'inline-block', margin: '0 auto 1rem' }} />
            <h3>Fetching fresh {activeLabel} news…</h3>
            <p>This category hasn't been crawled recently — give it a moment.</p>
          </div>
        ) : loading ? (
          <NewsSkeleton />
        ) : isEmpty ? (
          <div className="news-empty">
            <span className="news-empty__icon">📭</span>
            <h3>No articles found</h3>
            <p>
              {activePill === 'for-you'
                ? 'Watch more titles to start getting personalized news, or explore other categories!'
                : `No news articles found under ${activeLabel}.`}
            </p>
          </div>
        ) : (
          // `instant={false}` matches Explore, Recommendations and the detail
          // pages' rows: the cards reveal when the grid scrolls into view rather
          // than all animating at mount.
          <StaggerContainer className="news-grid" instant={false}>
            {articles.map((article, index) => (
              <StaggerItem key={article.id} index={index}>
                <NewsCard article={article} variant="standard" />
              </StaggerItem>
            ))}
          </StaggerContainer>
        )}

        {/* Sentinel — triggers next page load when visible */}
        {!loading && !warming && hasMore && (
          <div
            ref={observerRef}
            className="news-scroll-sentinel"
            aria-hidden="true"
          />
        )}

        {/* Loading spinner for infinite scroll (not first load) */}
        {loadMore && (
          <div className="news-scroll-loader">
            <div className="news-scroll-spinner" />
          </div>
        )}
      </div>
    </main>
  )
}
