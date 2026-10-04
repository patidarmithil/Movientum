/**
 * One instant-search result in the SearchOverlay style: small poster, title,
 * "year • Movie/TV Show • ★ rating", with an action slot on the right (add,
 * add-negative, …). Used by the add-to-watchlist modal and /rec-content.
 */
import './SearchResultRow.css'

const TMDB_W92 = 'https://image.tmdb.org/t/p/w92'

function resultMeta(item) {
  const year = item.release_year || (item.release_date ? String(item.release_date).slice(0, 4) : '')
  const kind = item.media_type === 'tv' ? 'TV Show' : 'Movie'
  const rating = item.vote_average ? `★ ${Number(item.vote_average).toFixed(1)}` : ''
  return [year, kind, rating].filter(Boolean).join(' • ')
}

export default function SearchResultRow({ item, actions, added = false }) {
  const title = item.title || item.name
  return (
    <div className={`srr${added ? ' srr--added' : ''}`}>
      {item.poster_path ? (
        <img className="srr__poster" src={`${TMDB_W92}${item.poster_path}`} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="srr__poster srr__poster--fallback" aria-hidden>{title?.[0] ?? '?'}</div>
      )}
      <div className="srr__text">
        <div className="srr__title">{title}</div>
        <div className="srr__meta">{resultMeta(item)}</div>
      </div>
      {actions && <div className="srr__actions">{actions}</div>}
    </div>
  )
}
