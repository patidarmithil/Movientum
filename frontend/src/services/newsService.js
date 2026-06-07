/**
 * newsService.js — News API service layer
 *
 * Wraps all /api/v1/news/* endpoints.
 * Works for both movies (/movie/{id}) and TV (/tv/{id} → same endpoint, TV IDs stored in movies table).
 */
import api from '../utils/api'

const BASE = '/api/v1/news'

export const newsService = {
  /**
   * GET /feed/for-you — personalized (auth required)
   */
  async getForYou(page = 1, pageSize = 12) {
    const { data } = await api.get(`${BASE}/feed/for-you`, {
      params: { page, page_size: pageSize },
    })
    return data
  },

  async getLatest(page = 1, pageSize = 12) {
    const { data } = await api.get(`${BASE}/feed/latest`, {
      params: { page, page_size: pageSize },
    })
    return data
  },

  recordView(articleId) {
  },
}
