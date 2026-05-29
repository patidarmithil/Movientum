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
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { movieService } from '../services/movieService'
import { useAuth } from '../context/AuthContext'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import Aurora from '../components/Aurora'
import BorderGlow from '../components/BorderGlow'
import api from '../utils/api'
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

function MovieRow({ title, movies, loading = false, seeAllHref = '/movies', children }) {
  return (
    <div className="movie-row section-sm">
      <div className="section-header">
        <div className="section-header-left">
          <h2>{title}</h2>
          {children}
        </div>
        <Link to={seeAllHref} className="see-all-link">See all →</Link>
      </div>
      <div className="scroll-row-container">
        <div className="scroll-row-fade left-fade"></div>
        <div className="scroll-row">
          {loading
            ? <MovieCardSkeleton count={6} />
            : movies.length === 0
              ? <p className="no-movies-text">No titles found.</p>
              : movies.map((m) => (
                  <MovieCard key={`${m.id}-${m.media_type || 'movie'}`} movie={m} />
                ))
          }
        </div>
        <div className="scroll-row-fade right-fade"></div>
      </div>
    </div>
  )
}

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

  // Main columns states
  const [trending, setTrending] = useState([])
  const [trendLoad, setTrendLoad] = useState(true)

  const [topRated, setTopRated] = useState([])
  const [topRatedLoad, setTopRatedLoad] = useState(true)

  const [genreMovies, setGenreMovies] = useState([])
  const [genreLoad, setGenreLoad] = useState(true)
  const [selectedGenreId, setSelectedGenreId] = useState(28) // Default: Action

  const [forYou, setForYou] = useState([])
  const [forYouLoad, setForYouLoad] = useState(false)

  // Sidebar states
  const [upcoming, setUpcoming] = useState([])
  const [upcomingLoad, setUpcomingLoad] = useState(true)
  const [upcomingFilter, setUpcomingFilter] = useState('month') // Default: month

  // Fetch Trending
  useEffect(() => {
    setTrendLoad(true)
    movieService.getTrending()
      .then((data) => {
        setTrending(data?.movies || data || [])
      })
      .catch(() => setTrending([]))
      .finally(() => setTrendLoad(false))
  }, [])

  // Fetch Top Rated
  useEffect(() => {
    setTopRatedLoad(true)
    movieService.getTopRated()
      .then((data) => {
        setTopRated(data?.movies || data || [])
      })
      .catch(() => setTopRated([]))
      .finally(() => setTopRatedLoad(false))
  }, [])

  // Fetch Genre Movies
  useEffect(() => {
    setGenreLoad(true)
    movieService.getMoviesByGenreId(selectedGenreId)
      .then((data) => {
        setGenreMovies(data?.movies || data || [])
      })
      .catch(() => setGenreMovies([]))
      .finally(() => setGenreLoad(false))
  }, [selectedGenreId])

  // Fetch Recommendations (For You)
  useEffect(() => {
    if (!isLoggedIn) {
      setForYou([])
      return
    }
    setForYouLoad(true)
    api.get('/api/v1/recommendations')
      .then((r) => {
        setForYou(r.data?.movies || r.data || [])
      })
      .catch(() => setForYou([]))
      .finally(() => setForYouLoad(false))
  }, [isLoggedIn])

  // Fetch Upcoming
  useEffect(() => {
    setUpcomingLoad(true)
    movieService.getUpcoming(upcomingFilter)
      .then((data) => {
        setUpcoming(data?.movies || data || [])
      })
      .catch(() => setUpcoming([]))
      .finally(() => setUpcomingLoad(false))
  }, [upcomingFilter])

  const handleItemClick = (item) => {
    const isTV = item.media_type === 'tv'
    navigate(isTV ? `/tv/${item.id}` : `/movies/${item.id}`)
  }

  const selectedGenreName = GENRE_OPTIONS.find(g => g.id === selectedGenreId)?.name || 'Genre'

  return (
    <main className="home page-content">
      {/* ── Background Aurora Animation ── */}
      <div className="home-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={['#5227FF', '#B497CF', '#080808']}
          blend={0.7}
          amplitude={1.2}
          speed={0.5}
        />
        <div className="home-aurora-overlay" />
      </div>

      <div className="home-layout-container container">
        
        {/* ── Left Content Column ── */}
        <div className="home-main-col">
          
          {/* Trending Now */}
          <MovieRow 
            title="Trending Now" 
            movies={trending} 
            loading={trendLoad} 
            seeAllHref="/explore?sort=popularity" 
          />

          {/* For You (Personalized Recommendations) — Logged-in only */}
          {isLoggedIn && (
            <MovieRow 
              title="For You 🎯" 
              movies={forYou} 
              loading={forYouLoad} 
              seeAllHref="/dashboard" 
            />
          )}

          {/* Top Rated */}
          <MovieRow 
            title="Top Rated" 
            movies={topRated} 
            loading={topRatedLoad} 
            seeAllHref="/explore?sort=rating" 
          />

          {/* Top Rated in Genre */}
          <MovieRow 
            title={`Top Rated in ${selectedGenreName}`}
            movies={genreMovies} 
            loading={genreLoad} 
            seeAllHref={`/explore?genres=${selectedGenreName}`}
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
        <aside className="home-sidebar">
          <div className="sidebar-header">
            <div className="sidebar-title-wrap">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C12 2 12 5.5 10 7.5C8 9.5 5 11.5 5 15C5 18.87 8.13 22 12 22C15.87 22 19 18.87 19 15C19 10.5 15.5 8 15.5 8C15.5 8 13.5 9 12.5 10.5C11.5 12 12 14.5 12 14.5C12 14.5 14 13.5 14.5 11.5C15 9.5 12 2 12 2Z" />
              </svg>
              <h3>Most Interested</h3>
            </div>
            
            <div className="sidebar-select-wrapper">
              <select
                value={upcomingFilter}
                onChange={(e) => setUpcomingFilter(e.target.value)}
                className="sidebar-select"
              >
                <option value="week">This Week</option>
                <option value="month">This Month</option>
                <option value="year">This Year</option>
              </select>
            </div>
          </div>

          <div className="sidebar-list">
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
                  <BorderGlow
                    key={`${item.id}-${item.media_type}`}
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
                )
              })
            )}
          </div>
        </aside>

      </div>
    </main>
  )
}
