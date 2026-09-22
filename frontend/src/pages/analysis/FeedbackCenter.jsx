import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { userService } from '../../services/userService'
import { recFeedback } from '../../services/feedbackService'
import { EmptyNote } from './SectionRail'
import { SIGNAL_META, detailPath, pct, posterUrl, relativeTime, shortDate } from './analysisUtils'

const SignalTimeline = lazy(() => import('./SignalTimeline'))

const WINDOWS = [30, 90]
const TOTAL_ORDER = ['watched', 'watchlist', 'thumbs_up', 'thumbs_down', 'click']

function Poster({ item }) {
  const src = posterUrl(item.poster_path, 'w92')
  return src
    ? <img className="an-row__poster" src={src} alt="" loading="lazy" decoding="async" />
    : <span className="an-row__poster an-row__poster--blank" />
}

export default function FeedbackCenter() {
  const [days, setDays] = useState(90)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [muted, setMuted] = useState([])
  // Per-item UI state after an undo / restore, so the list answers immediately
  // while the signal is processed in the background.
  const [done, setDone] = useState({})
  const cache = useRef({})

  const load = useCallback((d) => {
    if (cache.current[d]) {
      setData(cache.current[d])
      setStatus('ready')
      return
    }
    setStatus('loading')
    userService.getFeedbackSnapshot(d)
      .then((res) => {
        cache.current[d] = res.data
        setData(res.data)
        setStatus('ready')
      })
      .catch(() => setStatus('error'))
  }, [])

  useEffect(() => { load(days) }, [days, load])

  const key = (i) => `${i.media_type}:${i.id}`

  const undo = (item) => {
    setDone((s) => ({ ...s, [key(item)]: 'undone' }))
    cache.current = {}
    recFeedback.undo(item.id, item.media_type, 'analysis')
  }

  const restore = (item) => {
    setDone((s) => ({ ...s, [key(item)]: 'restored' }))
    cache.current = {}
    recFeedback.undo(item.id, item.media_type, 'analysis')
  }

  const toggleSeries = (k) =>
    setMuted((m) => (m.includes(k) ? m.filter((x) => x !== k) : [...m, k]))

  const windowToggle = (
    <div className="an-seg" role="group" aria-label="Time window">
      {WINDOWS.map((w) => (
        <button key={w} type="button" className={w === days ? 'is-on' : ''} aria-pressed={w === days} onClick={() => setDays(w)}>
          {w} days
        </button>
      ))}
    </div>
  )

  if (status === 'error') {
    return <EmptyNote>Your feedback history could not load. Reload the page to try again.</EmptyNote>
  }

  const totals = data?.totals || {}
  const anySignal = TOTAL_ORDER.some((k) => totals[k] > 0)

  return (
    <div className="an-feedback">
      <div className="an-feedback__top">
        <div className="an-totals">
          {TOTAL_ORDER.map((k) => (
            <button
              key={k}
              type="button"
              className={`an-total ${muted.includes(k) ? 'is-muted' : ''}`}
              onClick={() => toggleSeries(k)}
              aria-pressed={!muted.includes(k)}
              title={`Show or hide ${SIGNAL_META[k].label.toLowerCase()} in the chart`}
            >
              <span className="an-dot" style={{ background: SIGNAL_META[k].color }} />
              <span className="an-total__label">{SIGNAL_META[k].label}</span>
              <span className="an-num an-total__value">{status === 'ready' ? totals[k] ?? 0 : '–'}</span>
            </button>
          ))}
        </div>
        {windowToggle}
      </div>

      <div className="an-panel an-panel--chart">
        {status === 'loading' || !data ? (
          <div className="skeleton an-skel-block" style={{ height: 220 }} />
        ) : anySignal ? (
          <Suspense fallback={<div className="skeleton an-skel-block" style={{ height: 220 }} />}>
            <SignalTimeline data={data.timeline} hidden={muted} />
          </Suspense>
        ) : (
          <EmptyNote to="/" action="Go to your feed">
            No signals in the last {days} days. Use the thumbs on recommendation cards and this chart fills in.
          </EmptyNote>
        )}
      </div>

      {data && data.conversion.liked > 0 && (
        <p className="an-conversion">
          You liked <b className="an-num">{data.conversion.liked}</b> recommendations in this window and have watched{' '}
          <b className="an-num">{data.conversion.watched}</b> of them ({pct(data.conversion.rate)}).
        </p>
      )}

      {data && (
        <div className="an-feedback__lists">
          <article className="an-panel">
            <h3 className="an-subhead">Recent signals</h3>
            {data.recent.length === 0 ? (
              <p className="an-muted">Nothing yet in this window.</p>
            ) : (
              <ul className="an-rows">
                {data.recent.map((r) => {
                  const state = done[key(r)]
                  const meta = SIGNAL_META[r.signal]
                  return (
                    <li key={`${key(r)}-${r.at}`} className={`an-row ${state ? 'is-done' : ''}`}>
                      <Link to={detailPath(r)} className="an-row__link">
                        <Poster item={r} />
                        <span className="an-row__text">
                          <span className="an-row__title">{r.title || 'Untitled'}</span>
                          <span className="an-row__meta">
                            <span className="an-dot" style={{ background: meta?.color }} />
                            {state === 'undone' ? 'Undone' : meta?.label}, {relativeTime(r.at)}
                          </span>
                        </span>
                      </Link>
                      {r.undoable && !state && (
                        <button type="button" className="an-btn an-btn--sm an-btn--ghost" onClick={() => undo(r)}>
                          Undo
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </article>

          <article className="an-panel">
            <h3 className="an-subhead">Hidden from your feed</h3>
            {data.hidden.length === 0 ? (
              <p className="an-muted">Nothing hidden. A thumbs-down on a recommendation hides it here for 90 days.</p>
            ) : (
              <ul className="an-rows">
                {data.hidden.map((h) => {
                  const state = done[key(h)]
                  return (
                    <li key={key(h)} className={`an-row ${state ? 'is-done' : ''}`}>
                      <Link to={detailPath(h)} className="an-row__link">
                        <Poster item={h} />
                        <span className="an-row__text">
                          <span className="an-row__title">{h.title || 'Untitled'}</span>
                          <span className="an-row__meta">
                            {state === 'restored' ? 'Restored to your feed' : `Hidden until ${shortDate(h.expires_at)}`}
                          </span>
                        </span>
                      </Link>
                      {h.restorable && !state && (
                        <button type="button" className="an-btn an-btn--sm an-btn--ghost" onClick={() => restore(h)}>
                          Restore
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        </div>
      )}
    </div>
  )
}
