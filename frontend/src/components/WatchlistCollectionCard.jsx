import { useNavigate } from 'react-router-dom'
import './WatchlistCollectionCard.css'

export default function WatchlistCollectionCard({ collection }) {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(`/watchlists/${collection.id}`)
  }

  // Define colorful gradients for the unique styling (when SVG is shown)
  const THEMES = [
    { bg: 'linear-gradient(135deg, #B048FF 0%, #5227FF 100%)', icon: '#FFFFFF' }, // Purple
    { bg: 'linear-gradient(135deg, #00E5A0 0%, #008B6B 100%)', icon: '#FFFFFF' }, // Green
    { bg: 'linear-gradient(135deg, #FF4D6D 0%, #C9184A 100%)', icon: '#FFFFFF' }, // Red
    { bg: 'linear-gradient(135deg, #FFC300 0%, #FF8F00 100%)', icon: '#FFFFFF' }, // Yellow/Orange
    { bg: 'linear-gradient(135deg, #00F2FE 0%, #4FACFE 100%)', icon: '#FFFFFF' }, // Blue
    { bg: 'linear-gradient(135deg, #F5576C 0%, #F093FB 100%)', icon: '#FFFFFF' }, // Pink
  ]
  const idHash = collection.id ? Number(collection.id) : collection.name.length
  const theme = THEMES[(idHash || 0) % THEMES.length]

  const safePosters = (collection.cover_posters || []).filter(Boolean)
  const count = safePosters.length
  const getTMDBUrl = (path) => path ? `https://image.tmdb.org/t/p/w500${path}` : ''

  const renderCover = () => {
    if (collection.item_count === 0 || count === 0) {
      // No items -> Show SVG icon
      return (
        <div 
          className="collection-card__empty" 
          style={{ background: theme.bg, boxShadow: 'inset 0 0 20px rgba(0,0,0,0.2)' }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={theme.icon} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
      )
    }

    if (collection.item_count < 4 || count < 4) {
      // Below 4 items -> Show recent single image
      return (
        <img 
          src={getTMDBUrl(safePosters[0])} 
          alt={collection.name} 
          className="collection-card__img" 
          loading="lazy" 
          onError={(e) => { e.target.style.display = 'none' }}
        />
      )
    }

    // 4 or more items -> Show recent four images as collage
    return (
      <div className="collage-grid collage-layout-4-strict">
        {safePosters.slice(0, 4).map((poster, idx) => (
          <img 
            key={idx} 
            src={getTMDBUrl(poster)} 
            alt="Collection Cover" 
            className="collage-img" 
            loading="lazy" 
            onError={(e) => { e.target.style.display = 'none' }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="collection-card" onClick={handleClick}>
      <div className="collection-card__cover">
        {renderCover()}
      </div>
      <div className="collection-card__info">
        <h3 className="collection-card__title">{collection.name}</h3>
        <p className="collection-card__count">
          {collection.item_count} {collection.item_count === 1 ? 'item' : 'items'}
        </p>
      </div>
    </div>
  )
}
