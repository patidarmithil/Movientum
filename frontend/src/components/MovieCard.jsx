const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
import { useNavigate, Link } from 'react-router-dom'
import React, { useState, useRef, useEffect, useCallback, memo } from 'react'
import BorderGlow from './BorderGlow'
import { recFeedback } from '../services/feedbackService'
import './MovieCard.css'

const MOCTALE_COLORS = {
  perfection: '#A855F7',
  go_for_it:  '#22C55E',
  timepass:   '#EAB308',
  skip:       '#EF4444',
}
const MOCTALE_SYMBOLS = {
  perfection: '★',
  go_for_it:  '✓',
  timepass:   '~',
  skip:       '✗',
}

/**
 * MovieCard — most reusable component in Phase 2.
 *
 * Props:
 *   movie:        { id, title, poster_path, release_year, genres, vote_average, media_type? }
 *   variant?:     'standard' | 'compact' | 'featured'  (default: 'standard')
 *   showFeedback?: boolean — render thumbs-up/down overlay and track scroll-ignore
 *                  Pass true only from authenticated recommendation carousels.
 */
const MovieCard = memo(function MovieCard({ movie, variant = 'standard', ratingCategory, showFeedback = false }) {
  const navigate = useNavigate()
  const [hasError, setHasError]               = useState(false)
  const [imageLoaded, setImageLoaded]         = useState(false)
  const [feedbackSent, setFeedbackSent]       = useState(null)  // null | 'up' | 'down'
  const [isVisible, setIsVisible]             = useState(false)
  const cardRef                               = useRef(null)
  const impressionLogged                      = useRef(false)

  const isTV     = movie.media_type === 'tv'
  const tmdbId   = movie.tmdb_id ?? movie.id
  const mediaType = movie.media_type || 'movie'

  const posterUrl = movie.poster_path
    ? `${TMDB_IMAGE_BASE}/w342${movie.poster_path}`
    : null

  // Route TV shows to /tv/:id, movies to /movies/:id
  const handleClick = useCallback(() => {
    // Fire click signal before navigating (non-blocking)
    if (showFeedback && tmdbId) {
      recFeedback.click(tmdbId, mediaType)
    }
    navigate(isTV ? `/tv/${movie.id}` : `/movies/${movie.id}`)
  }, [isTV, movie.id, showFeedback, tmdbId, mediaType, navigate])

  // ── Card Reveal entry animation via IntersectionObserver ─────────
  useEffect(() => {
    const parentEl = cardRef.current
    if (!parentEl) return

    const targetEl = parentEl.querySelector('.movie-card')
    if (!targetEl) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px 100px 0px' }
    )

    observer.observe(targetEl)
    return () => observer.disconnect()
  }, [])

  // ── Implicit ignore detection via IntersectionObserver ──────────
  useEffect(() => {
    const parentEl = cardRef.current
    if (!showFeedback || !parentEl || !tmdbId) return

    const targetEl = parentEl.querySelector('.movie-card')
    if (!targetEl) return

    const timeout = { id: null }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // Card visible for 2 s without interaction → log "ignore"
          timeout.id = setTimeout(() => {
            if (!impressionLogged.current) {
              impressionLogged.current = true
              recFeedback.ignore(tmdbId, mediaType)
            }
          }, 2000)
        } else {
          clearTimeout(timeout.id)
        }
      },
      { threshold: 0.5 }
    )

    observer.observe(targetEl)
    return () => {
      observer.disconnect()
      clearTimeout(timeout.id)
    }
  }, [tmdbId, mediaType, showFeedback])

  // ── Explicit feedback ─────────────────────────────────────────
  const sendExplicit = useCallback((signalType, e) => {
    e.stopPropagation()   // don't trigger card click / navigation
    e.preventDefault()    // don't trigger link navigation
    impressionLogged.current = true  // cancel pending ignore timer

    if (signalType === 'thumbs_up') {
      recFeedback.thumbsUp(tmdbId, mediaType)
      setFeedbackSent('up')
    } else {
      recFeedback.thumbsDown(tmdbId, mediaType)
      setFeedbackSent('down')
    }
  }, [tmdbId, mediaType])

  const handleLinkClick = useCallback(() => {
    // Fire click signal (non-blocking)
    if (showFeedback && tmdbId) {
      recFeedback.click(tmdbId, mediaType)
    }
  }, [showFeedback, tmdbId, mediaType])

  const ratingColor =
    movie.vote_average >= 8 ? '#22C55E' :
    movie.vote_average >= 6 ? '#FFC300' : '#EF4444'

  const mr = movie.moctale_rating
  const hasMoctale = mr && mr.dominant_category && mr.total_votes > 10

  const targetPath = isTV ? `/tv/${movie.id}` : `/movies/${movie.id}`

  return (
    <div ref={cardRef} style={{ display: 'contents' }}>
      <Link
        to={targetPath}
        state={{ movie }}
        onClick={handleLinkClick}
        style={{ textDecoration: 'none', display: 'contents', color: 'inherit' }}
        aria-label={`${movie.title} (${movie.release_year})`}
      >
        <BorderGlow
          className={`movie-card movie-card--${variant} ${isVisible ? 'visible' : ''}`}
          tabIndex={0}
          borderRadius={12}
          glowRadius={30}
          glowIntensity={0.85}
          colors={['#B048FF', '#00E5A0', '#FF4D6D']}
          backgroundColor="#1B1B1B"
        >
          <div className="movie-card__poster-wrap">
            {posterUrl && !hasError ? (
              <img
                src={posterUrl}
                alt={`${movie.title} poster`}
                className={`movie-card__poster poster-progressive ${imageLoaded ? 'poster-progressive--loaded' : ''}`}
                loading="lazy"
                onLoad={() => setImageLoaded(true)}
                onError={() => setHasError(true)}
              />
            ) : (
              <div className="movie-card__poster-fallback">
                <span>{movie.title}</span>
              </div>
            )}

            {/* Premium bottom glow overlay */}
            {ratingCategory && (
              <div className={`movie-card__glow movie-card__glow--${ratingCategory}`} />
            )}

            {/* Rating badge — Our logo badge preferred over TMDB */}
            {hasMoctale ? (
              <div
                className="movie-card__rating movie-card__rating--moctale"
                style={{ color: MOCTALE_COLORS[mr.dominant_category], flexDirection: 'row', gap: '4px' }}
              >
                <span>{MOCTALE_SYMBOLS[mr.dominant_category]}</span>
                <span className="movie-card__rating-pct">{Math.round(mr.dominant_pct)}%</span>
              </div>
            ) : movie.vote_average > 0 ? (
              <div className="movie-card__rating" style={{ color: ratingColor }}>
                {movie.vote_average.toFixed(1)}
              </div>
            ) : null}

            {/* TV badge */}
            {isTV && (
              <div className="movie-card__tv-badge">TV</div>
            )}

            {/* Phase 6: Thumbs feedback overlay — authenticated recs carousels only */}
            {showFeedback && (
              <div className="movie-card__feedback-overlay" aria-label="Rate this recommendation">
                <button
                  id={`thumbs-up-${tmdbId}`}
                  className={`movie-card__feedback-btn movie-card__feedback-btn--up${feedbackSent === 'up' ? ' is-active' : ''}`}
                  onClick={(e) => sendExplicit('thumbs_up', e)}
                  aria-label="Like this recommendation"
                  title="Like"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
                  </svg>
                </button>
                <button
                  id={`thumbs-down-${tmdbId}`}
                  className={`movie-card__feedback-btn movie-card__feedback-btn--down${feedbackSent === 'down' ? ' is-active' : ''}`}
                  onClick={(e) => sendExplicit('thumbs_down', e)}
                  aria-label="Not for me"
                  title="Not for me"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm12-3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
                  </svg>
                </button>
              </div>
            )}
          </div>

          <div className="movie-card__info">
            <h3 className="movie-card__title">{movie.title}</h3>
            <p className="movie-card__meta">
              <span className="movie-card__year">{movie.release_year}</span>
              {movie.genres?.[0] && (
                <>
                  <span className="movie-card__dot">·</span>
                  <span className="movie-card__genre">{movie.genres[0]}</span>
                </>
              )}
            </p>
          </div>
        </BorderGlow>
      </Link>
    </div>
  )
})

export default MovieCard
