import { useMemo } from 'react'
import { EmptyNote } from './SectionRail'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOUR_TICKS = { 0: '12a', 6: '6a', 12: '12p', 18: '6p' }

/**
 * The backend buckets watches by UTC weekday/hour. Shift the 7×24 grid into
 * the viewer's own timezone (rounded to the hour) so "late night" means their
 * late night.
 */
function toLocalGrid(utcGrid) {
  const offset = Math.round(-new Date().getTimezoneOffset() / 60)
  const out = Array.from({ length: 7 }, () => Array(24).fill(0))
  utcGrid.forEach((row, d) => row.forEach((count, h) => {
    const slot = (((d * 24 + h + offset) % 168) + 168) % 168
    out[Math.floor(slot / 24)][slot % 24] += count
  }))
  return out
}

function peakText(grid) {
  let best = { d: 0, h: 0, c: 0 }
  grid.forEach((row, d) => row.forEach((c, h) => { if (c > best.c) best = { d, h, c } }))
  if (!best.c) return null
  const hour = new Date(2000, 0, 1, best.h).toLocaleTimeString(undefined, { hour: 'numeric' })
  return `You watch most on ${DAYS[best.d]}s around ${hour}.`
}

export default function Habits({ analysis }) {
  const grid = useMemo(() => toLocalGrid(analysis.time_pattern?.heatmap || []), [analysis])
  const max = Math.max(1, ...grid.flat())
  const monthly = analysis.monthly_activity || []
  const monthMax = Math.max(1, ...monthly.map((m) => m.count))
  const binge = analysis.binge_pattern || {}
  const drift = analysis.taste_drift || {}
  const rating = analysis.rating_profile || {}
  const content = analysis.content_behavior || { movie: {}, tv: {} }
  const totalRated = (rating.liked_count || 0) + (rating.neutral_count || 0) + (rating.disliked_count || 0)
  const totalWatched = (content.movie.count || 0) + (content.tv.count || 0)
  const gap = Object.entries(analysis.comparison || {})
    .sort((a, b) => Math.abs(b[1].gap) - Math.abs(a[1].gap))
    .slice(0, 6)
  const peak = peakText(grid)

  if (!totalWatched && !totalRated) {
    return (
      <EmptyNote to="/movies" action="Find something to watch">
        Your habits show up once you mark a few titles as watched.
      </EmptyNote>
    )
  }

  return (
    <div className="an-habits">
      <article className="an-panel an-habits__heat">
        <h3 className="an-subhead">When you watch</h3>
        {peak && <p className="an-muted">{peak}</p>}
        <div className="an-heat" role="img" aria-label={peak || 'Watch times by weekday and hour'}>
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={`h${h}`} className="an-heat__hour">{HOUR_TICKS[h] || ''}</span>
          ))}
          {grid.map((row, d) => (
            <div key={DAYS[d]} className="an-heat__row">
              <span className="an-heat__day">{DAYS[d]}</span>
              {row.map((c, h) => (
                <span
                  key={h}
                  className="an-heat__cell"
                  style={{ '--v': c / max }}
                  title={`${DAYS[d]} ${h}:00, ${c} watched`}
                />
              ))}
            </div>
          ))}
        </div>
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Last 12 months</h3>
        <div className="an-cols an-cols--months" role="img" aria-label={monthly.map((m) => `${m.month}: ${m.count}`).join(', ')}>
          {monthly.map((m) => (
            <div key={m.month} className="an-cols__col" title={`${m.count} watched`}>
              <span className="an-cols__bar" style={{ height: `${(m.count / monthMax) * 100}%` }} />
              <span className="an-cols__label">
                {new Date(`${m.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'narrow' })}
              </span>
            </div>
          ))}
        </div>
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Streaks and binges</h3>
        <dl className="an-stats">
          <div><dt>Longest daily streak</dt><dd className="an-num">{binge.max_streak ?? 0} days</dd></div>
          <div><dt>Binge days (3+ watched)</dt><dd className="an-num">{binge.binge_sessions ?? 0}</dd></div>
          <div><dt>Most in one day</dt><dd className="an-num">{binge.longest_binge ?? 0}</dd></div>
        </dl>
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">Movies and series</h3>
        <div className="an-split" role="img" aria-label={`${content.movie.count} movies, ${content.tv.count} series`}>
          <span style={{ flexGrow: content.movie.count || 0 }} className="an-split__movie" />
          <span style={{ flexGrow: content.tv.count || 0 }} className="an-split__tv" />
        </div>
        <dl className="an-stats an-stats--two">
          <div><dt>Movies</dt><dd className="an-num">{content.movie.count || 0}</dd></div>
          <div><dt>Series</dt><dd className="an-num">{content.tv.count || 0}</dd></div>
        </dl>
      </article>

      <article className="an-panel">
        <h3 className="an-subhead">How you rate</h3>
        {totalRated ? (
          <>
            <div className="an-split" role="img" aria-label={`${rating.liked_count} liked, ${rating.neutral_count} middling, ${rating.disliked_count} disliked`}>
              <span style={{ flexGrow: rating.liked_count, background: 'var(--rating-goforit)' }} />
              <span style={{ flexGrow: rating.neutral_count, background: 'var(--rating-timepass)' }} />
              <span style={{ flexGrow: rating.disliked_count, background: 'var(--rating-skip)' }} />
            </div>
            <dl className="an-stats an-stats--three">
              <div><dt>Go for it or better</dt><dd className="an-num">{rating.liked_count}</dd></div>
              <div><dt>Timepass</dt><dd className="an-num">{rating.neutral_count}</dd></div>
              <div><dt>Skip</dt><dd className="an-num">{rating.disliked_count}</dd></div>
            </dl>
          </>
        ) : <p className="an-muted">Rate a few titles to see your rating style.</p>}
      </article>

      {gap.length > 0 && (
        <article className="an-panel an-habits__gap">
          <h3 className="an-subhead">Browsed or watched</h3>
          <p className="an-muted">{analysis.insight}</p>
          <ul className="an-gap">
            {gap.map(([genre, v]) => (
              <li key={genre}>
                <span className="an-gap__name">{genre}</span>
                <span className="an-gap__bars">
                  <span className="an-gap__bar is-watch" style={{ width: `${v.watch * 100}%` }} title={`Watched ${Math.round(v.watch * 100)}%`} />
                  <span className="an-gap__bar is-click" style={{ width: `${v.click * 100}%` }} title={`Opened ${Math.round(v.click * 100)}%`} />
                </span>
              </li>
            ))}
          </ul>
          <p className="an-legend-inline">
            <span><span className="an-dot" style={{ background: '#9B59FF' }} /> Share of what you watched</span>
            <span><span className="an-dot" style={{ background: '#FFC300' }} /> Share of what you opened (30 days)</span>
          </p>
        </article>
      )}

      {drift.quarters?.length >= 2 && (
        <article className="an-panel an-habits__drift">
          <h3 className="an-subhead">Your top genre, quarter by quarter</h3>
          <p className="an-muted">
            {drift.label}: your first and latest quarters differ by {Math.round((drift.drift_score || 0) * 100)}%.
          </p>
          <ol className="an-drift">
            {drift.quarters.map((q) => (
              <li key={q.quarter}>
                <span className="an-drift__q">{q.quarter.replace('-', ' ')}</span>
                <span className="an-drift__g">{q.top_genre}</span>
              </li>
            ))}
          </ol>
        </article>
      )}
    </div>
  )
}
