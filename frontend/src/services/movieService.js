/**
 * movieService.js — API service layer (Phase 2C)
 * 
 * All movie API calls go through here.
 * Components never call api directly.
 * 
 * Phase 2C: 3 methods matching Phase 2B endpoints.
 * Phase 3+: add search, similar, genre-filtered endpoints.
 */
import api from '../utils/api'

export const movieService = {
  /**
   * GET /api/v1/movies — paginated list
   * @param {number} page
   * @param {number} limit
   * @returns {Promise<{ movies, total, page, limit }>}
   */
  getMovies: (page = 1, limit = 20) =>
    api.get('/api/v1/movies', { params: { page, limit } }).then((r) => r.data),

  /**
   * GET /api/v1/movies/{id} — full movie detail
   * @param {number|string} id
   * @returns {Promise<MovieDetail>}
   */
  getMovieById: (id) =>
    api.get(`/api/v1/movies/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/movies/trending — top 20 by score
   * @returns {Promise<{ movies }>}
   */
  getTrending: () =>
    api.get('/api/v1/movies/trending').then((r) => r.data),

  /**
   * GET /api/v1/movies?genre=&sort=&page=&limit=
   */
  getByGenre: (genre, page = 1, sort = 'popularity', limit = 20) =>
    api.get('/api/v1/movies', { params: { genre, page, sort, limit } }).then((r) => r.data),

  /**
   * GET /api/v1/recommendations/similar/{id} → top 10 similar movies
   */
  getSimilar: (id) =>
    api.get(`/api/v1/recommendations/similar/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/movies/genres → list of genre strings
   */
  getGenres: () =>
    api.get('/api/v1/movies/genres').then((r) => r.data),

  /**
   * GET /api/v1/movies/top_rated → top rated movies and tv
   */
  getTopRated: () =>
    api.get('/api/v1/movies/top_rated').then((r) => r.data),

  /**
   * GET /api/v1/movies/genre/{genre_id} → explore by genre ID
   */
  getMoviesByGenreId: (genreId) =>
    api.get(`/api/v1/movies/genre/${genreId}`).then((r) => r.data),

  /**
   * GET /api/v1/movies/upcoming?filter={week|month|year} → upcoming movies and tv
   */
  getUpcoming: (filter = 'month') =>
    api.get('/api/v1/movies/upcoming', { params: { filter } }).then((r) => r.data),
}

