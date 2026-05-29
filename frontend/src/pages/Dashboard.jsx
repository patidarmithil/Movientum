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
import { useAuth } from '../context/AuthContext'
import { watchService } from '../services/watchService'
import { ratingService } from '../services/ratingService'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import './Dashboard.css'

const TABS = [
  { key: 'watchlist', label: '★ Watchlist' },
  { key: 'history',   label: '✓ Watched' },
  { key: 'ratings',   label: '🎯 My Ratings' },
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
      watchlist: 'Your watchlist is empty. Add movies you want to watch.',
      ratings:   "You haven't rated any movies yet.",
    }
    return <EmptyTab message={EMPTY_MSGS[tab]} />
  }

  if (tab === 'ratings') {
    return (
      <div className="movie-grid">
        {data.map((item) => (
          <RatingCard key={item.id} item={item} />
        ))}
      </div>
    )
  }

  // history + watchlist
  return (
    <div className="movie-grid">
      {data.map((item) => {
        const movie = extractMovie(item)
        return <MovieCard key={movie.id ?? item.id} movie={movie} />
      })}
    </div>
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
    watchService.getWatchlist()
      .then((d) => {
        const items = Array.isArray(d) ? d : (d?.items || d?.watchlist || d?.data || [])
        setWatchlist(items)
      })
      .catch(() => setErrW('Failed to load watchlist'))
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

  return (
    <main className="dashboard page-content" id="dashboard-page">
      <div className="container dashboard__inner">

        {/* ── User Hero ── */}
        <div className="dashboard__hero">
          <div className="dashboard__avatar">{initials}</div>
          <div className="dashboard__hero-info">
            <h1 className="dashboard__title">Welcome back, {user?.username || 'friend'}!</h1>
            <p className="dashboard__subtitle">{user?.email}</p>
          </div>
          <div className="dashboard__stats">
            <div className="dashboard__stat">
              <span className="dashboard__stat-value">{history.length}</span>
              <span className="dashboard__stat-label">Watched</span>
            </div>
            <div className="dashboard__stat">
              <span className="dashboard__stat-value">{watchlist.length}</span>
              <span className="dashboard__stat-label">Watchlist</span>
            </div>
            <div className="dashboard__stat">
              <span className="dashboard__stat-value">{ratings.length}</span>
              <span className="dashboard__stat-label">Rated</span>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="dashboard__tabs" role="tablist" aria-label="Dashboard sections">
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
    </main>
  )
}
