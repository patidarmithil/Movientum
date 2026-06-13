/**
 * TVDetail.jsx — Improvement 1.7
 *
 * Route: /tv/:id
 * Endpoint: GET /api/v1/tv/{id}  +  GET /api/v1/tv/{id}/credits
 *
 * Layout identical to MovieDetail but adapted for TV data:
 *  - Seasons / Episodes counts instead of runtime
 *  - Created by instead of Directed by
 *  - Network badge
 *  - No similar-movies row (TV similarity out of scope for 1.7)
 */
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import api from '../utils/api'
import { watchService } from '../services/watchService'
import { ratingService } from '../services/ratingService'
import { useAuth } from '../context/AuthContext'
import CastCrew from '../components/CastCrew'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import RatingMeter from '../components/RatingMeter'
import ProductionTags from '../components/ProductionTags'
import TrailerModal from '../components/TrailerModal'
import ShinyText from '../components/ShinyText'
import './MovieDetail.css'   // reuse same layout CSS

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export default function TVDetail() {
  const { id } = useParams()
  const tvId = Number(id)
  const { isLoggedIn } = useAuth()

  const [show,       setShow]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [hasImgError, setHasImgError] = useState(false)
  const [similar,       setSimilar]       = useState([])
  const [similarLoading, setSimilarLoading] = useState(true)

  const [watchStatus,   setWatchStatus]   = useState({ watched: false, watchlisted: false })
  const [watchBusy,     setWatchBusy]     = useState(false)
  const [listBusy,      setListBusy]      = useState(false)
  const [watchMsg,      setWatchMsg]      = useState(null)
  const [isModalOpen,   setIsModalOpen]   = useState(false)
  const [reqNeededState, setReqNeededState] = useState({ loading: false, success: false })

  const [videosData,    setVideosData]    = useState(null)
  const [isTrailerModalOpen, setIsTrailerModalOpen] = useState(false)

  const handleRequestRating = async () => {
    if (!show || reqNeededState.loading || reqNeededState.success) return
    setReqNeededState({ loading: true, success: false })
    try {
      await ratingService.requestRatingNeeded(
        tvId,
        show.title,
        'show',
        show.release_year
      )
      setReqNeededState({ loading: false, success: true })
    } catch (err) {
      setReqNeededState({ loading: false, success: false })
    }
  }

  // ── Fetch TV detail ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setHasImgError(false)

    api.get(`/api/v1/tv/${tvId}`)
      .then((r) => { if (!cancelled) setShow(r.data) })
      .catch(() => { if (!cancelled) setError('Failed to load TV show') })
      .finally(() => { if (!cancelled) setLoading(false) })
      
    api.get(`/api/v1/tv/${tvId}/videos`)
      .then((r) => { if (!cancelled) setVideosData(r.data) })
      .catch(() => {})

    api.get(`/api/v1/recommendations/similar/${tvId}?media_type=tv`)
      .then((r) => {
        if (!cancelled) setSimilar(r.data.movies || [])
      })
      .catch(() => {
        if (!cancelled) setSimilar([])
      })
      .finally(() => {
        if (!cancelled) setSimilarLoading(false)
      })

    return () => { cancelled = true }
  }, [tvId])

  // ── Fetch watch status (auth-gated) ─────────────────
  const fetchStatus = useCallback(() => {
    if (!isLoggedIn) return
    watchService.getStatus(tvId)
      .then(setWatchStatus)
      .catch(() => {})
  }, [tvId, isLoggedIn])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ── Toggle watched ───────────────────────────────────
  const handleWatchedToggle = async () => {
    if (!isLoggedIn || watchBusy) return
    setWatchBusy(true)
    try {
      if (watchStatus.watched) {
        await watchService.removeFromHistory(tvId)
        setWatchStatus((s) => ({ ...s, watched: false }))
        setWatchMsg('Removed from watch history')
        setTimeout(() => setWatchMsg(null), 2500)
      } else {
        await watchService.markWatched(tvId)
        setWatchStatus((s) => ({ ...s, watched: true }))
        setWatchMsg('Added to watch history!')
        setTimeout(() => setWatchMsg(null), 2500)
      }
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setWatchBusy(false)
    }
  }

  // ── Watchlist toggle ─────────────────────────────────
  const handleWatchlistToggle = async () => {
    if (!isLoggedIn || listBusy) return
    setListBusy(true)
    try {
      if (watchStatus.watchlisted) {
        await watchService.removeFromWatchlist(tvId)
        setWatchStatus((s) => ({ ...s, watchlisted: false }))
      } else {
        await watchService.addToWatchlist(tvId)
        setWatchStatus((s) => ({ ...s, watchlisted: true }))
      }
    } catch {
      /* silent fail */
    } finally {
      setListBusy(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="movie-detail__top skeleton" style={{ height: 400, borderRadius: 16 }} />
        </div>
      </main>
    )
  }

  // ── Error ────────────────────────────────────────────────────
  if (error || !show) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="empty-state">
            <h2>TV show not found</h2>
            <Link to="/" className="btn btn--secondary btn--md" style={{ marginTop: 16 }}>← Home</Link>
          </div>
        </div>
      </main>
    )
  }

  const posterUrl  = show.poster_path   ? `${TMDB_IMAGE_BASE}/w300${show.poster_path}`   : null
  const backdropUrl = show.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${show.backdrop_path}` : null
  const genres     = show.genres || []
  const createdBy  = show.created_by || []
  const networks   = show.networks || []
  const productionCompanies = show.production_companies || []
  const productionCountries = show.production_countries || []

  return (
    <main className="movie-detail page-content">
      {/* ── Backdrop ── */}
      {backdropUrl && (
        <div
          className="movie-detail__backdrop"
          style={{ backgroundImage: `url(${backdropUrl})` }}
          aria-hidden="true"
        />
      )}
      <div className="movie-detail__backdrop-overlay" aria-hidden="true" />

      <div className="container">
        {/* ── Top: poster + info ── */}
        <div className="movie-detail__top">
          {/* Poster */}
          <div className="movie-detail__poster-col">
            {posterUrl && !hasImgError ? (
              <img
                src={posterUrl}
                alt={`${show.title} poster`}
                className="movie-detail__poster clickable-poster"
                onClick={() => setIsModalOpen(true)}
                onError={() => setHasImgError(true)}
              />
            ) : (
              <div className="movie-detail__poster-placeholder">
                <span>📺</span>
              </div>
            )}
          </div>

          {/* Info column */}
          <div className="movie-detail__info">
            {/* Title */}
            <h1 className="movie-detail__title">{show.title}</h1>

            {/* Meta row */}
            <div className="movie-detail__meta">
              {show.release_year && <span>{show.release_year}</span>}
              {show.number_of_seasons != null && (
                <>
                  <span className="dot">·</span>
                  <span>{show.number_of_seasons} Season{show.number_of_seasons !== 1 ? 's' : ''}</span>
                </>
              )}
              {show.number_of_episodes != null && (
                <>
                  <span className="dot">·</span>
                  <span>{show.number_of_episodes} Episodes</span>
                </>
              )}
              {show.vote_average > 0 && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating">★ {show.vote_average.toFixed(1)}</span>
                </>
              )}
              {show.status && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating" style={{ color: show.status === 'Ended' ? 'var(--text-muted)' : 'var(--success)' }}>
                    {show.status}
                  </span>
                </>
              )}
            </div>

            {/* TV badge */}
            <div style={{ marginBottom: 8 }}>
              <span className="genre-tag" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>📺 TV Series</span>
              {networks.slice(0, 2).map((n) => (
                <span key={n} className="genre-tag" style={{ marginLeft: 6 }}>{n}</span>
              ))}
            </div>

            {/* Genres */}
            {genres.length > 0 && (
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

            {/* Created by */}
            {createdBy.length > 0 && (
              <p className="movie-detail__director">
                <span className="label">Created by</span>{' '}
                {createdBy.map((c, idx) => (
                  <span key={c.id}>
                    <Link to={`/person/${c.id}`} className="director-link">{c.name}</Link>
                    {idx < createdBy.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            )}

            {/* Overview */}
            {show.overview && (
              <p className="movie-detail__overview">{show.overview}</p>
            )}

            {/* Actions */}
            <div className="movie-detail__actions">
              {isLoggedIn ? (
                <>
                  <button
                    id={`btn-watched-${tvId}`}
                    className={`btn btn--md ${watchStatus.watched ? 'btn--success' : 'btn--secondary'}`}
                    onClick={handleWatchedToggle}
                    disabled={watchBusy}
                    aria-label={watchStatus.watched ? 'Remove from watched' : 'Mark as watched'}
                  >
                    {watchStatus.watched ? '✓ Watched' : '○ Mark Watched'}
                  </button>
                  <button
                    id={`btn-watchlist-${tvId}`}
                    className={`btn btn--md ${watchStatus.watchlisted ? 'btn--accent' : 'btn--secondary'}`}
                    onClick={handleWatchlistToggle}
                    disabled={listBusy}
                    aria-label={watchStatus.watchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    {watchStatus.watchlisted ? '★ In Watchlist' : '+ Watchlist'}
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

            {/* Toast */}
            {watchMsg && (
              <p className="movie-detail__toast" aria-live="polite">{watchMsg}</p>
            )}

            {/* Seasons Details Card */}
            {show.seasons && show.seasons.length > 0 && (
              <div className="tv-detail__seasons">
                <h4 className="tv-detail__seasons-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px', opacity: 0.8, verticalAlign: 'middle' }}>
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
                    <polyline points="17 2 12 7 7 2"></polyline>
                  </svg>
                  Season Details
                </h4>
                <div className="tv-detail__seasons-list">
                  {show.seasons.map((s, idx) => (
                    <div key={s.id} className="tv-season-item">
                      <span className="tv-season-name">{idx + 1}) {s.name}</span>
                      <span className="tv-season-info">
                        <span className="tv-season-episodes">{s.episode_count} Episodes</span>
                        {s.air_date && (
                          <>
                            <span className="dot">·</span>
                            <span className="tv-season-date">Aired: {new Date(s.air_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</span>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {show.next_episode_to_air && (
                  <div className="tv-detail__upcoming">
                    <span className="tv-upcoming-badge">Upcoming</span>
                    <span className="tv-upcoming-info">
                      S{show.next_episode_to_air.season_number}E{show.next_episode_to_air.episode_number} - {show.next_episode_to_air.name || 'TBA'}
                      {show.next_episode_to_air.air_date && (
                        <span className="tv-upcoming-date"> ({new Date(show.next_episode_to_air.air_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })})</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rating Sidebar */}
          <div className="movie-detail__rating-sidebar">
            <RatingMeter
              movieId={tvId}
              onRated={fetchStatus}
              userRating={watchStatus.user_rating}
              {...(show.moctale_rating || {})}
            />
            {(!show.moctale_rating || !show.moctale_rating.total_votes) && (
              <div className="rating-needed-box">
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

        {/* ── Cast & Crew (reuse CastCrew with tvId flag) ── */}
        <CastCrew movieId={tvId} isTV />

        {/* ── Production Companies & Countries ── */}
        <ProductionTags
          productionCompanies={productionCompanies}
          productionCountries={productionCountries}
        />
        {/* ── Similar Items ── */}
        <section className="movie-detail__similar">
          <div className="section-header">
            <h2>
              <ShinyText text="More Like This" />
            </h2>
            <Link to="/explore">See all →</Link>
          </div>
          <div className="scroll-row-container">
            <div className="scroll-row-fade left-fade" />
            <div className="scroll-row">
              {similarLoading
                ? <MovieCardSkeleton count={6} />
                : similar.length > 0
                  ? similar.map((m) => <MovieCard key={m.id} movie={m} />)
                  : <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No similar titles found.</p>
              }
            </div>
            <div className="scroll-row-fade right-fade" />
          </div>
        </section>
      </div>

      {/* Full screen modal */}
      {isModalOpen && posterUrl && (
        <div 
          className="person-page-image-modal" 
          onClick={() => setIsModalOpen(false)}
        >
          <button className="person-page-image-modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
          <img 
            src={show.poster_path ? `${TMDB_IMAGE_BASE}/w780${show.poster_path}` : posterUrl} 
            alt={show.title} 
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
          seasons={show?.seasons}
          tvId={tvId}
        />
      )}
    </main>
  )
}
