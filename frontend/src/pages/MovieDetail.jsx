/**
 * MovieDetail Page — Phase 3.5C
 *
 * Replaces dummy data with live API calls.
 * Adds:
 *  - RatingMeter with category distribution
 *  - "Mark Watched" button → POST /api/v1/watch
 *  - "Add/Remove Watchlist" button → POST/DELETE /api/v1/watch/watchlist
 *  - Similar Movies row → GET /api/v1/recommendations/similar/{id}
 */
import { useParams, Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import { movieService } from '../services/movieService'
import { watchService } from '../services/watchService'
import { ratingService } from '../services/ratingService'
import { useAuth } from '../context/AuthContext'
import MovieCard from '../components/MovieCard'
import RatingMeter from '../components/RatingMeter'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import CastCrew from '../components/CastCrew'
import TrailerModal from '../components/TrailerModal'
import ProductionTags from '../components/ProductionTags'
import ShinyText from '../components/ShinyText'
import SaveToCollectionModal from '../components/SaveToCollectionModal'
import { pageCache } from '../utils/pageCache'
import { watchlistService } from '../services/watchlistService'
import { planToWatchService } from '../services/planToWatchService'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import MovieRow from '../components/MovieRow'
import './MovieDetail.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

const formatUSD = (val) => {
  if (!val) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
};

const formatINR = (val) => {
  if (!val) return 'N/A';
  const inrVal = val * 83.5;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(inrVal);
};

export default function MovieDetail() {
  const { id } = useParams()
  const movieId = Number(id)
  const { isLoggedIn } = useAuth()
  const location = useLocation()
  const passedMovie = location.state?.movie

  const cacheKey = `movie-detail-${movieId}`
  const cachedData = pageCache.get(cacheKey)

  const [movie,         setMovie]         = useState(() => {
    if (cachedData?.movie) return cachedData.movie
    if (passedMovie) {
      return {
        id: passedMovie.id,
        title: passedMovie.title || passedMovie.name,
        poster_path: passedMovie.poster_path,
        backdrop_path: passedMovie.backdrop_path,
        release_year: passedMovie.release_year,
        release_date: passedMovie.release_date,
        vote_average: passedMovie.vote_average,
        media_type: passedMovie.media_type || 'movie'
      }
    }
    return null
  })
  const [similar,       setSimilar]       = useState(cachedData?.similar || [])
  const [watchStatus,   setWatchStatus]   = useState(cachedData?.watchStatus || { watched: false, watchlisted: false })
  const [loading,       setLoading]       = useState(!cachedData?.movie)
  const [similarLoading,setSimilarLoading]= useState(!cachedData?.similar)
  const [error,         setError]         = useState(null)
  const [hasImgError,   setHasImgError]   = useState(false)
  const [watchBusy,     setWatchBusy]     = useState(false)
  const [listBusy,      setListBusy]      = useState(false)
  const [watchMsg,      setWatchMsg]      = useState(null)
  const [isModalOpen,   setIsModalOpen]   = useState(false)
  const [reqNeededState, setReqNeededState] = useState({ loading: false, success: false })
  
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [isInAnyCollection, setIsInAnyCollection] = useState(false)
  
  const [planToWatch, setPlanToWatch] = useState(false)
  const [planToWatchId, setPlanToWatchId] = useState(null)
  const [planBusy, setPlanBusy] = useState(false)
  
  const [videosData,    setVideosData]    = useState(cachedData?.videosData || null)
  const [isTrailerModalOpen, setIsTrailerModalOpen] = useState(false)

  const [showRatingMeter, setShowRatingMeter] = useState(false)
  const [posterLoaded, setPosterLoaded] = useState(false)
  const posterRef = useRef(null)

  useEffect(() => {
    setPosterLoaded(false)
    setShowRatingMeter(false)
  }, [movieId])

  useEffect(() => {
    if (posterRef.current && posterRef.current.complete) {
      setPosterLoaded(true)
    }
  }, [movie])

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        setShowRatingMeter(true)
      }, 200)
      return () => clearTimeout(timer)
    } else {
      setShowRatingMeter(false)
    }
  }, [loading])

  const handleRequestRating = async () => {
    if (!movie || reqNeededState.loading || reqNeededState.success) return
    setReqNeededState({ loading: true, success: false })
    try {
      await ratingService.requestRatingNeeded(
        movieId,
        movie.title,
        'movie',
        movie.release_year
      )
      setReqNeededState({ loading: false, success: true })
    } catch (err) {
      setReqNeededState({ loading: false, success: false })
    }
  }

  // ── Fetch movie detail ───────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!cachedData?.movie) {
      setLoading(true)
    }
    setError(null)
    setHasImgError(false)

    movieService.getMovieById(movieId)
      .then((data) => {
        if (!cancelled) {
          setMovie(data)
          const curr = pageCache.get(cacheKey) || {}
          pageCache.set(cacheKey, { ...curr, movie: data })
        }
      })
      .catch(() => { if (!cancelled && (!movie || !movie.overview)) setError('Failed to load movie') })
      .finally(() => { if (!cancelled) setLoading(false) })
      
    movieService.getVideos(movieId)
      .then((data) => {
        if (!cancelled) {
          setVideosData(data)
          const curr = pageCache.get(cacheKey) || {}
          pageCache.set(cacheKey, { ...curr, videosData: data })
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [movieId])

  // ── Fetch similar movies ─────────────────────────────
  useEffect(() => {
    // Wait for the main movie detail to load before fetching recommendations
    if (!movie) return

    let cancelled = false
    if (similar.length === 0) {
      setSimilarLoading(true)
    }

    import('../utils/api').then(({ default: api }) =>
      api.get(`/api/v1/recommendations/similar/${movieId}`)
        .then((r) => {
          const similarData = r.data?.movies || r.data || []
          if (!cancelled) {
            setSimilar(similarData)
            const curr = pageCache.get(cacheKey) || {}
            pageCache.set(cacheKey, { ...curr, similar: similarData })
          }
        })
        .catch(() => { if (!cancelled) setSimilar([]) })
        .finally(() => { if (!cancelled) setSimilarLoading(false) })
    )

    return () => { cancelled = true }
  }, [movieId, movie])

  // ── Fetch watch status (auth-gated) ─────────────────
  const fetchStatus = useCallback(() => {
    if (!isLoggedIn) return
    watchService.getStatus(movieId)
      .then((status) => {
        setWatchStatus(status)
        const curr = pageCache.get(cacheKey) || {}
        pageCache.set(cacheKey, { ...curr, watchStatus: status })
      })
      .catch(() => {})

    watchlistService.getMovieStatus(movieId)
      .then(res => {
        const inAny = res.collections?.some(c => c.has_movie)
        setIsInAnyCollection(inAny)
      })
      .catch(() => {})

    planToWatchService.checkStatus(movieId)
      .then(({ inList, listId }) => {
        setPlanToWatch(inList)
        setPlanToWatchId(listId)
      })
      .catch(() => {})
  }, [movieId, isLoggedIn])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ── Toggle Plan to Watch ─────────────────────────────
  const handlePlanToWatch = async () => {
    if (!isLoggedIn || planBusy) return
    setPlanBusy(true)
    try {
      if (planToWatch) {
        await planToWatchService.remove(planToWatchId, movieId)
        setPlanToWatch(false)
        setWatchMsg('Removed from Plan to Watch')
      } else {
        const { listId } = await planToWatchService.add(movieId)
        setPlanToWatchId(listId)
        setPlanToWatch(true)
        setWatchMsg('Added to Plan to Watch!')
      }
      setTimeout(() => setWatchMsg(null), 2500)
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setPlanBusy(false)
    }
  }

  // ── Toggle watched ───────────────────────────────────
  const handleWatchedToggle = async () => {
    if (!isLoggedIn || watchBusy) return
    setWatchBusy(true)
    try {
      if (watchStatus.watched) {
        if (watchStatus.rating_id) {
          await ratingService.deleteRating(watchStatus.rating_id)
        }
        await watchService.removeFromHistory(movieId)
        setWatchStatus((s) => ({ ...s, watched: false, user_rating: null, rating_id: null }))
        setWatchMsg('Removed from watch history')
        setTimeout(() => setWatchMsg(null), 2500)
      } else {
        await watchService.markWatched(movieId)
        setWatchStatus((s) => ({ ...s, watched: true }))
        setWatchMsg('Added to watch history!')
        if (planToWatch) {
          try {
            await planToWatchService.remove(planToWatchId, movieId)
            setPlanToWatch(false)
            setPlanToWatchId(null)
          } catch (err) {
            console.error("Failed to automatically remove from Plan to Watch:", err)
          }
        }
        setTimeout(() => setWatchMsg(null), 2500)
      }
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setWatchBusy(false)
    }
  }



  // ── Render: loading without metadata ──────────────────
  if (loading && !movie) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="movie-detail__top animate-fade-lift">
            <div className="movie-detail__poster-col">
              <div className="skeleton" style={{ width: 240, height: 360, borderRadius: 16 }} />
            </div>
            <div className="movie-detail__info-col" style={{ gap: 16 }}>
              <div className="skeleton" style={{ height: 40, width: '60%', borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 20, width: '40%', borderRadius: 8 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
                <div className="skeleton" style={{ height: 16, width: '100%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '95%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '60%', borderRadius: 4 }} />
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ── Render: error ────────────────────────────────────
  if (error || !movie) {
    return (
      <main className="movie-detail page-content">
        <div className="container" style={{ paddingTop: 80 }}>
          <div className="error-state">
            <h2>Movie not found</h2>
            <p>{error || 'This movie does not exist.'}</p>
            <Link to="/movies" className="btn btn--ghost btn--md" style={{ marginTop: 16, display: 'inline-block' }}>
              ← Back to Movies
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const posterUrl  = movie.poster_path   ? `${TMDB_IMAGE_BASE}/w300${movie.poster_path}`   : null
  const backdropUrl = movie.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${movie.backdrop_path}` : null
  const genres     = movie.genres || []
  const directors  = movie.directors || []

  return (
    <main className="movie-detail page-content">
      {/* ── Backdrop ── */}
      {backdropUrl && (
        <div className="movie-detail__backdrop-container">
          <div
            className="movie-detail__backdrop"
            style={{ backgroundImage: `url(${backdropUrl})` }}
            aria-hidden="true"
          />
        </div>
      )}
      <div className="movie-detail__backdrop-overlay" aria-hidden="true" />

      <div className="container">
        {/* ── Top: poster + info ── */}
        <div className="movie-detail__top">
          {/* Poster */}
          <div className="movie-detail__poster-col">
            {posterUrl && !hasImgError ? (
              <img
                ref={posterRef}
                src={posterUrl}
                alt={`${movie.title} poster`}
                className={`movie-detail__poster clickable-poster poster-progressive ${posterLoaded ? 'poster-progressive--loaded' : ''}`}
                onClick={() => setIsModalOpen(true)}
                onLoad={() => setPosterLoaded(true)}
                onError={() => setHasImgError(true)}
              />
            ) : (
              <div className="movie-detail__poster-fallback">{movie.title}</div>
            )}
          </div>

          {/* Info */}
          <div className="movie-detail__info-col animate-fade-lift">
            <h1 className="movie-detail__title">{movie.title}</h1>

            {/* Meta */}
            <div className="movie-detail__meta">
              {movie.release_date && (
                <span>{new Date(movie.release_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              )}
              {loading ? (
                <>
                  <span className="dot">·</span>
                  <span className="skeleton" style={{ display: 'inline-block', width: 60, height: 16, borderRadius: 4 }} />
                </>
              ) : movie.runtime && (
                <>
                  <span className="dot">·</span>
                  <span>{movie.runtime} min</span>
                </>
              )}
              {movie.vote_average > 0 && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating">★ {movie.vote_average.toFixed(1)}</span>
                </>
              )}
            </div>

            {/* Genres */}
            {loading ? (
              <div className="movie-detail__genres" style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
                <span className="skeleton" style={{ width: 60, height: 24, borderRadius: 12 }} />
                <span className="skeleton" style={{ width: 80, height: 24, borderRadius: 12 }} />
                <span className="skeleton" style={{ width: 70, height: 24, borderRadius: 12 }} />
              </div>
            ) : genres.length > 0 && (
              <div className="movie-detail__genres">
                {genres.map((g) => (
                  <Link
                    key={g}
                    to={`/search?genre=${encodeURIComponent(g)}`}
                    className="genre-tag genre-tag--link"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}

            {/* Director */}
            {loading ? (
              <div className="skeleton" style={{ height: 20, width: '30%', borderRadius: 6, margin: '8px 0' }} />
            ) : directors.length > 0 && (
              <p className="movie-detail__director">
                <span className="label">Directed by</span>{' '}
                {directors.map((d, idx) => (
                  <span key={d.id}>
                    <Link to={`/person/${d.id}`} className="director-link">{d.name}</Link>
                    {idx < directors.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            )}

            {/* Overview */}
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0 24px 0' }}>
                <div className="skeleton" style={{ height: 16, width: '100%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '95%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '60%', borderRadius: 4 }} />
              </div>
            ) : movie.overview && (
              <p className="movie-detail__overview">{movie.overview}</p>
            )}

            {/* Actions & Financials Container */}
            <div className="movie-detail__actions-row">
              {/* Actions */}
              <div className="movie-detail__actions">
                {isLoggedIn ? (
                  <>
                    <button
                      id={`btn-watched-${movieId}`}
                      className={`btn btn--md ${watchStatus.watched ? 'btn--success' : 'btn--secondary'}`}
                      onClick={handleWatchedToggle}
                      disabled={watchBusy}
                      aria-label={watchStatus.watched ? 'Remove from watched' : 'Mark as watched'}
                    >
                      {watchStatus.watched ? '✓ Watched' : '○ Mark Watched'}
                    </button>
                    {!watchStatus.watched && (
                      <button
                        id={`btn-plantowatch-${movieId}`}
                        className={`btn btn--md ${planToWatch ? 'btn--accent' : 'btn--secondary'}`}
                        onClick={handlePlanToWatch}
                        disabled={planBusy}
                        aria-label={planToWatch ? 'Remove from Plan to Watch' : 'Plan to Watch'}
                      >
                        {planToWatch ? '✓ Plan to Watch' : '+ Plan to Watch'}
                      </button>
                    )}
                    <button
                      id={`btn-watchlist-${movieId}`}
                      className={`btn btn--md ${isInAnyCollection ? 'btn--accent' : 'btn--secondary'}`}
                      onClick={() => setShowCollectionModal(true)}
                      aria-label={isInAnyCollection ? 'Manage in watchlists' : 'Add to watchlist'}
                    >
                      {isInAnyCollection ? '★ Watchlist' : '+ Watchlist'}
                    </button>
                    <button
                      className="btn btn--secondary btn--md btn--trailer"
                      onClick={() => setIsTrailerModalOpen(true)}
                      aria-label="Play Trailer"
                    >
                      ▶ Trailer
                    </button>
                  </>
                ) : (
                  <>
                    <Link to="/login" className="btn btn--secondary btn--md">
                      + Watchlist
                    </Link>
                    <Link to="/login" className="btn btn--secondary btn--md">
                      ○ Mark Watched
                    </Link>
                    <button
                      className="btn btn--secondary btn--md btn--trailer"
                      onClick={() => setIsTrailerModalOpen(true)}
                      aria-label="Play Trailer"
                    >
                      ▶ Trailer
                    </button>
                  </>
                )}
              </div>

              {/* Financial Information (Budget & Revenue) */}
              {(movie.budget > 0 || movie.revenue > 0) && (
                <div className="movie-detail__financials">
                  {movie.budget > 0 && (
                    <div className="financial-item">
                      <span className="financial-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', opacity: 0.7 }}>
                          <line x1="12" y1="1" x2="12" y2="23"></line>
                          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        Budget
                      </span>
                      <span className="financial-value">
                        <span className="usd-val">{formatUSD(movie.budget)}</span>
                        <span className="inr-val"> ({formatINR(movie.budget)})</span>
                      </span>
                    </div>
                  )}
                  {movie.revenue > 0 && (
                    <div className="financial-item">
                      <span className="financial-label">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px', opacity: 0.7 }}>
                          <line x1="12" y1="1" x2="12" y2="23"></line>
                          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                        </svg>
                        Revenue
                      </span>
                      <span className="financial-value">
                        <span className="usd-val">{formatUSD(movie.revenue)}</span>
                        <span className="inr-val"> ({formatINR(movie.revenue)})</span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Toast */}
            {watchMsg && (
              <p className="movie-detail__toast" aria-live="polite">{watchMsg}</p>
            )}
          </div>

          {/* Rating Sidebar */}
          <div className="movie-detail__rating-sidebar">
            {showRatingMeter ? (
              <div className="animate-rating-reveal">
                <RatingMeter
                  movieId={movieId}
                  onRated={fetchStatus}
                  onRatingRemoved={async () => {
                    await watchService.removeFromHistory(movieId)
                    setWatchStatus((s) => ({ ...s, watched: false, user_rating: null, rating_id: null }))
                  }}
                  userRating={watchStatus.user_rating}
                  userRatingId={watchStatus.rating_id}
                  {...(movie.moctale_rating || {})}
                />
              </div>
            ) : (
              <div className="skeleton rating-meter-skeleton" style={{ height: 280, borderRadius: 16 }} />
            )}
            {showRatingMeter && (!movie.moctale_rating || !movie.moctale_rating.total_votes) && (
              <div className="rating-needed-box animate-fade-lift">
                <p className="rating-needed-box__msg">Want to know rating?</p>
                <button
                  className={`rating-needed-box__btn ${reqNeededState.success ? 'rating-needed-box__btn--success' : ''}`}
                  onClick={handleRequestRating}
                  disabled={reqNeededState.loading || reqNeededState.success}
                >
                  {reqNeededState.success ? '✓ Requested' : reqNeededState.loading ? 'Requesting...' : 'Request Rating'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Cast & Crew ── */}
        <CastCrew movieId={movieId} />

        {/* ── Production Companies & Countries ── */}
        <ProductionTags
          productionCompanies={movie.production_companies || []}
          productionCountries={movie.production_countries || []}
        />
        {/* ── Similar Movies ── */}
        <div className="movie-detail__similar">
          <MovieRow
            title="More Like This"
            movies={similar}
            loading={similarLoading}
            seeAllHref="/movies"
            premiumScroll={true}
            showFeedback={true}
            emptyText="No similar movies found."
          />
        </div>
      </div>

      {/* Full screen modal */}
      {isModalOpen && posterUrl && (
        <div 
          className="person-page-image-modal" 
          onClick={() => setIsModalOpen(false)}
        >
          <button className="person-page-image-modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
          <img 
            src={movie.poster_path ? `${TMDB_IMAGE_BASE}/w780${movie.poster_path}` : posterUrl} 
            alt={movie.title} 
            className="person-page-image-modal-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Trailer Modal */}
      {videosData && (
        <TrailerModal
          isOpen={isTrailerModalOpen}
          onClose={() => setIsTrailerModalOpen(false)}
          data={videosData}
        />
      )}

      {/* Save to Collection Modal */}
      <SaveToCollectionModal
        movieId={movieId}
        isOpen={showCollectionModal}
        onClose={() => {
          setShowCollectionModal(false)
          fetchStatus()
        }}
      />
    </main>
  )
}
