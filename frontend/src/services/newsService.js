/**
 * newsService.js — News API service layer (v2)
 *
 * Wraps the unified /api/v1/news/feed endpoint plus categories/search/saved/
 * for-title/view/save. Old method names are kept as one-line aliases so other
 * call sites don't need to change during the transition.
 */
import api from '../utils/api'

const BASE = '/api/v1/news'

export const newsService = {
  /**
   * GET /feed — unified feed. tab ∈ 'latest' | 'for-you' | 'editorial' | 'trending'.
   * Pass `category` to filter by a taxonomy category regardless of tab.
   */
  async getFeed({ tab = 'latest', category, page = 1, pageSize = 12 } = {}) {
    const { data } = await api.get(`${BASE}/feed`, {
      params: { tab, category, page, page_size: pageSize },
    })
    return data
  },

  async getCategories() {
    const { data } = await api.get(`${BASE}/categories`)
    return data
  },

  async search(q, page = 1, pageSize = 12) {
    const { data } = await api.get(`${BASE}/search`, {
      params: { q, page, page_size: pageSize },
    })
    return data
  },

  async getForTitle(mediaType, tmdbId, page = 1, pageSize = 10) {
    const { data } = await api.get(`${BASE}/for-title/${mediaType}/${tmdbId}`, {
      params: { page, page_size: pageSize },
    })
    return data
  },

  async getSaved(page = 1, pageSize = 12) {
    const { data } = await api.get(`${BASE}/saved`, {
      params: { page, page_size: pageSize },
    })
    return data
  },

  save(articleId) {
    return api.post(`${BASE}/article/${articleId}/save`).then((r) => r.data)
  },

  unsave(articleId) {
    return api.delete(`${BASE}/article/${articleId}/save`).then((r) => r.data)
  },

  recordView(articleId) {
    return api.post(`${BASE}/article/${articleId}/view`).catch(() => {})
  },

  async getStatus() {
    const { data } = await api.get(`${BASE}/status`)
    return data
  },

  // ── v1 aliases, kept during the transition ──────────────────────
  getForYou: (page = 1, pageSize = 12) => newsService.getFeed({ tab: 'for-you', page, pageSize }),
  getLatest: (page = 1, pageSize = 12) => newsService.getFeed({ tab: 'latest', page, pageSize }),
  getEditorialPicks: (page = 1, pageSize = 12) => newsService.getFeed({ tab: 'editorial', page, pageSize }),
  getByCategory: (category, page = 1, pageSize = 12) => newsService.getFeed({ tab: 'latest', category, page, pageSize }),
  getForItem: (itemId, mediaType = 'movie') => newsService.getForTitle(mediaType, itemId),
}
