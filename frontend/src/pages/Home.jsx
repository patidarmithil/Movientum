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

  // Main columns states
  const [trending, setTrending] = useSessionState('home_trending', [])
  const [trendLoad, setTrendLoad] = useState(trending.length === 0)
  const [showLoader, setShowLoader] = useState(trending.length === 0)

  // Control full screen cold start loader visibility
  useEffect(() => {
    if (!trendLoad) {
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [trendLoad])

  const [topRated, setTopRated] = useSessionState('home_topRated', [])
  const [topRatedLoad, setTopRatedLoad] = useState(topRated.length === 0)

  const [selectedGenreId, setSelectedGenreId] = useSessionState('home_selectedGenreId', 28) // Default: Action
  const [genreMovies, setGenreMovies] = useSessionState('home_genreMovies', [])
  const [genreLoad, setGenreLoad] = useState(genreMovies.length === 0)

  const [forYou, setForYou] = useSessionState('home_forYou', [])
  const [forYouLoad, setForYouLoad] = useState(isLoggedIn && forYou.length === 0)

  // Trailers state (not cached in session — region changes need fresh data)
  const [trailers, setTrailers] = useState([])
  const [trailersLoad, setTrailersLoad] = useState(true)
  
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

  // Fetch Trending
  useEffect(() => {
    if (trending.length > 0) {
      setTrendLoad(false)
      return
    }
    setTrendLoad(true)
    movieService.getTrending()
      .then((data) => {
        setTrending(data?.movies || data || [])
      })
      .catch(() => {
        setTrending([])
        setHasError(true)
      })
      .finally(() => setTrendLoad(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch Top Rated
  useEffect(() => {
    if (topRated.length > 0) {
      setTopRatedLoad(false)
      return
    }
    setTopRatedLoad(true)
    movieService.getTopRated()
      .then((data) => {
        setTopRated(data?.movies || data || [])
      })
      .catch(() => {
        setTopRated([])
        setHasError(true)
      })
      .finally(() => setTopRatedLoad(false))
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

  // Fetch Trailers — re-fetch whenever region pill changes
  useEffect(() => {
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


  // Fetch Upcoming
  useEffect(() => {
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
                          <img src={posterUrl} alt={item.title} className="sidebar-card-poster" loading="lazy" />
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
    </>
  )
}
