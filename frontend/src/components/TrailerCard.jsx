import { useState, useRef, useEffect, useCallback } from 'react'
import BorderGlow from './BorderGlow'
import './MovieCard.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

function formatReleaseDate(dateStr) {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return null
  }
}

export default function TrailerCard({ item, onPlayTrailer }) {
  const [hasError, setHasError]     = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isVisible, setIsVisible]   = useState(false)
  const cardRef = useRef(null)
  const imageRef = useRef(null)

  const isTV = item.media_type === 'tv'
  const posterUrl = item.poster_path
    ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}`
    : null

  useEffect(() => {
    if (imageRef.current?.complete) setImageLoaded(true)
  }, [item])

  useEffect(() => {
    const parentEl = cardRef.current
    if (!parentEl) return
    const targetEl = parentEl.querySelector('.movie-card')
    if (!targetEl) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setIsVisible(true); obs.disconnect() } },
      { threshold: 0.1, rootMargin: '0px 0px 100px 0px' }
    )
    obs.observe(targetEl)
    return () => obs.disconnect()
  }, [])

  const handleClick = useCallback(() => onPlayTrailer(item), [item, onPlayTrailer])

  return (
    <div ref={cardRef} style={{ display: 'contents' }}>
      <BorderGlow
        className={`movie-card movie-card--standard ${isVisible ? 'visible' : ''}`}
        tabIndex={0}
        role="button"
        onClick={handleClick}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        borderRadius={12}
        glowRadius={30}
        glowIntensity={0.85}
        colors={['#B048FF', '#00E5A0', '#FF4D6D']}
        backgroundColor="#1B1B1B"
        style={{ cursor: 'pointer' }}
      >
        <div className="movie-card__poster-wrap">
          {posterUrl && !hasError ? (
            <img
              ref={imageRef}
              src={posterUrl}
              alt={`${item.title} poster`}
              className={`movie-card__poster poster-progressive ${imageLoaded ? 'poster-progressive--loaded' : ''}`}
              loading="lazy"
              onLoad={() => setImageLoaded(true)}
              onError={() => setHasError(true)}
            />
          ) : (
            <div className="movie-card__poster-fallback">
              <span>{item.title}</span>
            </div>
          )}

          {/* Trailer/Teaser badge top-left (replaces rating) */}
          <div style={{
            position: 'absolute', top: '8px', left: '8px',
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            color: '#fff', padding: '4px 8px', borderRadius: '8px',
            fontSize: '0.75rem', fontWeight: 'bold',
            backdropFilter: 'blur(4px)', zIndex: 2,
            border: '1px solid rgba(255,255,255,0.1)'
          }}>
            {item.video_type?.toUpperCase()}
          </div>

          {/* Play button overlay */}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0)', transition: 'background 0.2s',
            zIndex: 1
          }} className="trailer-play-overlay">
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              backgroundColor: 'rgba(0, 0, 0, 0.75)', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.1)',
              opacity: 0, transition: 'opacity 0.2s', transform: 'scale(0.8)',
            }} className="trailer-play-btn">
              <svg viewBox="0 0 24 24" fill="white" width="18" height="18">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>

          {/* TV badge */}
          {isTV && <div className="movie-card__tv-badge">TV</div>}
        </div>

        <div className="movie-card__info">
          <h3 className="movie-card__title">{item.title}</h3>
          <p className="movie-card__meta">
            <span className="movie-card__year">
              {formatReleaseDate(item.release_date || item.first_air_date) || 'Upcoming'}
            </span>
          </p>
        </div>
      </BorderGlow>
    </div>
  )
}
