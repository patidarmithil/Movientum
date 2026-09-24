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

/**
 * Hand over the bundle request index.html started before the JS loaded, once,
 * if it is for this title. Returns null when there is none (in-app navigation,
 * another title, already consumed).
 */
const takeEarlyPage = (mediaType, id) => {
  if (typeof window === 'undefined') return null
  const early = window.__mvEarlyPage
  if (!early || early.key !== `${mediaType}:${id}`) return null
  window.__mvEarlyPage = null
  return early.promise
}

const getDetailBundle = (mediaType, id) => {
  const request = () => api.get(`/api/v1/pages/${mediaType}/${id}`).then((r) => r.data)
  const early = takeEarlyPage(mediaType, id)
  // Any early failure (401, 5xx, network) retries through api.js, which owns
  // the token refresh and the secondary-backend failover.
  return early ? early.catch(request) : request()
}

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
  getMovie: (id) => getDetailBundle('movie', id),

  /**
   * GET /api/v1/pages/tv/{id} — same shape as getMovie, plus `tracker`.
   */
  getTV: (id) => getDetailBundle('tv', id),

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
