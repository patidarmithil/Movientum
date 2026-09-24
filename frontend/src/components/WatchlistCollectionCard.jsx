import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import './WatchlistCollectionCard.css'

/*
 * Class names use the `wl-card` prefix on purpose. MovieDetail.css ships a
 * global `.collection-card` (the "part of a collection" rail, fixed at 120px)
 * which used to leak onto this card once a movie page had been visited and
 * shrink every watchlist box on the dashboard.
 */

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

function Poster({ src, className = '' }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src={src}
      alt=""
      className={`${className} poster-progressive ${loaded ? 'poster-progressive--loaded' : ''}`.trim()}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  )
}

// Fan-stack geometry for 1-4 posters: offset (% of poster width), rotation (deg), z-index per slot.
const FAN_LAYOUTS = {
  1: [
    { x: 0, r: 0, z: 1 },
  ],
  2: [
    { x: -30, r: -6, z: 1 },
    { x: 30, r: 6, z: 2 },
  ],
  3: [
    { x: -48, r: -8, z: 1 },
    { x: 0, r: 0, z: 3 },
    { x: 48, r: 8, z: 2 },
  ],
  4: [
    { x: -66, r: -9, z: 1 },
    { x: -22, r: -3, z: 2 },
    { x: 22, r: 3, z: 3 },
    { x: 66, r: 9, z: 4 },
  ],
}

// Accent per collection, picked deterministically from its id so it never changes between visits.
const THEMES = [
  'linear-gradient(135deg, #B048FF 0%, #5227FF 100%)',
  'linear-gradient(135deg, #00E5A0 0%, #008B6B 100%)',
  'linear-gradient(135deg, #FF4D6D 0%, #C9184A 100%)',
  'linear-gradient(135deg, #FFC300 0%, #FF8F00 100%)',
  'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)',
  'linear-gradient(135deg, #F5576C 0%, #F093FB 100%)',
]

export default function WatchlistCollectionCard({ collection }) {
  const navigate = useNavigate()
  const open = () => navigate(`/watchlists/${collection.id}`)

  const idHash = collection.id ? Number(collection.id) : (collection.name || '').length
  const accent = THEMES[(idHash || 0) % THEMES.length]

  const posters = (collection.cover_posters || []).filter(Boolean)
  const shown = posters.slice(0, 4)
  const itemCount = collection.item_count ?? posters.length
  const overflow = itemCount - shown.length
  const countLabel = `${itemCount} ${itemCount === 1 ? 'title' : 'titles'}`
  const layout = FAN_LAYOUTS[shown.length]
  // The banner the user uploaded on the collection page wins over the poster fan.
  const [coverFailed, setCoverFailed] = useState(false)
  const customCover = !coverFailed ? collection.cover_image_url : null

  return (
    <div
      className="wl-card"
      role="link"
      tabIndex={0}
      aria-label={`${collection.name}, ${countLabel}`}
      onClick={open}
      onKeyDown={(e) => { if (e.key === 'Enter') open() }}
      style={{ '--wl-accent': accent }}
    >
      <div className="wl-card__cover">
        {customCover ? (
          <img
            className="wl-card__custom"
            src={customCover}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
          />
        ) : shown.length === 0 ? (
          <div className="wl-card__empty">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span>Nothing added yet</span>
          </div>
        ) : (
          <div className="wl-card__fan">
            {shown.map((path, i) => (
              <div
                key={path + i}
                className="wl-card__poster"
                style={{
                  '--fan-x': `${layout[i].x}%`,
                  '--fan-r': `${layout[i].r}deg`,
                  zIndex: layout[i].z,
                }}
              >
                <Poster src={`${TMDB_IMAGE_BASE}/w342${path}`} />
              </div>
            ))}
          </div>
        )}
        {!customCover && overflow > 0 && <span className="wl-card__more">+{overflow}</span>}
      </div>

      <div className="wl-card__info">
        <h3 className="wl-card__title">{collection.name}</h3>
        <span className="wl-card__meta">{countLabel}</span>
      </div>
    </div>
  )
}
