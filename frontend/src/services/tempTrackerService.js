import api from '../utils/api'

export const tempTrackerService = {
  add: (tvId) => api.post('/api/v1/temp-tracker', { tv_id: tvId }).then((r) => r.data),
  remove: (tvId) => api.delete(`/api/v1/temp-tracker/${tvId}`).then((r) => r.data),
  getAll: () => api.get('/api/v1/temp-tracker').then((r) => r.data),
}
