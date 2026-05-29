const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import BorderGlow from './BorderGlow'
import './MovieCard.css'

/**
 * MovieCard — most reusable component in Phase 2.
 *
 * Props:
 *   movie: { id, title, poster_path, release_year, genres, vote_average, media_type? }
 *   variant?: 'standard' | 'compact' | 'featured'  (default: 'standard')
 */
export default function MovieCard({ movie, variant = 'standard', ratingCategory }) {
  const navigate = useNavigate()
  const [hasError, setHasError] = useState(false)

  const posterUrl = movie.poster_path
    ? `${TMDB_IMAGE_BASE}/w342${movie.poster_path}`
    : null

  // Route TV shows to /tv/:id, movies to /movies/:id
  const isTV = movie.media_type === 'tv'
  const handleClick = () => navigate(isTV ? `/tv/${movie.id}` : `/movies/${movie.id}`)

  const ratingColor =
    movie.vote_average >= 8 ? '#22C55E' :
    movie.vote_average >= 6 ? '#FFC300' : '#EF4444'

  return (
    <BorderGlow
      className={`movie-card movie-card--${variant}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-label={`${movie.title} (${movie.release_year})`}
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
            className="movie-card__poster"
            loading="lazy"
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

        {/* Rating badge (Movies and TV) */}
        {movie.vote_average > 0 && (
          <div
            className="movie-card__rating"
            style={{ color: ratingColor }}
          >
            ★ {movie.vote_average.toFixed(1)}
          </div>
        )}

        {/* TV badge */}
        {isTV && (
          <div className="movie-card__tv-badge">TV</div>
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
  )
}


