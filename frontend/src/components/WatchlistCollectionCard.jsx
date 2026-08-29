import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import './WatchlistCollectionCard.css'

function FanPoster({ src, alt = '', className = '', onError }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      className={`${className} poster-progressive ${loaded ? 'poster-progressive--loaded' : ''}`.trim()}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={onError}
    />
  )
}

// Fan-stack geometry for 2-4 posters: offset (%), rotation (deg), z-index per slot.
const FAN_LAYOUTS = {
  2: [
    { x: -13, r: -7, z: 1 },
    { x: 13, r: 7, z: 2 },
  ],
  3: [
    { x: -20, r: -9, z: 1 },
    { x: 0, r: 0, z: 3 },
    { x: 20, r: 9, z: 2 },
  ],
  4: [
    { x: -26, r: -10, z: 1 },
    { x: -9, r: -3, z: 2 },
    { x: 9, r: 3, z: 3 },
    { x: 26, r: 10, z: 4 },
  ],
}

export default function WatchlistCollectionCard({ collection }) {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(`/watchlists/${collection.id}`)
  }

  // Themed spine gradient per collection (deterministic from id/name).
  const THEMES = [
    { bg: 'linear-gradient(135deg, #B048FF 0%, #5227FF 100%)', icon: '#FFFFFF' },
    { bg: 'linear-gradient(135deg, #00E5A0 0%, #008B6B 100%)', icon: '#FFFFFF' },
    { bg: 'linear-gradient(135deg, #FF4D6D 0%, #C9184A 100%)', icon: '#FFFFFF' },
    { bg: 'linear-gradient(135deg, #FFC300 0%, #FF8F00 100%)', icon: '#FFFFFF' },
    { bg: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)', icon: '#FFFFFF' },
    { bg: 'linear-gradient(135deg, #F5576C 0%, #F093FB 100%)', icon: '#FFFFFF' },
  ]
  const idHash = collection.id ? Number(collection.id) : collection.name.length
  const theme = THEMES[(idHash || 0) % THEMES.length]

  const safePosters = (collection.cover_posters || []).filter(Boolean)
  const count = safePosters.length
  const itemCount = collection.item_count ?? count
  const getTMDBUrl = (path) => (path ? `https://image.tmdb.org/t/p/w342${path}` : '')

  const renderCover = () => {
    if (itemCount === 0 || count === 0) {
      return (
        <div className="collection-card__empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={theme.icon} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
      )
    }

    if (count === 1) {
      return (
        <FanPoster
          src={getTMDBUrl(safePosters[0])}
          alt={collection.name}
          className="collection-card__img"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      )
    }

    // 2-4+ items -> fanned poster stack (visually reads as "a stack of titles")
    const layoutKey = Math.min(count, 4)
    const layout = FAN_LAYOUTS[layoutKey]
    const overflow = itemCount - layoutKey

    return (
      <div className="poster-fan">
        {safePosters.slice(0, layoutKey).map((poster, idx) => (
          <div
            key={idx}
            className="poster-fan__item"
            style={{
              '--fan-x': `${layout[idx].x}%`,
              '--fan-r': `${layout[idx].r}deg`,
              zIndex: layout[idx].z,
            }}
          >
            <FanPoster
              src={getTMDBUrl(poster)}
              onError={(e) => { e.target.style.display = 'none' }}
            />
          </div>
        ))}
        {overflow > 0 && (
          <span className="poster-fan__overflow" style={{ zIndex: layout[layoutKey - 1].z + 1 }}>
            +{overflow}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="collection-card" onClick={handleClick} style={{ '--card-accent': theme.bg }}>
      <div className="collection-card__cover">
        {renderCover()}
      </div>
      <div className="collection-card__info">
        <h3 className="collection-card__title">{collection.name}</h3>
        <span className="collection-card__meta">{itemCount} {itemCount === 1 ? 'title' : 'titles'}</span>
      </div>
    </div>
  )
}
