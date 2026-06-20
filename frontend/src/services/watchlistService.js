import api from '../utils/api'

export const watchlistService = {
  /**
   * GET /api/v1/watchlists — list user collections
   */
  getCollections: () =>
    api.get('/api/v1/watchlists').then((r) => r.data),

  /**
   * POST /api/v1/watchlists — create collection
   */
  createCollection: (name, description) =>
    api.post('/api/v1/watchlists', { name, description }).then((r) => r.data),

  /**
   * GET /api/v1/watchlists/movie/{movieId}/status — which collections contain this movie
   */
  getMovieStatus: (movieId) =>
    api.get(`/api/v1/watchlists/movie/${movieId}/status`).then((r) => r.data),

  /**
   * GET /api/v1/watchlists/{collectionId} — collection detail + items
   */
  getCollection: (collectionId, page = 1, limit = 100) =>
    api.get(`/api/v1/watchlists/${collectionId}`, { params: { page, limit } }).then((r) => r.data),

  /**
   * PATCH /api/v1/watchlists/{collectionId} — update name/description
   */
  updateCollection: (collectionId, name, description) =>
    api.patch(`/api/v1/watchlists/${collectionId}`, { name, description }).then((r) => r.data),

  /**
   * DELETE /api/v1/watchlists/{collectionId} — delete collection
   */
  deleteCollection: (collectionId) =>
    api.delete(`/api/v1/watchlists/${collectionId}`).then((r) => r.data),

  /**
   * POST /api/v1/watchlists/{collectionId}/items — add movie
   */
  addToCollection: (collectionId, movieId) =>
    api.post(`/api/v1/watchlists/${collectionId}/items`, { movie_id: movieId }).then((r) => r.data),

  /**
   * DELETE /api/v1/watchlists/{collectionId}/items/{movieId} — remove movie
   */
  removeFromCollection: (collectionId, movieId) =>
    api.delete(`/api/v1/watchlists/${collectionId}/items/${movieId}`).then((r) => r.data),
}
