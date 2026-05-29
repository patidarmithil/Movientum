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
   * @returns {Promise<{results: Array, total: number, page: number, pages: number}>}
   */
  search: (query, page = 1) =>
    api
      .get(BASE, { params: { q: query, page } })
      .then((r) => r.data.data),

  /**
   * Autocomplete — top 8 title matches (cached server-side 5 min).
   * @param {string} prefix  must be >= 2 chars before calling
   * @returns {Promise<Array<{id, title, release_year, poster_path}>>}
   */
  autocomplete: (prefix) =>
    api
      .get(`${BASE}/autocomplete`, { params: { q: prefix } })
      .then((r) => r.data.data),

  /**
   * Browse by genre (no text query).
   * @param {string} genre  e.g. "Action"
   * @param {number} page
   */
  searchByGenre: (genre, page = 1) =>
    api
      .get(BASE, { params: { genre, page } })
      .then((r) => r.data.data),
}
