import api from '../utils/api'

export const watchingTrackerService = {
  /**
   * Track a TV show.
   * @param {number} tvId 
   * @param {string|null} nextEpisodeDate ISO date string YYYY-MM-DD
   */
  async track(tvId, nextEpisodeDate = null) {
    const res = await api.post('/api/v1/watching-tracker/track', {
      tv_id: tvId,
      next_episode_date: nextEpisodeDate
    })
    return res.data
  },

  /**
   * Untrack a TV show.
   * @param {number} tvId 
   */
  async untrack(tvId) {
    const res = await api.post('/api/v1/watching-tracker/untrack', {
      tv_id: tvId
    })
    return res.data
  },

  /**
   * Get tracking status of a TV show.
   * @param {number} tvId 
   * @returns {Promise<{tracked: boolean, next_episode_date: string|null}>}
   */
  async getStatus(tvId) {
    const res = await api.get(`/api/v1/watching-tracker/status/${tvId}`)
    return res.data
  }
}
