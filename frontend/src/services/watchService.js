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
  markWatched: (movieId, mediaType = "movie") =>
    api.post('/api/v1/watch', { movie_id: movieId, media_type: mediaType }).then((r) => r.data),

  /**
   * DELETE /api/v1/watch/{mediaType}/{movieId}
   */
  removeFromHistory: (movieId, mediaType = "movie") =>
    api.delete(`/api/v1/watch/${mediaType}/${movieId}`).then((r) => r.data),

  /**
   * GET /api/v1/watch/history — paginated watch history
   */
  getHistory: (page = 1, limit = 1500) =>
    api.get('/api/v1/watch/history', { params: { page, limit } }).then((r) => r.data),

  /**
   * POST /api/v1/watch/watchlist — add to watchlist
   */
  addToWatchlist: (movieId, mediaType = "movie") =>
    api.post('/api/v1/watch/watchlist', { movie_id: movieId, media_type: mediaType }).then((r) => r.data),

  /**
   * DELETE /api/v1/watch/watchlist/{mediaType}/{movieId}
   */
  removeFromWatchlist: (movieId, mediaType = "movie") =>
    api.delete(`/api/v1/watch/watchlist/${mediaType}/${movieId}`).then((r) => r.data),

  /**
   * GET /api/v1/watch/watchlist — get watchlist
   */
  getWatchlist: (page = 1, limit = 1500) =>
    api.get('/api/v1/watch/watchlist', { params: { page, limit } }).then((r) => r.data),

  /**
   * GET /api/v1/watch/status/{mediaType}/{movieId}
   * @returns {{ watched: bool, watchlisted: bool }}
   */
  getStatus: (movieId, mediaType = "movie") =>
    api.get(`/api/v1/watch/status/${mediaType}/${movieId}`).then((r) => r.data),
}
