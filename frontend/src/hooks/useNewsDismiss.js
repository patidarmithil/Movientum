import { useCallback, useEffect, useRef, useState } from 'react'

/** Matches the `.news-card.is-exiting` transition in NewsCard.css. */
const EXIT_MS = 200

/** Session-wide, so an article dismissed on /news stays gone on the Home strip. */
const hiddenIds = new Set()

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * useNewsDismiss — hide-and-replace for news cards.
 *
 * Separate from `useFeedbackBuffer` because a news article is keyed by a string
 * id (a sha256 of its URL), not by the `media_type:tmdb_id` pair that hook uses.
 *
 * The hidden set is module-level rather than per-component: the same article
 * appears on /news, in the Home strip and on a detail page's rail, and dismissing
 * it in one place should remove it from all three without a refetch. The server
 * also hides it, but its ranked ordering is cached for 10 minutes.
 *
 * @returns {{ exitingIds: Set<string>, dismissArticle: (id: string) => void,
 *             isHidden: (id: string) => boolean, filterHidden: (a: Array) => Array }}
 */
export default function useNewsDismiss() {
  const [exitingIds, setExitingIds] = useState(() => new Set())
  // Bumped when the module-level hidden set changes, so a component re-renders
  // and re-runs its filter.
  const [, bump] = useState(0)
  const timers = useRef(new Map())

  useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
  }, [])

  const hide = useCallback((id) => {
    hiddenIds.add(id)
    setExitingIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
    timers.current.delete(id)
    bump((n) => n + 1)
  }, [])

  const dismissArticle = useCallback((id) => {
    if (!id || hiddenIds.has(id)) return

    if (prefersReducedMotion()) {
      hide(id)
      return
    }

    setExitingIds((prev) => new Set(prev).add(id))
    // A timer rather than `transitionend`: the card is wrapped in BorderGlow,
    // which animates its own properties, so the event is not reliable here.
    timers.current.set(id, setTimeout(() => hide(id), EXIT_MS))
  }, [hide])

  const isHidden = useCallback((id) => hiddenIds.has(id), [])

  const filterHidden = useCallback(
    (articles = []) =>
      hiddenIds.size === 0 ? articles : articles.filter((a) => !hiddenIds.has(a?.id)),
    []
  )

  return { exitingIds, dismissArticle, isHidden, filterHidden }
}
