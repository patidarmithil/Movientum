import api from '../utils/api'

export const userService = {
  getAnalysis: async () => {
    const response = await api.get('/api/v1/users/me/analysis')
    return response.data
  },
  getRecExplanation: async () => {
    const response = await api.get('/api/v1/users/me/analysis/rec-explanation')
    return response.data
  },
  getDateRange: async () => {
    const response = await api.get('/api/v1/users/me/analysis/profile/date-range')
    return response.data
  },
  saveDateRange: async (date_from, date_to) => {
    const response = await api.post('/api/v1/users/me/analysis/profile/date-range', { date_from, date_to })
    return response.data
  },
  saveRecPreferences: async (prefs) => {
    const response = await api.patch('/api/v1/users/me/rec-preferences', prefs)
    return response.data
  },
  getTasteProfile: async () => {
    const response = await api.get('/api/v1/users/me/analysis/taste-profile')
    return response.data
  },
  saveTasteProfile: async (genreWeights, eraWeights) => {
    const body = {}
    if (genreWeights !== undefined) body.genre_weights = genreWeights
    if (eraWeights !== undefined) body.era_weights = eraWeights
    const response = await api.patch('/api/v1/users/me/analysis/taste-profile', body)
    return response.data
  }
}
