/**
 * searchService.js — Search API service (Phase 3.5B)
 *
 * search(query, page)    → { results: [...], total, page, pages }
 * autocomplete(prefix)   → [{ id, title, release_year, poster_path }, ...]  max 8
 */
import api from '../utils/api'

const BASE = '/api/v1/search'

export const searchService = {
  /**
   * Full-text search with pagination.
   * @param {string} query
   * @param {number} page   default 1
   * @param {string} search_type  default 'content'
   * @returns {Promise<{results: Array, total: number, page: number, pages: number}>}
   */
  search: (query, page = 1, search_type = 'content', signal) =>
    api
      .get(BASE, { params: { q: query, page, type: search_type }, signal })
      .then((r) => r.data.data),

  /**
   * Autocomplete — top 8 matches (cached server-side 5 min).
   * @param {string} prefix  must be >= 2 chars before calling
   * @param {string} search_type  default 'content'
   * @returns {Promise<Array>}
   */
  autocomplete: (prefix, search_type = 'content', signal) =>
    api
      .get(`${BASE}/autocomplete`, { params: { q: prefix, type: search_type }, signal })
      .then((r) => r.data.data),

  /**
   * Instant search — top 20 matches.
   * @param {string} query
   * @param {string} search_type  default 'content'
   * @returns {Promise<Array>}
   */
  instantSearch: (query, search_type = 'content', signal) =>
    api
      .get(`${BASE}/instant`, { params: { q: query, type: search_type }, signal })
      .then((r) => r.data.data),

  /**
   * Browse by genre (no text query).
   * @param {string} genre  e.g. "Action"
   * @param {number} page
   */
  searchByGenre: (genre, page = 1, signal) =>
    api
      .get(BASE, { params: { genre, page }, signal })
      .then((r) => r.data.data),

  /**
   * Request content that is missing.
   * @param {string} title
   * @param {string} contentType Movie | TV Show
   */
  requestContent: (title, contentType) =>
    api.post('/api/v1/requests', { title, content_type: contentType })
}
