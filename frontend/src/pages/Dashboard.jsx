/**
 * Dashboard.jsx — rebuilt
 *
 * Tabs:
 *   Watch History → GET /api/v1/watch/history    → { items: [{ movie: {...} }] }
 *   Watchlist     → GET /api/v1/watch/watchlist  → { items: [{ movie: {...} }] }
 *   My Ratings    → GET /api/v1/ratings/me       → { items: [{ movie: {...}, category }] }
 *
 * Backend returns nested movie object with:
 *   { id, title, poster_path, release_year, vote_average }
 * MovieCard expects same shape — direct pass, no rename.
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { watchService } from '../services/watchService'
import { ratingService } from '../services/ratingService'
import { watchlistService } from '../services/watchlistService'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import WatchlistCollectionCard from '../components/WatchlistCollectionCard'
import Aurora from '../components/Aurora'
import ShinyText from '../components/ShinyText'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import './Dashboard.css'

const TABS = [
  { key: 'watchlist', label: <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '6px' }}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg> My Watchlists</> },
  { key: 'history',   label: <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '6px' }}><polyline points="20 6 9 17 4 12"></polyline></svg> Watched</> },
  { key: 'ratings',   label: <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '6px' }}><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg> My Ratings</> },
]

const RATING_LABELS = {
  skip:       { label: 'Skip',       color: '#FF4D6D' },
  timepass:   { label: 'Timepass',   color: '#FFC300' },
  go_for_it:  { label: 'Go for it',  color: '#00E5A0' },
  perfection: { label: 'Perfection', color: '#9B59FF' },
}

/**
 * Extract movie object from API item.
 * Backend always returns nested movie: item.movie = { id, title, poster_path, release_year, vote_average }
 * Falls back to item itself for safety.
 */
function extractMovie(item) {
  if (!item) return {}
  return item.movie || { ...item, id: item.movie_id }
}

function EmptyTab({ message }) {
  return (
    <div className="dashboard__empty">
      <span className="dashboard__empty-icon">🎥</span>
      <p>{message}</p>
    </div>
  )
}

function RatingCard({ item }) {
  const movie = extractMovie(item)

  return (
    <div className="dashboard__rating-card">
      <MovieCard movie={movie} ratingCategory={item.category} />
    </div>
  )
}

