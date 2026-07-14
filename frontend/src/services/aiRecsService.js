/**
 * aiRecsService.js — AI Recommendations API layer (Phase 6)
 *
 * Wraps POST /api/v1/ai-recs/similar, POST /api/v1/ai-recs/memory, GET /api/v1/ai-recs/memory
 */
import api from '../utils/api'

export const aiRecsService = {
  /**
   * POST /api/v1/ai-recs/similar
   * Guest + logged-in. Returns AI-generated recommendations.
   *
   * @param {object} params
   * @param {number} params.seedTmdbId
   * @param {string} params.seedMediaType  'movie' | 'tv'
   * @param {string|null} params.focusGenre
   * @param {Array}  params.moreLike        [{ title, year, media_type }]
   * @param {Array}  params.previousIds     [tmdb_id, ...]
   * @param {number} params.rerunCount
   * @returns {Promise<AIRecSimilarResponse>}
   */
  getSimilar: ({ seedTmdbId, seedMediaType, focusGenre = null, moreLike = [], previousIds = [], rerunCount = 0 }) =>
    api.post('/api/v1/ai-recs/similar', {
      seed_tmdb_id:  seedTmdbId,
      seed_media_type: seedMediaType,
      focus_genre:   focusGenre,
      more_like:     moreLike,
      previous_ids:  previousIds,
      rerun_count:   rerunCount,
    }).then(r => r.data),

  /**
   * GET /api/v1/ai-recs/memory — requires auth
   * Returns { liked: [...], disliked: [...] }
   */
  getMemory: () =>
    api.get('/api/v1/ai-recs/memory').then(r => r.data),

  /**
   * POST /api/v1/ai-recs/memory — requires auth
   * Records a thumbs up/down signal for a recommendation.
   *
   * @param {object} params
   * @param {number} params.tmdbId
   * @param {string} params.mediaType  'movie' | 'tv'
   * @param {string} params.signal     'up' | 'down'
   * @param {string} params.title
   * @param {Array}  params.genres     string[]
   */
  recordMemory: ({ tmdbId, mediaType, signal, title, genres = [] }) =>
    api.post('/api/v1/ai-recs/memory', {
      tmdb_id:    tmdbId,
      media_type: mediaType,
      signal,
      title,
      genres,
    }).then(r => r.data),
}
