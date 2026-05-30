import api from '../utils/api'

export const userService = {
  getAnalysis: async () => {
    const response = await api.get('/api/v1/users/me/analysis')
    return response.data
  }
}
