import { useEffect, useRef, useState } from 'react'
import { searchService } from '../services/searchService'

/**
 * Shared instant title search — same behaviour as the navbar SearchOverlay:
 * 250 ms debounce, 2-char minimum, abort of the in-flight request, and a small
 * TTL cache. The cache is module-level so a query typed in one place (overlay,
 * add-to-watchlist modal, /rec-content) is instant in the others.
 */
const CACHE_TTL = 5 * 60 * 1000
const CACHE_MAX = 50
const cache = new Map() // key → { at, data }

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return hit.data
}

function cacheSet(key, data) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value)
  cache.set(key, { at: Date.now(), data })
}

const isAbort = (err) => err?.name === 'CanceledError' || err?.name === 'AbortError'

/**
 * @param {string} query raw input value
 * @param {{ type?: 'content'|'person', debounceMs?: number, minLen?: number, limit?: number }} [opts]
 * @returns {{ results: object[], loading: boolean, error: string|null, active: boolean }}
 *   `active` is true once the trimmed query reaches `minLen`.
 */
export function useInstantSearch(query, { type = 'content', debounceMs = 250, minLen = 2, limit = 20 } = {}) {
  const q = (query || '').trim()
  const active = q.length >= minLen
  const key = `${type}_${q.toLowerCase()}`

  const [state, setState] = useState({ key: '', results: [], error: null })
  const abortRef = useRef(null)

  useEffect(() => {
    abortRef.current?.abort()
    if (!active) return undefined

    if (cacheGet(key)) return undefined // served from cache during render

    const timer = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller
      searchService
        .instantSearch(q, type, controller.signal)
        .then((data) => {
          const arr = (Array.isArray(data) ? data : data?.results || [])
            .filter((r) => type === 'person' || r.media_type !== 'person')
            .slice(0, limit)
          cacheSet(key, arr)
          if (!controller.signal.aborted) setState({ key, results: arr, error: null })
        })
        .catch((err) => {
          if (!isAbort(err) && !controller.signal.aborted) {
            setState({ key, results: [], error: 'Search failed. Try again.' })
          }
        })
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [key, active, q, type, debounceMs, limit])

  useEffect(() => () => abortRef.current?.abort(), [])

  const cached = active ? cacheGet(key) : null
  if (cached) return { active, results: cached, loading: false, error: null }

  const settled = state.key === key
  return {
    active,
    // Keep the previous results on screen while the next query loads — no flash.
    results: active ? state.results : [],
    loading: active && !settled,
    error: active && settled ? state.error : null,
  }
}

export default useInstantSearch
