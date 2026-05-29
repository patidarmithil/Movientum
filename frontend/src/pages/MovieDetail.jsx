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
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useCallback } from 'react'
import { movieService } from '../services/movieService'
import { watchService } from '../services/watchService'
import { useAuth } from '../context/AuthContext'
import MovieCard from '../components/MovieCard'
import RatingMeter from '../components/RatingMeter'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import CastCrew from '../components/CastCrew'
import './MovieDetail.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export default function MovieDetail() {
  const { id } = useParams()
  const movieId = Number(id)
  const { isLoggedIn } = useAuth()

  const [movie,         setMovie]         = useState(null)
  const [similar,       setSimilar]       = useState([])
  const [watchStatus,   setWatchStatus]   = useState({ watched: false, watchlisted: false })
  const [loading,       setLoading]       = useState(true)
  const [similarLoading,setSimilarLoading]= useState(true)
  const [error,         setError]         = useState(null)
  const [hasImgError,   setHasImgError]   = useState(false)
  const [watchBusy,     setWatchBusy]     = useState(false)
  const [listBusy,      setListBusy]      = useState(false)
  const [watchMsg,      setWatchMsg]      = useState(null)

  // ── Fetch movie detail ───────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setHasImgError(false)

    movieService.getMovieById(movieId)
      .then((data) => { if (!cancelled) setMovie(data) })
      .catch(() => { if (!cancelled) setError('Failed to load movie') })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [movieId])

  // ── Fetch similar movies ─────────────────────────────
  useEffect(() => {
    let cancelled = false
    setSimilarLoading(true)

    import('../utils/api').then(({ default: api }) =>
      api.get(`/api/v1/recommendations/similar/${movieId}`)
        .then((r) => { if (!cancelled) setSimilar(r.data?.movies || r.data || []) })
        .catch(() => { if (!cancelled) setSimilar([]) })
        .finally(() => { if (!cancelled) setSimilarLoading(false) })
    )

    return () => { cancelled = true }
  }, [movieId])

  // ── Fetch watch status (auth-gated) ─────────────────
  const fetchStatus = useCallback(() => {
    if (!isLoggedIn) return
    watchService.getStatus(movieId)
      .then(setWatchStatus)
      .catch(() => {})
  }, [movieId, isLoggedIn])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ── Toggle watched ───────────────────────────────────
  const handleWatchedToggle = async () => {
    if (!isLoggedIn || watchBusy) return
    setWatchBusy(true)
    try {
      if (watchStatus.watched) {
        await watchService.removeFromHistory(movieId)
        setWatchStatus((s) => ({ ...s, watched: false }))
        setWatchMsg('Removed from watch history')
        setTimeout(() => setWatchMsg(null), 2500)
      } else {
        await watchService.markWatched(movieId)
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
        await watchService.removeFromWatchlist(movieId)
        setWatchStatus((s) => ({ ...s, watchlisted: false }))
      } else {
        await watchService.addToWatchlist(movieId)
        setWatchStatus((s) => ({ ...s, watchlisted: true }))
      }
    } catch {
      /* silent fail */
    } finally {
      setListBusy(false)
    }
  }

  // ── Render: loading ──────────────────────────────────
  if (loading) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="movie-detail__top">
            <div className="movie-detail__poster-col">
              <div className="skeleton" style={{ width: 240, height: 360, borderRadius: 16 }} />
            </div>
            <div className="movie-detail__info-col" style={{ gap: 16 }}>
              <div className="skeleton" style={{ height: 40, width: '60%', borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 20, width: '40%', borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 80, width: '90%', borderRadius: 8 }} />
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
                alt={`${movie.title} poster`}
                className="movie-detail__poster"
                onError={() => setHasImgError(true)}
              />
            ) : (
              <div className="movie-detail__poster-fallback">{movie.title}</div>
            )}
          </div>

          {/* Info */}
          <div className="movie-detail__info-col">
            <h1 className="movie-detail__title">{movie.title}</h1>

            {/* Meta */}
            <div className="movie-detail__meta">
              {movie.release_year && <span>{movie.release_year}</span>}
              {movie.runtime && (
                <>
                  <span className="dot">·</span>
                  <span>{movie.runtime} min</span>
                </>
              )}
              {movie.vote_average > 0 && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating">★ {movie.vote_average}</span>
                </>
              )}
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

            {/* Director */}
            {directors.length > 0 && (
              <p className="movie-detail__director">
                <span className="label">Directed by</span>{' '}
                {directors.join(', ')}
              </p>
            )}

            {/* Overview */}
            {movie.overview && (
              <p className="movie-detail__overview">{movie.overview}</p>
            )}

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
                  <button
                    id={`btn-watchlist-${movieId}`}
                    className={`btn btn--md ${watchStatus.watchlisted ? 'btn--accent' : 'btn--secondary'}`}
                    onClick={handleWatchlistToggle}
                    disabled={listBusy}
                    aria-label={watchStatus.watchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                  >
                    {watchStatus.watchlisted ? '★ In Watchlist' : '+ Watchlist'}
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
                </>
              )}
            </div>

            {/* Toast */}
            {watchMsg && (
              <p className="movie-detail__toast" aria-live="polite">{watchMsg}</p>
            )}
          </div>

          {/* Rating Sidebar */}
          <div className="movie-detail__rating-sidebar">
            <RatingMeter
              movieId={movieId}
              onRated={fetchStatus}
            />
          </div>
        </div>

        {/* ── Cast & Crew ── */}
        <CastCrew movieId={movieId} />

        {/* ── Similar Movies ── */}
        <section className="movie-detail__similar">
          <div className="section-header">
            <h2>More Like This</h2>
            <Link to="/movies">See all →</Link>
          </div>
          <div className="scroll-row">
            {similarLoading
              ? <MovieCardSkeleton count={6} />
              : similar.length > 0
                ? similar.map((m) => <MovieCard key={m.id} movie={m} />)
                : <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No similar movies found.</p>
            }
          </div>
        </section>
      </div>
    </main>
  )
}
