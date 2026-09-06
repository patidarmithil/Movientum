/**
 * Home Page
 *
 * TMDB-driven modern layout:
 *  - Background Aurora animation on start.
 *  - Grid layout with a Main Content Area (left/center) and a Sidebar (right).
 *  - Main content:
 *    - Trending Now (GET /api/v1/movies/trending)
 *    - For You (GET /api/v1/recommendations) - personalized for logged-in users
 *    - Top Rated (GET /api/v1/movies/top_rated)
 *    - Top Rated in [Genre] (GET /api/v1/movies/genre/{genre_id}) - with dynamic pill selectors
 *  - Sidebar:
 *    - Most Interested / Upcoming (GET /api/v1/movies/upcoming?filter={week|month|year})
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { movieService } from '../services/movieService'
import { pageService } from '../services/pageService'
import { useAuth } from '../context/AuthContext'
import { useSessionState } from '../hooks/useSessionState'
import Aurora from '../components/Aurora'
import BorderGlow from '../components/BorderGlow'
import HomeNewsStrip from '../components/HomeNewsStrip'
import FilterDropdown from '../components/FilterDropdown'
import api from '../utils/api'
import ShinyText from '../components/ShinyText'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import ScrollReveal from '../components/ScrollReveal'
import MovieRow from '../components/MovieRow'
import TrailerRow from '../components/TrailerRow'
import TrailerModal from '../components/TrailerModal'
import WatchlistSection from '../components/WatchlistSection'
import { getHomeTrailers } from '../services/trailerService'
import { contactService } from '../services/contactService'
import { AnimatePresence } from 'motion/react'
import ColdStartLoader from '../components/ColdStartLoader'
import ErrorPage from './ErrorPage'
import './Home.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

const GENRE_OPTIONS = [
  { id: 28, name: 'Action' },
  { id: 35, name: 'Comedy' },
  { id: 18, name: 'Drama' },
  { id: 10749, name: 'Romance' },
  { id: 53, name: 'Thriller' },
  { id: 878, name: 'Sci-Fi' },
  { id: 27, name: 'Horror' },
  { id: 9648, name: 'Mystery' },
  { id: 12, name: 'Adventure' },
  { id: 16, name: 'Animation' }
]



function formatDate(dateStr) {
  if (!dateStr) return 'To Be Confirmed'
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return dateStr
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return dateStr
  }
}

export default function Home() {
  const { isLoggedIn } = useAuth()
  const navigate = useNavigate()
  const [hasError, setHasError] = useState(false)
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactStatus, setContactStatus] = useState('idle') // idle | sending | sent | error

  // Main columns states
  const [trending, setTrending] = useSessionState('home_trending', [])
  const [trendLoad, setTrendLoad] = useState(trending.length === 0)
  const [showLoader, setShowLoader] = useState(trending.length === 0)
  const [mountedAt] = useState(() => performance.now())

  // Control full screen cold start loader visibility.
  // Enforces a minimum display time (1.1s) so a fast/warm response doesn't flash the
  // loader on and off before the poster wall has a chance to fade in.
  // Also enforces a MAX display time (2.5s): on a cold Azure/Render start the
  // backend can take 40-50s, and a blank fullscreen loader for that long loses
  // visitors. Past the cap we drop straight to the page shell (aurora bg, nav,
  // static rails) with per-row skeletons — something on screen beats nothing.
  const MIN_LOADER_MS = 1100
  const MAX_LOADER_MS = 2500
  useEffect(() => {
    if (!trendLoad) {
      const elapsed = performance.now() - mountedAt
      const remaining = Math.max(0, MIN_LOADER_MS - elapsed)
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, remaining)
      return () => clearTimeout(timer)
    }
    const capTimer = setTimeout(() => {
      setShowLoader(false)
    }, MAX_LOADER_MS)
    return () => clearTimeout(capTimer)
  }, [trendLoad, mountedAt])

  // Cold-start notice: if backend still hasn't answered by 5s, tell the user
  // why — free-tier hosting cold starts run 20-30s. Auto-clears the moment
  // trendLoad flips false, whichever effect fires first.
  const [showColdBootMsg, setShowColdBootMsg] = useState(false)
  const COLD_BOOT_MSG_MS = 5000
  useEffect(() => {
    if (!trendLoad) {
      setShowColdBootMsg(false)
      return
    }
    const timer = setTimeout(() => setShowColdBootMsg(true), COLD_BOOT_MSG_MS)
    return () => clearTimeout(timer)
  }, [trendLoad])

  const [topRated, setTopRated] = useSessionState('home_topRated', [])
  const [topRatedLoad, setTopRatedLoad] = useState(topRated.length === 0)

  const [selectedGenreId, setSelectedGenreId] = useSessionState('home_selectedGenreId', 28) // Default: Action
  const [genreMovies, setGenreMovies] = useSessionState('home_genreMovies', [])
  const [genreLoad, setGenreLoad] = useState(genreMovies.length === 0)

  const [forYou, setForYou] = useSessionState('home_forYou', [])
  const [forYouLoad, setForYouLoad] = useState(isLoggedIn && forYou.length === 0)

  const [guestRecs, setGuestRecs] = useSessionState('home_guestRecs', [])
  const [guestRecsLoad, setGuestRecsLoad] = useState(!isLoggedIn && guestRecs.length === 0)

  // Trailers state — session-cached (stale-while-revalidate): a returning
  // visit paints the last-known rail instantly, then the bundle effect below
  // refreshes it in the background and swaps in the fresh result silently.
  // A region-pill change (effect further down) still clears and refetches for
  // real, since that's a genuine user-initiated change, not a repeat visit.
  const [trailers, setTrailers] = useSessionState('home_trailers', [])
  const [trailersLoad, setTrailersLoad] = useState(trailers.length === 0)
  
  // Trailer Modal state
  const [trailerModalOpen, setTrailerModalOpen] = useState(false)
  const [trailerModalData, setTrailerModalData] = useState(null)

  // Trailer Region State
  const [trailerRegion, setTrailerRegion] = useSessionState('home_trailerRegion', 'All')
  const TRAILER_REGIONS = ['All', 'India', 'Anime', 'Hollywood', 'Other']

  // Sidebar states
  const [upcomingFilter, setUpcomingFilter] = useSessionState('home_upcomingFilter', 'month') // Default: month
  const [upcoming, setUpcoming] = useSessionState('home_upcoming', [])
  const [upcomingLoad, setUpcomingLoad] = useState(upcoming.length === 0)

  // Refs to track if filter changed vs initial mount
  const lastGenreIdRef = useRef(selectedGenreId)
  const lastUpcomingFilterRef = useRef(upcomingFilter)
  // The home bundle delivers the upcoming + trailer rails on first paint, so
  // those two effects sit out their initial run instead of duplicating it.
  const upcomingInitRef = useRef(true)
  const trailersInitRef = useRef(true)

  // Cache poster paths for the cold-start loader on the NEXT visit.
  // Deliberately localStorage (not the storage.js wrapper — that is auth-only and
  // switches between local/session based on "Remember me"; this must survive
  // across sessions unconditionally).
  const cacheLoaderPosters = (movies) => {
    try {
      const paths = movies.map((m) => m.poster_path).filter(Boolean).slice(0, 40)
      if (paths.length >= 12) {
        localStorage.setItem('mv_loader_posters', JSON.stringify({ v: 1, t: Date.now(), paths }))
      }
    } catch { /* quota exceeded / private mode — non-fatal */ }
  }

  // ── Home bundle ─────────────────────────────────────────────────
  // ONE request (GET /api/v1/pages/home) fills trending + top rated + upcoming
  // + trailers, and the backend serves all four from a single Redis key. This
  // replaces four parallel requests that were four separate Redis reads.
  //
  // The rails the user can change after load (genre picker, upcoming filter,
  // trailer region) still refetch through their own endpoints below — only the
  // initial paint goes through the bundle.
  useEffect(() => {
    const haveLists = trending.length > 0 && topRated.length > 0 && upcoming.length > 0
    const haveTrailers = trailers.length > 0

    if (haveLists) {
      // Restored from session state — paint instantly, no skeleton.
      setTrendLoad(false); setTopRatedLoad(false); setUpcomingLoad(false)
      setTrailersLoad(!haveTrailers)
      getHomeTrailers(trailerRegion)
        .then((data) => setTrailers(data?.data || []))
        .catch(() => { if (!haveTrailers) setTrailers([]) })
        .finally(() => setTrailersLoad(false))
      return
    }

    setTrendLoad(true); setTopRatedLoad(true); setUpcomingLoad(true)
    setTrailersLoad(!haveTrailers)
    pageService.getHome({
      upcomingFilter,
      region: trailerRegion === 'All' ? null : trailerRegion,
    })
      .then((data) => {
        const trendingItems = data?.trending?.movies || []
        setTrending(trendingItems)
        cacheLoaderPosters(trendingItems)
        setTopRated(data?.top_rated?.movies || [])
        setUpcoming(data?.upcoming?.movies || [])
        setTrailers(data?.trailers?.data || [])
      })
      .catch(() => {
        setTrending([]); setTopRated([]); setUpcoming([])
        if (!haveTrailers) setTrailers([])
        setHasError(true)
      })
      .finally(() => {
        setTrendLoad(false); setTopRatedLoad(false); setUpcomingLoad(false); setTrailersLoad(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch Genre Movies
  useEffect(() => {
    if (lastGenreIdRef.current === selectedGenreId && genreMovies.length > 0) {
      setGenreLoad(false)
      return
    }
    lastGenreIdRef.current = selectedGenreId
    setGenreLoad(true)
    movieService.getMoviesByGenreId(selectedGenreId)
      .then((data) => {
        setGenreMovies(data?.movies || data || [])
      })
      .catch(() => {
        setGenreMovies([])
        setHasError(true)
      })
      .finally(() => setGenreLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGenreId])

  // Fetch Recommendations (For You)
  useEffect(() => {
    if (!isLoggedIn) {
      setForYou([])
      return
    }
    if (forYou.length > 0) {
      setForYouLoad(false)
      return
    }
    setForYouLoad(true)
    api.get('/api/v1/recommendations')
      .then((r) => {
        setForYou(r.data?.movies || r.data || [])
      })
      .catch(() => setForYou([]))
      .finally(() => setForYouLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  async function detectCountryCode() {
    const stored = sessionStorage.getItem('guest_country_code_v2')
    if (stored) return stored
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      const res = await fetch('https://get.geojs.io/v1/ip/country.json', { signal: controller.signal })
      clearTimeout(timer)
      const data = await res.json()
      const code = data.country || 'US'
      sessionStorage.setItem('guest_country_code_v2', code)
      return code
    } catch {
      return 'US'
    }
  }

  useEffect(() => {
    if (isLoggedIn) return
    if (guestRecs.length > 0) { setGuestRecsLoad(false); return }
    setGuestRecsLoad(true)
    detectCountryCode().then(code =>
      api.get('/api/v1/recommendations/guest?country_code=' + code)
        .then(r => setGuestRecs(r.data?.movies || []))
        .catch(() => setGuestRecs([]))
        .finally(() => setGuestRecsLoad(false))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn])

  // Fetch Trailers — re-fetch whenever region pill changes.
  // The first run is skipped: the home bundle above already delivered this rail.
  useEffect(() => {
    if (trailersInitRef.current) {
      trailersInitRef.current = false
      return
    }
    setTrailersLoad(true)
    setTrailers([])
    getHomeTrailers(trailerRegion)
      .then((data) => {
        setTrailers(data?.data || [])
      })
      .catch(() => {
        setTrailers([])
      })
      .finally(() => setTrailersLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn, trailerRegion])


  // Fetch Upcoming — first run skipped, the home bundle covers it.
  useEffect(() => {
    if (upcomingInitRef.current) {
      upcomingInitRef.current = false
      return
    }
    if (lastUpcomingFilterRef.current === upcomingFilter && upcoming.length > 0) {
      setUpcomingLoad(false)
      return
    }
    lastUpcomingFilterRef.current = upcomingFilter
    setUpcomingLoad(true)
    movieService.getUpcoming(upcomingFilter)
      .then((data) => {
        setUpcoming(data?.movies || data || [])
      })
      .catch(() => {
        setUpcoming([])
        setHasError(true)
      })
      .finally(() => setUpcomingLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingFilter])

  const handleItemClick = (item) => {
    const isTV = item.media_type === 'tv'
    navigate(isTV ? `/tv/${item.id}` : `/movies/${item.id}`, { state: { movie: item } })
  }

  const handlePlayTrailer = (item) => {
    setTrailerModalData(item)
    setTrailerModalOpen(true)
  }

  const selectedGenreName = GENRE_OPTIONS.find(g => g.id === selectedGenreId)?.name || 'Genre'

  if (hasError) {
    return (
      <ErrorPage
        type="500"
        message="sorry our server are down we are working on it please try again sometime later or try to refresh once"
        onRetry={() => window.location.reload()}
      />
    )
  }

  return (
    <>
      <AnimatePresence>
        {showLoader && <ColdStartLoader />}
      </AnimatePresence>
      <main className="home page-content">
      {/* ── Background Aurora Animation ── */}
      <div className="home-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={['#5227FF', '#B497CF', '#080808']}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="home-aurora-overlay" />
      </div>

      {showColdBootMsg && (
        <div className="cold-boot-notice" role="status">
          Sorry, our server is booting up — can take around 20-30 seconds. Thanks for waiting!
        </div>
      )}

      <div className="home-layout-container container">
        
        {/* ── Left Content Column ── */}
        <div className="home-main-col">
          
          {/* Trending Now */}
          <MovieRow 
            title="Trending Now" 
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"></polyline><polyline points="16 7 22 7 22 13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"></polyline></svg>}
            movies={trending} 
            loading={trendLoad} 
            seeAllHref="/explore?sort=popularity" 
            premiumScroll={true}
          />

          {!isLoggedIn && (
            <>
              <MovieRow
                title="Recommendations"
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5"></circle><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.5"></circle><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>}
                movies={guestRecs}
                loading={guestRecsLoad}
                seeAllHref="/explore?sort=rating"
                premiumScroll={true}
              />
              <TrailerRow 
                title="Trailers 🎬" 
                items={trailers} 
                loading={trailersLoad} 
                onPlayTrailer={handlePlayTrailer}
                premiumScroll={true}
              >
                <div className="movie-row__pills-container">
                  {TRAILER_REGIONS.map(region => (
                    <button
                      key={region}
                      className={`genre-pill-btn ${trailerRegion === region ? 'active' : ''}`}
                      onClick={() => setTrailerRegion(region)}
                    >
                      {region}
                    </button>
                  ))}
                </div>
              </TrailerRow>
            </>
          )}

          {/* For You (Personalized Recommendations) — Logged-in only */}
          {isLoggedIn && (
            <>
              <MovieRow 
                title="For You" 
                icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5"></circle><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.5"></circle><circle cx="12" cy="12" r="2" fill="currentColor"></circle></svg>}
                movies={forYou}
                loading={forYouLoad}
                seeAllHref="/recommendations"
                premiumScroll={true}
                showFeedback={true}
                feedbackSource="for_you"
              />
              <TrailerRow
                title="🎬 Trailers" 
                items={trailers} 
                loading={trailersLoad} 
                onPlayTrailer={handlePlayTrailer}
                premiumScroll={true}
              >
                <div className="movie-row__pills-container">
                  {TRAILER_REGIONS.map(region => (
                    <button
                      key={region}
                      className={`genre-pill-btn ${trailerRegion === region ? 'active' : ''}`}
                      onClick={() => setTrailerRegion(region)}
                    >
                      {region}
                    </button>
                  ))}
                </div>
              </TrailerRow>
              <WatchlistSection />
            </>
          )}

          {/* Top Rated */}
          <MovieRow 
            title="Top Rated" 
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"></polygon></svg>}
            movies={topRated} 
            loading={topRatedLoad} 
            seeAllHref="/explore?sort=rating" 
            premiumScroll={true}
          />

          {/* News Strip */}
          <HomeNewsStrip />

          {/* Top Rated in Genre */}
          <MovieRow 
            title={`Top Rated in ${selectedGenreName}`}
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"></path><path d="M2 12h10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"></path><path d="M2 17h10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"></path><path d="M2 7h4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"></path></svg>}
            movies={genreMovies} 
            loading={genreLoad} 
            seeAllHref={`/explore?genres=${selectedGenreName}`}
            premiumScroll={true}
          >
            <div className="genre-pills">
              {GENRE_OPTIONS.map((g) => (
                <button
                  key={g.id}
                  className={`genre-pill-btn ${selectedGenreId === g.id ? 'active' : ''}`}
                  onClick={() => setSelectedGenreId(g.id)}
                >
                  {g.name}
                </button>
              ))}
            </div>
          </MovieRow>

        </div>

        {/* ── Right Sidebar Column ── */}
        <ScrollReveal className="home-sidebar" delay={0.15}>
          <div className="sidebar-header">
            <div className="sidebar-title-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C12 2 12 5.5 10 7.5C8 9.5 5 11.5 5 15C5 18.87 8.13 22 12 22C15.87 22 19 18.87 19 15C19 10.5 15.5 8 15.5 8C15.5 8 13.5 9 12.5 10.5C11.5 12 12 14.5 12 14.5C12 14.5 14 13.5 14.5 11.5C15 9.5 12 2 12 2Z" />
              </svg>
              <h3>
                <ShinyText text="Most Interested" />
              </h3>
            </div>
            
            <FilterDropdown
              label={upcomingFilter === 'week' ? 'This Week' : upcomingFilter === 'month' ? 'This Month' : 'This Year'}
              active={upcomingFilter !== 'month'}
            >
              <div className="filter-dropdown__menu-list">
                {[
                  { value: 'week', label: 'This Week' },
                  { value: 'month', label: 'This Month' },
                  { value: 'year', label: 'This Year' }
                ].map((o) => (
                  <label key={o.value} className={`filter-dropdown__menu-item ${upcomingFilter === o.value ? 'filter-dropdown__menu-item--active' : ''}`}>
                    <input
                      type="radio"
                      name="upcoming-filter"
                      className="filter-dropdown__radio"
                      checked={upcomingFilter === o.value}
                      onChange={() => setUpcomingFilter(o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </div>
            </FilterDropdown>
          </div>

          <StaggerContainer key={`upcoming-${upcomingFilter}-${upcomingLoad}-${upcoming.length}`} className="sidebar-list">
            {upcomingLoad ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="sidebar-card-skeleton">
                  <div className="skeleton-rank" />
                  <div className="skeleton-poster skeleton" />
                  <div className="skeleton-details">
                    <div className="skeleton-line skeleton w-75" />
                    <div className="skeleton-line skeleton w-50" />
                  </div>
                </div>
              ))
            ) : upcoming.length === 0 ? (
              <p className="no-upcoming-text">No upcoming titles found.</p>
            ) : (
              upcoming.map((item, index) => {
                const posterUrl = item.poster_path
                  ? `${TMDB_IMAGE_BASE}/w185${item.poster_path}`
                  : null
                const interestedCount = Math.round(item.popularity * 12 + 100)
                const interestedStr = interestedCount > 1000 ? (interestedCount / 1000).toFixed(1) + 'K' : interestedCount

                const isTV = item.media_type === 'tv'
                const dateText = item.release_date ? formatDate(item.release_date) : 'To Be Confirmed'
                const categoryText = isTV ? 'New Season' : 'In Theatre'

                return (
                  <StaggerItem key={`${item.id}-${item.media_type}`} index={index}>
                    <BorderGlow
                      className="sidebar-card"
                      onClick={() => handleItemClick(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleItemClick(item)}
                      borderRadius={16}
                      glowRadius={25}
                      glowIntensity={0.6}
                      fillOpacity={0.08}
                      colors={['#B048FF', '#00E5A0', '#FF4D6D']}
                      backgroundColor="rgba(18, 18, 18, 0.6)"
                    >
                      <div className="sidebar-card-rank">{index + 1}</div>
                      
                      <div className="sidebar-card-poster-wrap">
                        {posterUrl ? (
                          <img src={posterUrl} alt={item.title} className="sidebar-card-poster" width={185} height={278} loading="lazy" decoding="async" />
                        ) : (
                          <div className="sidebar-card-poster-fallback">🎬</div>
                        )}
                      </div>

                      <div className="sidebar-card-info">
                        <h4 className="sidebar-card-title">{item.title}</h4>
                        <p className="sidebar-card-meta">
                          {dateText} • {categoryText}
                        </p>
                        <div className="sidebar-card-interested">
                          <span className="sidebar-card-fire-icon">🔥</span>
                          {interestedStr} Interested
                        </div>
                      </div>
                    </BorderGlow>
                  </StaggerItem>
                )
              })
            )}
          </StaggerContainer>

          {/* See All Button */}
          {!upcomingLoad && upcoming.length > 0 && (
            <div className="sidebar-see-all-wrap">
              <Link to="/most-interested" className="sidebar-see-all-btn">
                See All
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7 17l9.2-9.2M17 17V7H7" />
                </svg>
              </Link>
            </div>
          )}
        </ScrollReveal>

      </div>

      {/* ── Footer ── */}
      <footer className="home-footer">
        <div className="home-footer__love">
          Made with <span className="home-footer__heart">❤️</span> in India
        </div>
        <div className="home-footer__bottom">
          <span className="home-footer__copyright">
            &copy; {new Date().getFullYear()} Movientum, Inc. · BETA · Always improving
          </span>
          <div className="home-footer__links">
            <a href="https://patidarmithil-portfolio.netlify.app/" target="_blank" rel="noopener noreferrer">Portfolio</a>
            <a href="https://github.com/patidarmithil" target="_blank" rel="noopener noreferrer">GitHub</a>
            <Link to="/feedback">Feedback</Link>
            <button type="button" onClick={() => setShowContactModal(true)}>Contact Me</button>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </main>
    {trailerModalOpen && trailerModalData && (
      <TrailerModal
        isOpen={trailerModalOpen}
        onClose={() => setTrailerModalOpen(false)}
        directVideoKey={trailerModalData.video_key}
        contentId={trailerModalData.id}
        mediaType={trailerModalData.media_type}
      />
    )}
    {showContactModal && (
      <div className="intro-contact-modal-overlay" onClick={() => { setShowContactModal(false); setContactStatus('idle') }}>
        <div className="intro-contact-modal" onClick={(e) => e.stopPropagation()}>
          <button className="intro-contact-modal__close" onClick={() => { setShowContactModal(false); setContactStatus('idle') }}>&times;</button>
          <h3>Get in Touch</h3>
          {contactStatus !== 'sent' && (
            <p className="intro-contact-modal__subtitle">
              Send a message and we'll reply to the email you give below, or reach out directly at{' '}
              <a href="mailto:mithilpatidar80@gmail.com">mithilpatidar80@gmail.com</a>.
            </p>
          )}
          {contactStatus === 'sent' ? (
            <p style={{ color: '#4ADE80', fontWeight: 600 }}>Message sent — thanks! We'll get back to you soon.</p>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault()
              const name = e.target.name.value
              const email = e.target.email.value
              const message = e.target.message.value
              setContactStatus('sending')
              try {
                await contactService.submit({ name, email, message })
                setContactStatus('sent')
              } catch {
                setContactStatus('error')
              }
            }}>
              <div className="form-group" style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                <label htmlFor="home-contact-name" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Name</label>
                <input id="home-contact-name" name="name" type="text" placeholder="Your Name" required style={{ width: '100%', padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.95rem' }} />
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                <label htmlFor="home-contact-email" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Email</label>
                <input id="home-contact-email" name="email" type="email" placeholder="yourname@example.com" required style={{ width: '100%', padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.95rem' }} />
              </div>
              <div className="form-group" style={{ marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                <label htmlFor="home-contact-message" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Message</label>
                <textarea id="home-contact-message" name="message" rows="4" placeholder="Your Message..." required style={{ width: '100%', padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.95rem', resize: 'vertical' }}></textarea>
              </div>
              {contactStatus === 'error' && (
                <p style={{ color: '#F87171', marginBottom: '1rem' }}>Failed to send — please try again or email us directly.</p>
              )}
              <button type="submit" className="btn btn--primary" disabled={contactStatus === 'sending'} style={{ width: '100%', padding: '1rem', fontWeight: '600' }}>
                {contactStatus === 'sending' ? 'Sending...' : 'Send Message'}
              </button>
            </form>
          )}
        </div>
      </div>
    )}
    </>
  )
}
