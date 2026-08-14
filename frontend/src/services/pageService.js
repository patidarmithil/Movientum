/**
 * pageService.js — page bundle endpoints
 *
 * Each call below returns everything a page renders on mount in a single
 * request, served from a single Redis key on the backend (see
 * `backend/app/routers/pages.py`). Pages used to fire 3–6 parallel requests,
 * each of which was its own Redis read and, when cold, its own Redis write.
 *
 * The individual endpoints (`movieService`, `watchService`, …) still exist and
 * still work — use them for anything that happens *after* the initial render
 * (a filter change, a mutation, a refetch).
 */
import api from '../utils/api'

export const pageService = {
  /**
   * GET /api/v1/pages/home
   * → { trending, top_rated, upcoming, trailers }
   * Personalized recommendations are NOT part of this bundle (paginated + per-user).
   */
  getHome: ({ upcomingFilter = 'month', upcomingLimit = 8, country = 'all', region = null } = {}) =>
    api
      .get('/api/v1/pages/home', {
        params: {
          upcoming_filter: upcomingFilter,
          upcoming_limit: upcomingLimit,
          country,
          ...(region ? { region } : {}),
        },
      })
      .then((r) => r.data),

  /**
   * GET /api/v1/pages/movie/{id}
   * → { detail, videos, credits, collection, similar, distribution,
   *     watch_status, collections }
   * The last two are null for guests.
   */
  getMovie: (id) => api.get(`/api/v1/pages/movie/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/pages/tv/{id} — same shape as getMovie, plus `tracker`.
   */
  getTV: (id) => api.get(`/api/v1/pages/tv/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/pages/person/{id} → { detail, credits }
   */
  getPerson: (id) => api.get(`/api/v1/pages/person/${id}`).then((r) => r.data),

  /**
   * GET /api/v1/pages/dashboard → { history, collections, ratings }
   */
  getDashboard: () => api.get('/api/v1/pages/dashboard').then((r) => r.data),
}

export default pageService
