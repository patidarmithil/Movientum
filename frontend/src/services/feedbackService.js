/**
 * Movientum — Recommendation Feedback Service (Phase 6)
 *
 * Thin API wrapper for POST /api/v1/rec-feedback/
 * Used by MovieCard to send thumbs-up, thumbs-down, and click signals.
 *
 * All calls are fire-and-forget — errors are silently swallowed so they never
 * break the user experience.
 */

import { storage } from '../utils/storage'

const BASE_URL = import.meta.env.VITE_API_URL || ''

/**
 * Sends a recommendation signal to the backend.
 *
 * @param {object} params
 * @param {number}  params.tmdbId         - TMDB item ID
 * @param {string}  params.mediaType      - "movie" | "tv"
 * @param {string}  params.signalType     - "thumbs_up" | "thumbs_down" | "click"
 * @param {string}  params.source         - Which UI surface sent it: "more_like_this" |
 *                                          "for_you" | "ai_recommendations" | "other"
 * @param {object?} params.featureSnapshot - Optional 16-dim feature dict (from Phase 4)
 * @returns {Promise<void>}               - Always resolves, never rejects
 */
export async function sendRecSignal({ tmdbId, mediaType = 'movie', signalType, source = 'other', featureSnapshot = {} }) {
  try {
    const token = storage.getItem('mv_access_token')
    if (!token) return  // anonymous users — skip

    await fetch(`${BASE_URL}/api/v1/rec-feedback/`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        tmdb_id:          tmdbId,
        media_type:       mediaType,
        signal_type:      signalType,
        source,
        feature_snapshot: featureSnapshot,
      }),
    })
  } catch {
    // Fire-and-forget: never surface errors to the user
  }
}

/**
 * Convenience wrappers for each signal type. `source` tags which UI surface
 * sent the signal (see sendRecSignal) so interaction_log/analytics can tell
 * "More Like This" thumbs apart from "For You" or "AI Recommendations".
 */
export const recFeedback = {
  thumbsUp:   (tmdbId, mediaType, source = 'other') => sendRecSignal({ tmdbId, mediaType, signalType: 'thumbs_up', source }),
  thumbsDown: (tmdbId, mediaType, source = 'other') => sendRecSignal({ tmdbId, mediaType, signalType: 'thumbs_down', source }),
  click:      (tmdbId, mediaType, source = 'other') => sendRecSignal({ tmdbId, mediaType, signalType: 'click', source }),
}

export default recFeedback
