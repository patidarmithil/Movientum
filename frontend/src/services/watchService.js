/**
 * watchService.js — Phase 3.5C
 *
 * Watch history + Watchlist API calls.
 */
import api from '../utils/api'

export const watchService = {
  /**
   * POST /api/v1/watch — mark movie watched
   */
  markWatched: (movieId) =>
    api.post('/api/v1/watch', { movie_id: movieId }).then((r) => r.data),

  /**
   * DELETE /api/v1/watch/{movieId}
   */
  removeFromHistory: (movieId) =>
    api.delete(`/api/v1/watch/${movieId}`).then((r) => r.data),

  /**
   * GET /api/v1/watch/history — paginated watch history
   */
  getHistory: (page = 1, limit = 20) =>
    api.get('/api/v1/watch/history', { params: { page, limit } }).then((r) => r.data),

  /**
   * POST /api/v1/watch/watchlist — add to watchlist
   */
  addToWatchlist: (movieId) =>
    api.post('/api/v1/watch/watchlist', { movie_id: movieId }).then((r) => r.data),

  /**
   * DELETE /api/v1/watch/watchlist/{movieId}
   */
  removeFromWatchlist: (movieId) =>
    api.delete(`/api/v1/watch/watchlist/${movieId}`).then((r) => r.data),

  /**
   * GET /api/v1/watch/watchlist — get watchlist
   */
  getWatchlist: (page = 1, limit = 20) =>
    api.get('/api/v1/watch/watchlist', { params: { page, limit } }).then((r) => r.data),

  /**
   * GET /api/v1/watch/status/{movieId}
   * @returns {{ watched: bool, watchlisted: bool }}
   */
  getStatus: (movieId) =>
    api.get(`/api/v1/watch/status/${movieId}`).then((r) => r.data),
}
