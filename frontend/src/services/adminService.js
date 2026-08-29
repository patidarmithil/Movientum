import api from '../utils/api'

const BASE = '/api/v1/admin'

export const adminService = {
  async getAdminStats() {
    const { data } = await api.get(`${BASE}/stats`)
    return data
  },

  async triggerTask(taskName) {
    const { data } = await api.post(`${BASE}/tasks/trigger`, { task_name: taskName })
    return data
  },

  async stopTask(jobId) {
    const { data } = await api.post(`${BASE}/tasks/stop/${jobId}`)
    return data
  },

  async getTaskStatus(jobId, taskName = '') {
    const { data } = await api.get(`${BASE}/tasks/status/${jobId}`, {
      params: { task_name: taskName }
    })
    return data
  },

  async getAdminAnalytics() {
    const { data } = await api.get(`${BASE}/analytics`)
    return data
  },

  async getContactMessages() {
    const { data } = await api.get('/api/v1/contact/')
    return data
  },

  async getUsers({ search = '', page = 1, pageSize = 25 } = {}) {
    const { data } = await api.get(`${BASE}/users`, { params: { search, page, page_size: pageSize } })
    return data
  },

  async deleteUser(userId) {
    const { data } = await api.delete(`${BASE}/users/${userId}`)
    return data
  },

  async setUserRole(userId, role) {
    const { data } = await api.patch(`${BASE}/users/${userId}/role`, { role })
    return data
  },

  async messageUser(userId, message) {
    const { data } = await api.post(`${BASE}/users/${userId}/message`, { message })
    return data
  }
}
