import api from '../utils/api'

export const notificationService = {
  /**
   * Get recent notifications.
   * @returns {Promise<Array>} Array of notification objects
   */
  async getNotifications() {
    const res = await api.get('/api/v1/notifications')
    return res.data
  },

  /**
   * Mark a specific notification as seen.
   * @param {number} id 
   */
  async markSeen(id) {
    const res = await api.post(`/api/v1/notifications/${id}/seen`)
    return res.data
  },

  /**
   * Mark all notifications as seen.
   */
  async markAllSeen() {
    const res = await api.post('/api/v1/notifications/mark_all_seen')
    return res.data
  }
}
