/**
 * ratingService.js — Phase 3.5C
 *
 * Category enum: skip | timepass | go_for_it | perfection
 */
import api from '../utils/api'

const MOCKED_RATINGS = {
  27205: { total: 6888, perfection: 88.2, go_for_it: 11.54, timepass: 0.23, skip: 0.03 }, // inception-2010
  157336: { total: 9869, perfection: 95.74, go_for_it: 3.93, timepass: 0.23, skip: 0.09 }, // interstellar-2014
  155: { total: 6978, perfection: 94.5, go_for_it: 5.23, timepass: 0.26, skip: 0.01 }, // the-dark-knight-2008
  19995: { total: 4254, perfection: 50.07, go_for_it: 48.03, timepass: 1.79, skip: 0.12 }, // avatar-2009
  24428: { total: 5476, perfection: 79.97, go_for_it: 19.8, timepass: 0.22, skip: 0.02 }, // the-avengers-2012
  293660: { total: 2948, perfection: 30.02, go_for_it: 69.37, timepass: 0.61, skip: 0 }, // deadpool-2016
  299536: { total: 8667, perfection: 96.83, go_for_it: 2.95, timepass: 0.14, skip: 0.08 }, // avengers-infinity-war-2018
  550: { total: 6145, perfection: 88.3, go_for_it: 10.66, timepass: 0.75, skip: 0.29 }, // fight-club-1999
  118340: { total: 3243, perfection: 30.77, go_for_it: 67.87, timepass: 1.33, skip: 0.03 }, // guardians-of-the-galaxy-2014
  680: { total: 1379, perfection: 43.87, go_for_it: 49.53, timepass: 5.15, skip: 1.45 }, // pulp-fiction-1994
  13: { total: 1654, perfection: 82.59, go_for_it: 15.9, timepass: 1.27, skip: 0.24 }, // forrest-gump-1994
  1726: { total: 5451, perfection: 84.33, go_for_it: 15.39, timepass: 0.26, skip: 0.02 }, // iron-man-2008
  68718: { total: 2209, perfection: 65.41, go_for_it: 33.18, timepass: 1.31, skip: 0.09 }, // django-unchained-2012
}

export const ratingService = {
  /**
   * POST /api/v1/ratings — upsert rating (one per user per movie)
   * @param {number} movieId
   * @param {string} mediaType
   * @param {'skip'|'timepass'|'go_for_it'|'perfection'} category
   */
  submitRating: (movieId, mediaType, category) =>
    api.post('/api/v1/ratings', { movie_id: movieId, media_type: mediaType, category }).then((r) => r.data),

  /**
   * GET /api/v1/ratings/distribution/{mediaType}/{movieId}
   * @returns {{ skip, timepass, go_for_it, perfection, total }}
   */
  getDistribution: (movieId, mediaType = "movie") => {
    const numericId = Number(movieId)
    const mock = MOCKED_RATINGS[numericId]
    if (mock && mediaType === "movie") {
      const perfection = Math.round((mock.perfection / 100) * mock.total)
      const go_for_it = Math.round((mock.go_for_it / 100) * mock.total)
      const timepass = Math.round((mock.timepass / 100) * mock.total)
      const skip = mock.total - (perfection + go_for_it + timepass)
      return Promise.resolve({
        perfection,
        go_for_it,
        timepass,
        skip,
        total: mock.total,
      })
    }
    return api.get(`/api/v1/ratings/distribution/${mediaType}/${movieId}`).then((r) => r.data)
  },

  /**
   * GET /api/v1/ratings/me — paginated list of user's ratings
   */
  getMyRatings: (page = 1, limit = 1500) =>
    api.get('/api/v1/ratings/me', { params: { page, limit } }).then((r) => r.data),

  /**
   * DELETE /api/v1/ratings/{id}
   */
  deleteRating: (id) =>
    api.delete(`/api/v1/ratings/${id}`).then((r) => r.data),

  /**
   * PUT /api/v1/ratings/{id}
   */
  updateRating: (id, category) =>
    api.put(`/api/v1/ratings/${id}`, { category }).then((r) => r.data),

  /**
   * POST /api/v1/ratings/needed — request rating for missing Moctale content
   */
  requestRatingNeeded: (id, title, content, year) =>
    api.post('/api/v1/ratings/needed', { id, title, content, year }).then((r) => r.data),
}
