import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { newsFeedback, recFeedback } from '../services/feedbackService'
import './FeedbackControl.css'

/**
 * FeedbackControl — the one thumbs-up / thumbs-down control, used everywhere.
 *
 * Replaces three separate implementations: the inline overlay in MovieCard, the
 * private copy inside AIRecommendations, and nothing at all on news cards.
 *
 * Props:
 *   kind        'title' (movie/tv) | 'news'
 *   tmdbId      required for kind="title"
 *   mediaType   'movie' | 'tv'      (kind="title")
 *   articleId   required for kind="news"
 *   source      which surface this is, for interaction_log tagging
 *   value       'up' | 'down' | null — pass to control the state from outside
 *               (AIRecommendations drives it from its memoryMap)
 *   onChange    (next) => void, fired after the optimistic update
 *   onDismiss   () => void, called after a thumbs-down so the list can animate
 *               the card out and slide the next candidate in
 *
 * Guests see the control and are sent to login on press, rather than having it
 * hidden — an invisible control teaches nobody that the feature exists.
 *
 * Every handler stops propagation: MovieCard wraps the whole card in a <Link>
 * and NewsCard is itself a role="button" that opens the article in a new tab, so
 * without this a vote would also navigate.
 */
export default function FeedbackControl({
  kind = 'title',
  tmdbId,
  mediaType = 'movie',
  articleId,
  source = 'other',
  value,
  onChange,
  onDismiss,
}) {
  const { isLoggedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Uncontrolled unless `value` was passed.
  const [internal, setInternal] = useState(null)
  const state = value !== undefined ? value : internal

  const setState = useCallback(
    (next) => {
      if (value === undefined) setInternal(next)
      onChange?.(next)
    },
    [value, onChange]
  )

  const vote = useCallback(
    (direction, e) => {
      e.stopPropagation()
      e.preventDefault()

      if (!isLoggedIn) {
        navigate('/login', { state: { from: location.pathname } })
        return
      }

      // Pressing an already-active thumb retracts it. This matters most on
      // mobile, where the control is always visible and mis-taps are common.
      const isRetract = state === direction
      const next = isRetract ? null : direction

      // Optimistic: the icon fills before the request resolves. The service
      // never rejects, so there is nothing to revert — a failed signal is lost
      // rather than shown as an error.
      setState(next)

      if (kind === 'news') {
        if (isRetract) newsFeedback.undo(articleId, source)
        else if (direction === 'up') newsFeedback.up(articleId, source)
        else newsFeedback.down(articleId, source)

        if (!isRetract && direction === 'down') onDismiss?.()
        return
      }

      if (isRetract) {
        recFeedback.undo(tmdbId, mediaType, source)
        return
      }
      if (direction === 'up') {
        recFeedback.thumbsUp(tmdbId, mediaType, source)
        return
      }
      // A thumbs-down both teaches and dismisses: `onDismiss` removes the card
      // here, and the same signal writes a suppression row server-side so it
      // does not come back on the next rebuild.
      recFeedback.thumbsDown(tmdbId, mediaType, source, Boolean(onDismiss))
      onDismiss?.()
    },
    [
      isLoggedIn, navigate, location.pathname, state, setState,
      kind, articleId, tmdbId, mediaType, source, onDismiss,
    ]
  )

  return (
    <div
      className="movie-card__feedback-overlay"
      role="group"
      aria-label="Rate this recommendation"
      // A stray tap on the gradient strip must not open the card either.
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className={`movie-card__feedback-btn movie-card__feedback-btn--up${state === 'up' ? ' is-active' : ''}`}
        onClick={(e) => vote('up', e)}
        aria-pressed={state === 'up'}
        aria-label="More like this"
        title="More like this"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path>
        </svg>
      </button>
      <button
        type="button"
        className={`movie-card__feedback-btn movie-card__feedback-btn--down${state === 'down' ? ' is-active' : ''}`}
        onClick={(e) => vote('down', e)}
        aria-pressed={state === 'down'}
        aria-label="Not for me"
        title="Not for me"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {/* The second subpath used to start at x=22 and run to x=25, outside the
              24-wide viewBox, so it rendered as a clipped stray stroke next to the
              hand. These are the mirrored coordinates of the thumbs-up bracket. */}
          <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zM17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"></path>
        </svg>
      </button>
    </div>
  )
}