function TabContent({ tab, data, loading, error }) {
  if (loading) {
    return (
      <div className="movie-grid">
        <MovieCardSkeleton count={8} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="error-state">
        <p>{error}</p>
      </div>
    )
  }

  if (!data || data.length === 0) {
    const EMPTY_MSGS = {
      history:   'No watch history yet. Start watching movies!',
      watchlist: 'You do not have any watchlists yet. Create one to get started!',
      ratings:   "You haven't rated any movies yet.",
    }
    return <EmptyTab message={EMPTY_MSGS[tab]} />
  }

  if (tab === 'ratings') {
    return (
      <StaggerContainer className="movie-grid" instant={true}>
        {data.map((item, index) => (
          <StaggerItem key={item.id} index={index}>
            <RatingCard item={item} />
          </StaggerItem>
        ))}
      </StaggerContainer>
    )
  }

  if (tab === 'watchlist') {
    return (
      <StaggerContainer className="watchlist-grid" instant={true}>
        {data.map((collection, index) => (
          <StaggerItem key={collection.id} index={index}>
            <WatchlistCollectionCard collection={collection} />
          </StaggerItem>
        ))}
      </StaggerContainer>
    )
  }

  // history
  return (
    <StaggerContainer className="movie-grid" instant={true}>
      {data.map((item, index) => {
        const movie = extractMovie(item)
        return (
          <StaggerItem key={movie.id ?? item.id} index={index}>
            <MovieCard movie={movie} />
          </StaggerItem>
        )
      })}
    </StaggerContainer>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('watchlist')

  const [history,   setHistory]   = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [ratings,   setRatings]   = useState([])

  const [loadH, setLoadH] = useState(false)
  const [loadW, setLoadW] = useState(false)
  const [loadR, setLoadR] = useState(false)

  const [errH, setErrH] = useState(null)
  const [errW, setErrW] = useState(null)
  const [errR, setErrR] = useState(null)

  const fetchHistory = useCallback(() => {
    setLoadH(true)
    setErrH(null)
    watchService.getHistory()
      .then((d) => {
        const items = Array.isArray(d) ? d : (d?.items || d?.history || d?.data || [])
        setHistory(items)
      })
      .catch(() => setErrH('Failed to load watch history'))
      .finally(() => setLoadH(false))
  }, [])

  const fetchWatchlist = useCallback(() => {
    setLoadW(true)
    setErrW(null)
    watchlistService.getCollections()
      .then((d) => {
        const items = Array.isArray(d) ? d : (d?.collections || d?.data || d || [])
        setWatchlist(items)
      })
      .catch(() => setErrW('Failed to load watchlists'))
      .finally(() => setLoadW(false))
  }, [])

  const fetchRatings = useCallback(() => {
    setLoadR(true)
    setErrR(null)
    ratingService.getMyRatings()
      .then((d) => {
        const items = Array.isArray(d) ? d : (d?.items || d?.ratings || d?.data || [])
        setRatings(items)
      })
      .catch(() => setErrR('Failed to load ratings'))
      .finally(() => setLoadR(false))
  }, [])

  useEffect(() => {
    fetchHistory()
    fetchWatchlist()
    fetchRatings()
  }, [fetchHistory, fetchWatchlist, fetchRatings])

  const tabData    = { history, watchlist, ratings }
  const tabLoading = { history: loadH, watchlist: loadW, ratings: loadR }
  const tabError   = { history: errH,  watchlist: errW,  ratings: errR  }

  const initials = (user?.username || user?.email || '?').charAt(0).toUpperCase()
  const avatarUrl = user?.avatar_url
    ? (user.avatar_url.startsWith('http') ? user.avatar_url : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${user.avatar_url}`)
    : null

  return (
    <main className="dashboard page-content" id="dashboard-page">
      {/* ── Background Aurora Animation ── */}
      <div className="dashboard-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#00F2FE", "#4FACFE", "#6A11CB"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="dashboard-aurora-overlay" />
      </div>

      <div className="container dashboard__inner">

        {/* ── User Hero ── */}
        <div className="dashboard__hero">
          <div className="dashboard__avatar" style={{ overflow: 'hidden' }}>
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={user?.username || 'User'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              initials
            )}
          </div>
          <div className="dashboard__hero-info">
            <h1 className="dashboard__title">
              <ShinyText text={`Welcome back, ${user?.username || 'friend'}!`} />
            </h1>
            <p className="dashboard__subtitle">{user?.email}</p>
          </div>
          <div className="dashboard__stats">
            <div className="dashboard__stat">
              <span className="dashboard__stat-value">{history.length}</span>
              <span className="dashboard__stat-label">Watched</span>
            </div>
            <div className="dashboard__stat">
              <span className="dashboard__stat-value">{watchlist.length}</span>
              <span className="dashboard__stat-label">Watchlists</span>
            </div>
            <div className="dashboard__stat">
              <span className="dashboard__stat-value">{ratings.length}</span>
              <span className="dashboard__stat-label">Rated</span>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="dashboard__tabs-wrapper" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', marginBottom: 'var(--space-6)' }}>
          <div className="dashboard__tabs" role="tablist" aria-label="Dashboard sections" style={{ borderBottom: 'none', marginBottom: 0 }}>
            {TABS.map((t) => (
              <button
                key={t.key}
                id={`tab-${t.key}`}
                role="tab"
                aria-selected={activeTab === t.key}
                className={`dashboard__tab${activeTab === t.key ? ' dashboard__tab--active' : ''}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <Link to="/settings/import" className="btn btn--secondary btn--sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg> Import List
          </Link>
        </div>

        {/* ── Tab Panel ── */}
        <div
          className="dashboard__panel"
          role="tabpanel"
          aria-labelledby={`tab-${activeTab}`}
          id={`panel-${activeTab}`}
        >
          <TabContent
            tab={activeTab}
            data={tabData[activeTab]}
            loading={tabLoading[activeTab]}
            error={tabError[activeTab]}
          />
        </div>

      </div>
      <div className="fixed-bottom-fade" />
    </main>
  )
}
