const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
import { Link } from 'react-router-dom'
import React, { useState, useRef, useEffect, useCallback, memo } from 'react'
import BorderGlow from './BorderGlow'
import FeedbackControl from './FeedbackControl'
import { recFeedback } from '../services/feedbackService'
import { observeOnce } from '../utils/sharedObserver'
import './MovieCard.css'

// Stable identity: an inline array here was a new prop value on every render,
// so BorderGlow re-ran its work for every card in every row.
const CARD_GLOW_COLORS = ['#B048FF', '#00E5A0', '#FF4D6D']

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
 *   showFeedback?: boolean — render the thumbs-up/down control (FeedbackControl).
 *                  Pass true from any surface showing platform-generated
 *                  recommendations. Guests see it too and are sent to login on
 *                  press, so the feature is discoverable before signup.
 *   feedbackSource?: string — which surface this is, for interaction_log tagging.
 *                  Must be one of VALID_SOURCES in the backend schema; a new
 *                  carousel gets its own value rather than reusing "other".
 *   feedbackValue?: 'up' | 'down' | null — pass to control the thumb state from
 *                  outside (AIRecommendations drives it from its memoryMap).
 *   onFeedbackChange?: (next) => void — fired after an optimistic vote.
 *   onDismiss?:   () => void — called after a thumbs-down. Pass it from a list
 *                  using useFeedbackBuffer so the card animates out and the next
 *                  candidate slides in; omit it and the vote only teaches.
 *   isExiting?:   boolean — applies the dismissal exit animation.
 *   badge?:       node — extra overlay content (the AI cards' sparkle marker).
 *   dateBadge?:   string — optional text to show in a badge at the top right (e.g. "17 Jul")
 *   hideRating?:  boolean — optional flag to hide the rating
 */
const MovieCard = memo(function MovieCard({
  movie,
  variant = 'standard',
  ratingCategory,
  showFeedback = false,
  feedbackSource = 'other',
  feedbackValue,
  onFeedbackChange,
  onDismiss,
  isExiting = false,
  badge = null,
  dateBadge = null,
  hideRating = false,
}) {
  const [hasError, setHasError]               = useState(false)
  const [imageLoaded, setImageLoaded]         = useState(false)
  const [isVisible, setIsVisible]             = useState(false)
  const cardRef                               = useRef(null)
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

  useEffect(() => {
    const parentEl = cardRef.current
    if (!parentEl) return

    const targetEl = parentEl.querySelector('.movie-card')
    if (!targetEl) return

    return observeOnce(targetEl, () => setIsVisible(true))
  }, [])

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
          className={`movie-card movie-card--${variant} ${isVisible ? 'visible' : ''}${isExiting ? ' is-exiting' : ''}`}
          tabIndex={0}
          borderRadius={12}
          glowRadius={30}
          glowIntensity={0.85}
          colors={CARD_GLOW_COLORS}
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

            {badge}
          </div>

          <div className="movie-card__info">
            <h3 className="movie-card__title">{movie.title}</h3>
            {/* The meta row is the control's home in the DOM on every breakpoint.
                On desktop CSS lifts it onto the foot of the poster; on touch it
                stays here, flush right of the year/genre. A <div>, not a <p>:
                the control is a <div> and cannot nest inside a paragraph. */}
            <div className="movie-card__meta">
              <span className="movie-card__year">{movie.release_year}</span>
              {movie.genres?.[0] && (
                <>
                  <span className="movie-card__dot">·</span>
                  <span className="movie-card__genre">{movie.genres[0]}</span>
                </>
              )}
              {showFeedback && tmdbId && (
                <FeedbackControl
                  kind="title"
                  tmdbId={tmdbId}
                  mediaType={mediaType}
                  source={feedbackSource}
                  value={feedbackValue}
                  onChange={onFeedbackChange}
                  onDismiss={onDismiss}
                />
              )}
            </div>
          </div>
        </BorderGlow>
      </Link>
    </div>
  )
})

export default MovieCard
