import { Link } from 'react-router-dom'
import { detailPath, posterUrl } from './analysisUtils'

function Shelf({ title, note, items, caption }) {
  if (!items?.length) return null
  return (
    <article className="an-shelf">
      <div className="an-shelf__head">
        <h3 className="an-subhead">{title}</h3>
        <p className="an-muted">{note}</p>
      </div>
      <ul className="an-shelf__row">
        {items.map((item) => {
          const src = posterUrl(item.poster_path, 'w185')
          return (
            <li key={`${item.media_type}-${item.id}`}>
              <Link to={detailPath(item)} className="an-tile">
                {src
                  ? <img src={src} alt="" loading="lazy" decoding="async" />
                  : <span className="an-tile__blank" />}
                <span className="an-tile__title">{item.title}</span>
                <span className="an-tile__why">{caption(item)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </article>
  )
}

const RATING_WORD = { perfection: 'Perfection', go_for_it: 'Go for it' }

export default function LibraryHighlights({ analysis }) {
  const gems = analysis.hidden_gems?.gems || []
  const any = analysis.rewatch_candidates?.length || analysis.early_favorites?.length || gems.length
  if (!any) {
    return <p className="an-muted">Rate the titles you have watched and your favourites to revisit collect here.</p>
  }
  return (
    <div className="an-library">
      <Shelf
        title="Worth a rewatch"
        note="Rated highly, watched over a month ago, or opened again after watching."
        items={analysis.rewatch_candidates}
        caption={(i) => i.why}
      />
      <Shelf
        title="Old favourites"
        note="Your high ratings from long ago that critics rate highly too."
        items={analysis.early_favorites}
        caption={(i) => i.why}
      />
      <Shelf
        title="Hidden gems you found"
        note={`${Math.round((analysis.hidden_gems?.ratio || 0) * 100)}% of your ratings are little-known titles you loved.`}
        items={gems.slice(0, 12)}
        caption={(i) => `You rated it ${RATING_WORD[i.user_rating] || 'highly'}`}
      />
    </div>
  )
}
