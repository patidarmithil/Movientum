import api from '../utils/api'

/**
 * Tier list API wrappers.
 *
 * Templates are public; everything under /mine and /{id} needs a logged-in user.
 * The share endpoint is deliberately unauthenticated so a link works for anyone.
 */
export const tierListService = {
  /** GET /api/v1/tierlist/templates — categories + template metadata, no items. */
  getTemplates: () => api.get('/api/v1/tierlist/templates').then((r) => r.data),

  /** GET /api/v1/tierlist/templates/{slug} — the template plus its resolved items. */
  getTemplate: (slug) =>
    api.get(`/api/v1/tierlist/templates/${encodeURIComponent(slug)}`).then((r) => r.data),

  /** GET /api/v1/tierlist/mine — the signed-in user's saved boards. */
  getMine: () => api.get('/api/v1/tierlist/mine').then((r) => r.data),

  /** POST /api/v1/tierlist — save a new board, returns it with its share id. */
  create: (payload) => api.post('/api/v1/tierlist', payload).then((r) => r.data),

  /** GET /api/v1/tierlist/{id} — owner read. */
  get: (id) => api.get(`/api/v1/tierlist/${id}`).then((r) => r.data),

  /** PUT /api/v1/tierlist/{id} — overwrite a saved board. */
  update: (id, payload) => api.put(`/api/v1/tierlist/${id}`, payload).then((r) => r.data),

  /** DELETE /api/v1/tierlist/{id} */
  remove: (id) => api.delete(`/api/v1/tierlist/${id}`).then((r) => r.data),

  /** GET /api/v1/tierlist/share/{shareId} — public read, no auth. */
  getShared: (shareId) =>
    api.get(`/api/v1/tierlist/share/${encodeURIComponent(shareId)}`).then((r) => r.data),
}

export default tierListService
