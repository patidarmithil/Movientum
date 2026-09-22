import { Link } from 'react-router-dom'
import { EmptyNote } from './SectionRail'
import { languageName, relativeTime } from './analysisUtils'

/** Diverging bars: positive grows right in green→violet, negative grows left in red. */
function SignedBars({ items, limit = 12 }) {
  const list = items.slice(0, limit)
  const max = Math.max(1, ...list.map((i) => Math.abs(i.weight)))
  return (
    <ul className="an-signed">
      {list.map((i) => (
        <li key={i.id}>
          <span className="an-signed__name">{i.name}</span>
          <span className="an-signed__axis">
            <span
              className={`an-signed__bar ${i.weight < 0 ? 'is-neg' : ''}`}
              style={{ width: `${(Math.abs(i.weight) / max) * 50}%` }}
            />
          </span>
          <span className="an-num an-signed__val">{i.weight > 0 ? '+' : ''}{Math.round(i.weight)}</span>
        </li>
      ))}
    </ul>
  )
}

function RankList({ items, personLinks = false }) {
  if (!items.length) return <p className="an-muted">Nothing strong enough yet.</p>
  const max = Math.max(...items.map((i) => i.weight))
  return (
    <ol className="an-rank">
      {items.map((i) => (
        <li key={i.id}>
          {personLinks
            ? <Link to={`/person/${i.id}`} className="an-rank__name">{i.name}</Link>
            : <span className="an-rank__name">{i.name}</span>}
          <span className="an-rank__track"><span style={{ width: `${(i.weight / max) * 100}%` }} /></span>
        </li>
      ))}
    </ol>
  )
}

export default function TasteProfile({ taste }) {
  if (!taste || (taste.genres.length === 0 && taste.total_interactions === 0)) {
    return (
      <EmptyNote to="/movies" action="Browse movies">
        Your taste profile builds as you watch, rate and give thumbs to titles. Watch or rate five to see it take shape.
      </EmptyNote>
    )
  }

  const eraMax = Math.max(1, ...taste.eras.map((e) => Math.abs(e.weight)))
  const avoid = [...(taste.avoid?.genres || []), ...(taste.avoid?.keywords || [])]

  return (
    <div className="an-taste">
      <article className="an-panel an-taste__genres">
        <h3 className="an-subhead">Genres</h3>
        <p className="an-muted">Each watch, thumbs and watchlist add nudges these. Range is −100 to +100.</p>
        <SignedBars items={taste.genres} limit={19} />
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Actors</h3>
        <RankList items={taste.cast} personLinks />
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Directors</h3>
        <RankList items={taste.directors} personLinks />
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Themes</h3>
        {taste.keywords.length ? (
          <div className="an-chips">
            {taste.keywords.map((k) => <span key={k.id} className="an-chip">{k.name}</span>)}
          </div>
        ) : <p className="an-muted">Nothing strong enough yet.</p>}
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Decades</h3>
        {taste.eras.length ? (
          <div className="an-cols" role="img" aria-label={taste.eras.map((e) => `${e.id} ${Math.round(e.weight)}`).join(', ')}>
            {taste.eras.map((e) => (
              <div key={e.id} className="an-cols__col">
                <span className="an-cols__bar" style={{ height: `${(Math.max(0, e.weight) / eraMax) * 100}%` }} />
                <span className="an-cols__label">{e.id.replace(/^(\d\d)(\d\d)s$/, '’$2s')}</span>
              </div>
            ))}
          </div>
        ) : <p className="an-muted">Nothing strong enough yet.</p>}
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Languages</h3>
        <p className="an-muted">1.0× is neutral. Above boosts a language, below holds it back.</p>
        <ul className="an-mult">
          {taste.languages.map((l) => (
            <li key={l.id}>
              <span>{languageName(l.id)}</span>
              <span className={`an-num ${l.multiplier > 1 ? 'is-up' : l.multiplier < 1 ? 'is-down' : ''}`}>
                {l.multiplier.toFixed(2)}×
              </span>
            </li>
          ))}
        </ul>
      </article>

      <article className="an-panel an-panel--avoid">
        <h3 className="an-subhead">You steer away from</h3>
        {avoid.length ? (
          <>
            <p className="an-muted">Built from thumbs-downs and titles you removed from your history. These lower a title&apos;s score without hiding it.</p>
            <div className="an-chips">
              {avoid.map((a) => <span key={`${a.name}-${a.id}`} className="an-chip an-chip--neg">{a.name}</span>)}
            </div>
          </>
        ) : <p className="an-muted">Nothing yet. Give a thumbs-down to a recommendation you don&apos;t want and it shows up here.</p>}
      </article>

      <p className="an-footnote">
        Built from {taste.total_interactions.toLocaleString()} signals
        {taste.last_updated ? `, last changed ${relativeTime(taste.last_updated)}` : ''}.
      </p>
    </div>
  )
}
