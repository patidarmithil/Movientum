import api from '../utils/api'

export const getHomeTrailers = async (region = 'All') => {
  const params = region !== 'All' ? { region } : {}
  const response = await api.get('/api/v1/trailers/home', { params })
  return response.data
}
