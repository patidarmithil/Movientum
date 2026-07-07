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

  async getTaskStatus(jobId, taskName = '') {
    const { data } = await api.get(`${BASE}/tasks/status/${jobId}`, {
      params: { task_name: taskName }
    })
    return data
  },

  async getAdminAnalytics() {
    const { data } = await api.get(`${BASE}/analytics`)
    return data
  }
}
