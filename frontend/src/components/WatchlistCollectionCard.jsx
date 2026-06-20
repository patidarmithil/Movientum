import { useNavigate } from 'react-router-dom'
import './WatchlistCollectionCard.css'

function CollageGrid({ posters, itemCount }) {
  if (!itemCount || itemCount === 0) {
    return (
      <div className="collage-grid empty">
        <span className="collage-icon">🔖</span>
      </div>
    )
  }

  // posters is an array of up to 6 image URLs
  const safePosters = (posters || []).filter(Boolean)
  const count = safePosters.length

  const getTMDBUrl = (path) => path ? `https://image.tmdb.org/t/p/w500${path}` : ''

  if (count === 0) {
    return (
      <div className="collage-grid empty">
        <span className="collage-icon">🔖</span>
      </div>
    )
  }

  let layoutClass = `collage-layout-${count}`
  if (count > 6) layoutClass = 'collage-layout-6'

  return (
    <div className={`collage-grid ${layoutClass}`}>
      {safePosters.slice(0, 6).map((poster, idx) => (
        <img
          key={idx}
          src={getTMDBUrl(poster)}
          alt="Collection Cover"
          className="collage-img"
          loading="lazy"
        />
      ))}
    </div>
  )
}

export default function WatchlistCollectionCard({ collection }) {
  const navigate = useNavigate()
  const isWide = collection.item_count > 1

  const handleClick = () => {
    navigate(`/watchlists/${collection.id}`)
  }

  return (
    <div className={`collection-card ${isWide ? 'is-wide' : ''}`} onClick={handleClick}>
      <div className="collection-card__cover">
        <CollageGrid posters={collection.cover_posters} itemCount={collection.item_count} />
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
