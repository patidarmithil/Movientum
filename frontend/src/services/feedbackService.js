/**
 * Movientum — Recommendation Feedback Service
 *
 * The single client for every thumbs-up / thumbs-down / click signal, from every
 * surface that shows platform-generated recommendations, plus news feedback.
 *
 * Three things this file is careful about:
 *
 * 1. It goes through the shared axios instance. It used to hand-roll `fetch`
 *    against VITE_API_URL with a manually attached token, which meant it missed
 *    the 401 -> refresh -> retry queue, the 120 s timeout Azure cold starts need,
 *    the VITE_API_URL_SECONDARY failover, and the crawler block.
 *
 * 2. Clicks are batched. A click signal now fires from ~10 carousels instead of
 *    2, so sending one request per card would multiply traffic on a free tier.
 *    Explicit thumbs still go immediately — the user is watching for an effect.
 *
 * 3. Dismissed items are remembered locally, so a card the user removed does not
 *    reappear when they navigate back before the server-side pool refreshes.
 *
 * Every call resolves. A lost analytics signal must never surface as an error.
 */
import api from '../utils/api'
import { storage } from './../utils/storage'

const BASE = '/api/v1/rec-feedback'
const NEWS_BASE = '/api/v1/news'

const FLUSH_MS = 2000
const MAX_BATCH = 20                       // matches the endpoint's limit
const DISMISSED_KEY = 'mv_dismissed_recs'

/** Logged-in check. Tokens are only ever read through the storage wrapper. */
const isAuthed = () => Boolean(storage.getItem('mv_access_token'))

// ── Local dismissal echo ──────────────────────────────────────────

const dismissed = new Set()

try {
  const raw = sessionStorage.getItem(DISMISSED_KEY)
  if (raw) JSON.parse(raw).forEach((k) => dismissed.add(k))
} catch {
  // Private mode / blocked storage — the set just starts empty.
}

const itemKey = (tmdbId, mediaType = 'movie') => `${mediaType}:${tmdbId}`

function persistDismissed() {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissed]))
  } catch {
    // Non-fatal: the in-memory set still works for this page.
  }
}

/** True when the user has dismissed this item in this session. */
export function isDismissed(tmdbId, mediaType = 'movie') {
  return dismissed.has(itemKey(tmdbId, mediaType))
}

/** Drop items the user has already dismissed out of a list before rendering it. */
export function filterDismissed(items = []) {
  if (dismissed.size === 0) return items
  return items.filter(
    (m) => !isDismissed(m?.tmdb_id ?? m?.id, m?.media_type || 'movie')
  )
}

// ── Queue ─────────────────────────────────────────────────────────

/**
 * Keyed by signal + item, so a double-tap or a re-render collapses to one row
 * rather than teaching the model the same thing twice.
 */
const queue = new Map()
let flushTimer = null

function enqueue(signal, { immediate = false } = {}) {
  const key = `${signal.signal_type}:${signal.media_type}:${signal.tmdb_id}`
  queue.set(key, signal)

  if (immediate || queue.size >= MAX_BATCH) {
    flush()
    return
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_MS)
  }
}

async function flush() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (queue.size === 0) return

  const signals = [...queue.values()].slice(0, MAX_BATCH)
  signals.forEach((s) =>
    queue.delete(`${s.signal_type}:${s.media_type}:${s.tmdb_id}`)
  )

  try {
    await api.post(`${BASE}/batch`, { signals })
  } catch {
    // Fire-and-forget. Re-queueing a failed batch risks an endless retry loop
    // against a cold backend, which is worse than losing a click.
  }

  // Anything that arrived while the request was in flight.
  if (queue.size > 0 && flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_MS)
  }
}

if (typeof window !== 'undefined') {
  // `pagehide` fires on navigation and on mobile backgrounding, where
  // `beforeunload` does not.
  window.addEventListener('pagehide', () => { flush() })
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Send one recommendation signal.
 *
 * @param {object}  params
 * @param {number}  params.tmdbId
 * @param {string}  params.mediaType  "movie" | "tv"
 * @param {string}  params.signalType "thumbs_up" | "thumbs_down" | "click" | "undo"
 * @param {string}  params.source     which surface sent it — see VALID_SOURCES
 *                                    in the backend schema; a new carousel gets
 *                                    its own value rather than reusing "other"
 * @param {boolean} params.dismiss    true when the card was removed from a
 *                                    recommendation surface, so the item should
 *                                    also be suppressed from future results
 * @returns {Promise<void>} always resolves
 */
export async function sendRecSignal({
  tmdbId,
  mediaType = 'movie',
  signalType,
  source = 'other',
  dismiss = false,
}) {
  if (!isAuthed() || !tmdbId) return

  const key = itemKey(tmdbId, mediaType)
  if (dismiss) {
    dismissed.add(key)
    persistDismissed()
  } else if (signalType === 'undo') {
    dismissed.delete(key)
    persistDismissed()
  }

  enqueue(
    {
      tmdb_id: tmdbId,
      media_type: mediaType,
      signal_type: signalType,
      source,
      dismiss,
    },
    // An explicit vote goes now; a click can wait for the batch window.
    { immediate: signalType !== 'click' }
  )
}

export const recFeedback = {
  thumbsUp: (tmdbId, mediaType, source = 'other') =>
    sendRecSignal({ tmdbId, mediaType, signalType: 'thumbs_up', source }),

  /** `dismiss` defaults to true: a thumbs-down on a rec card removes it. */
  thumbsDown: (tmdbId, mediaType, source = 'other', dismiss = true) =>
    sendRecSignal({ tmdbId, mediaType, signalType: 'thumbs_down', source, dismiss }),

  undo: (tmdbId, mediaType, source = 'other') =>
    sendRecSignal({ tmdbId, mediaType, signalType: 'undo', source }),

  click: (tmdbId, mediaType, source = 'other') =>
    sendRecSignal({ tmdbId, mediaType, signalType: 'click', source }),

  flush,
  isDismissed,
  filterDismissed,
}

// ── News ──────────────────────────────────────────────────────────

/**
 * Thumbs on a news article. News-scoped: it moves the user's source / category /
 * entity weights for the For-You news ranking and never touches the movie/TV
 * taste profile. Not batched — presses are rarer and the article id is in the
 * path, so there is nothing to coalesce.
 */
export async function sendNewsSignal({ articleId, signal, source = 'news_grid' }) {
  if (!isAuthed() || !articleId) return
  try {
    await api.post(`${NEWS_BASE}/article/${articleId}/feedback`, { signal, source })
  } catch {
    // Fire-and-forget, as above.
  }
}

export const newsFeedback = {
  up: (articleId, source) => sendNewsSignal({ articleId, signal: 'up', source }),
  down: (articleId, source) => sendNewsSignal({ articleId, signal: 'down', source }),
  undo: (articleId, source) => sendNewsSignal({ articleId, signal: 'undo', source }),
}

export default recFeedback
