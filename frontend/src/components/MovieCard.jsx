const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
import { useNavigate, Link } from 'react-router-dom'
import React, { useState, useRef, useEffect, useCallback, memo } from 'react'
import BorderGlow from './BorderGlow'
import { recFeedback } from '../services/feedbackService'
import { observeOnce } from '../utils/sharedObserver'
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
 *   feedbackSource?: string — which carousel this is, for interaction_log tagging:
 *                  "more_like_this" | "for_you" | "other" (default). Only matters
 *                  when showFeedback is true.
 *   dateBadge?:   string — optional text to show in a badge at the top right (e.g. "17 Jul")
 *   hideRating?:  boolean — optional flag to hide the rating
 */
const MovieCard = memo(function MovieCard({ movie, variant = 'standard', ratingCategory, showFeedback = false, feedbackSource = 'other', dateBadge = null, hideRating = false }) {
  const navigate = useNavigate()
  const [hasError, setHasError]               = useState(false)
  const [imageLoaded, setImageLoaded]         = useState(false)
  const [feedbackSent, setFeedbackSent]       = useState(null)  // null | 'up' | 'down'
  const [isVisible, setIsVisible]             = useState(false)
  const cardRef                               = useRef(null)
  const impressionLogged                      = useRef(false)
  const imageRef                              = useRef(null)

  useEffect(() => {
    if (imageRef.current && imageRef.current.complete) {
      setImageLoaded(true)
    }
  }, [movie])

  const isTV     = movie.media_type === 'tv'
  const tmdbId   = movie.tmdb_id ?? movie.id
  const mediaType = movie.media_type || 'movie'

  const posterUrl = movie.poster_path
    ? `${TMDB_IMAGE_BASE}/w342${movie.poster_path}`
    : null

  const handleClick = useCallback(() => {
    if (showFeedback && tmdbId) {
      recFeedback.click(tmdbId, mediaType, feedbackSource)
    }
    navigate(isTV ? `/tv/${movie.id}` : `/movies/${movie.id}`)
  }, [isTV, movie.id, showFeedback, tmdbId, mediaType, feedbackSource, navigate])

  useEffect(() => {
    const parentEl = cardRef.current
    if (!parentEl) return

    const targetEl = parentEl.querySelector('.movie-card')
    if (!targetEl) return

    return observeOnce(targetEl, () => setIsVisible(true))
  }, [])

  const sendExplicit = useCallback((signalType, e) => {
    e.stopPropagation()
    e.preventDefault()
    impressionLogged.current = true

    if (signalType === 'thumbs_up') {
      recFeedback.thumbsUp(tmdbId, mediaType, feedbackSource)
      setFeedbackSent('up')
    } else {
      recFeedback.thumbsDown(tmdbId, mediaType, feedbackSource)
      setFeedbackSent('down')
    }
  }, [tmdbId, mediaType, feedbackSource])

  const handleLinkClick = useCallback(() => {
    if (showFeedback && tmdbId) {
      recFeedback.click(tmdbId, mediaType, feedbackSource)
    }
  }, [showFeedback, tmdbId, mediaType, feedbackSource])

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
                ref={imageRef}
                src={posterUrl}
                alt={`${movie.title} poster`}
                className={`movie-card__poster poster-progressive ${imageLoaded ? 'poster-progressive--loaded' : ''}`}
                width={342}
                height={513}
                loading="lazy"
                decoding="async"
                onLoad={() => setImageLoaded(true)}
                onError={() => setHasError(true)}
              />
            ) : (
              <div className="movie-card__poster-fallback">
                <span>{movie.title}</span>
              </div>
            )}

            {ratingCategory && (
              <div className={`movie-card__glow movie-card__glow--${ratingCategory}`} />
            )}

            {dateBadge && (
              <div className="movie-card__date-badge" style={{
                position: 'absolute',
                top: '8px',
                left: '8px',
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: '#fff',
                padding: '4px 8px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                backdropFilter: 'blur(4px)',
                zIndex: 2,
                border: '1px solid rgba(255,255,255,0.1)'
              }}>
                {dateBadge}
              </div>
            )}

            {!hideRating && (
              hasMoctale ? (
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
              ) : null
            )}

            {isTV && (
              <div className="movie-card__tv-badge">TV</div>
            )}

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
