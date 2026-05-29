/**
 * ratingService.js — Phase 3.5C
 *
 * Category enum: skip | timepass | go_for_it | perfection
 */
import api from '../utils/api'

export const ratingService = {
  /**
   * POST /api/v1/ratings — upsert rating (one per user per movie)
   * @param {number} movieId
   * @param {'skip'|'timepass'|'go_for_it'|'perfection'} category
   */
  submitRating: (movieId, category) =>
    api.post('/api/v1/ratings', { movie_id: movieId, category }).then((r) => r.data),

  /**
   * GET /api/v1/ratings/distribution/{movieId}
   * @returns {{ skip, timepass, go_for_it, perfection, total }}
   */
  getDistribution: (movieId) =>
    api.get(`/api/v1/ratings/distribution/${movieId}`).then((r) => r.data),

  /**
   * GET /api/v1/ratings/me — paginated list of user's ratings
   */
  getMyRatings: (page = 1, limit = 20) =>
    api.get('/api/v1/ratings/me', { params: { page, limit } }).then((r) => r.data),

  /**
   * DELETE /api/v1/ratings/{id}
   */
  deleteRating: (id) =>
    api.delete(`/api/v1/ratings/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/ratings/{id}
   */
  updateRating: (id, category) =>
    api.put(`/api/v1/ratings/${id}`, { category }).then((r) => r.data),
}
