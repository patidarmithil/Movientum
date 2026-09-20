import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { filterDismissed } from '../services/feedbackService'

/** Matches the exit transition in MovieCard.css (`.is-exiting`). */
const EXIT_MS = 200

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const keyOf = (item) =>
  `${item?.media_type || 'movie'}:${item?.tmdb_id ?? item?.id}`

/**
 * useFeedbackBuffer — "hide and replace" for a recommendation row or grid.
 *
 * A thumbs-down should feel like the shelf reacting, not like a gap appearing.
 * So the card animates out and the next candidate slides into its place.
 *
 * The replacement comes from the tail of the list the surface already fetched:
 * the rec endpoints return large pools (60 per seed for the For-You pool, 100 for
 * /similar), so in the normal case nothing extra is requested. `fetchMore` is
 * only called when the buffer genuinely runs dry, and it should be the surface's
 * existing pagination call — this hook deliberately adds no endpoint of its own.
 *
 * @param {Array}    items              the full list the surface fetched
 * @param {object}   options
 * @param {number}   options.visibleCount  how many to render at once; omit to
 *                                         render everything and simply shrink
 *                                         the list on dismiss (grids want this)
 * @param {Function} options.fetchMore     optional () => Promise<void>, called
 *                                         when fewer than 3 buffered items remain
 * @returns {{ visible: Array, isExiting: (item) => boolean, dismiss: (item) => void }}
 */
export default function useFeedbackBuffer(items = [], { visibleCount, fetchMore } = {}) {
  const [removed, setRemoved] = useState(() => new Set())
  const [exiting, setExiting] = useState(() => new Set())
  const [listRef, setListRef] = useState(items)
  const timers = useRef(new Map())
  const fetchingRef = useRef(false)

  // A list identity change (a new page, a new seed item) resets the local state,
  // because a key removed from the previous list must not suppress an unrelated
  // item that happens to reuse it. Done during render rather than in an effect —
  // React's "adjusting state when a prop changes" pattern — so the reset does not
  // cost a second render pass with stale data painted in between.
  if (items !== listRef) {
    setListRef(items)
    if (removed.size) setRemoved(new Set())
    if (exiting.size) setExiting(new Set())
  }

  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
  }, [])

  // `filterDismissed` covers items dismissed earlier in the session, so a card
  // the user removed does not reappear when they navigate back before the
  // server-side pool refreshes.
  const surviving = useMemo(
    () => filterDismissed(items).filter((m) => !removed.has(keyOf(m))),
    [items, removed]
  )

  const visible = useMemo(
    () => (visibleCount ? surviving.slice(0, visibleCount) : surviving),
    [surviving, visibleCount]
  )

  const buffered = visibleCount ? Math.max(0, surviving.length - visibleCount) : 0

  useEffect(() => {
    if (!fetchMore || fetchingRef.current) return
    if (!visibleCount || buffered >= 3) return
    fetchingRef.current = true
    Promise.resolve(fetchMore())
      .catch(() => {})
      .finally(() => { fetchingRef.current = false })
  }, [fetchMore, visibleCount, buffered])

  const dismiss = useCallback((item) => {
    const key = keyOf(item)

    if (prefersReducedMotion()) {
      setRemoved((prev) => new Set(prev).add(key))
      return
    }

    setExiting((prev) => new Set(prev).add(key))
    // A timer rather than `transitionend`: BorderGlow wraps the card in its own
    // animated element, so the event can fire for the wrong property or not
    // bubble at all. A fixed delay matched to EXIT_MS is the reliable option.
    const timer = setTimeout(() => {
      setRemoved((prev) => new Set(prev).add(key))
      setExiting((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      timers.current.delete(key)
    }, EXIT_MS)
    timers.current.set(key, timer)
  }, [])

  const isExiting = useCallback((item) => exiting.has(keyOf(item)), [exiting])

  return { visible, isExiting, dismiss }
}
