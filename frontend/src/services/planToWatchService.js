import api from '../utils/api'
import { watchlistService } from './watchlistService'

export const planToWatchService = {
  getOrCreate: async () => {
    const data = await watchlistService.getCollections()
    const collections = data.collections || data.watchlists || data
    let existing = Array.isArray(collections) ? collections.find(c => c.name === "Plan to Watch") : null
    if (existing) return existing.id
    const created = await watchlistService.createCollection("Plan to Watch", "Auto-created list")
    return created.id
  },

  checkStatus: async (mediaId) => {
    try {
      const status = await watchlistService.getMovieStatus(mediaId)
      const collections = status.collections || []
      const planToWatch = collections.find(c => c.name === "Plan to Watch")
      return {
        inList: planToWatch ? planToWatch.has_movie : false,
        listId: planToWatch ? planToWatch.id : null
      }
    } catch {
      return { inList: false, listId: null }
    }
  },

  add: async (mediaId) => {
    const listId = await planToWatchService.getOrCreate()
    await watchlistService.addToCollection(listId, mediaId)
    return { listId }
  },

  remove: async (listId, mediaId) => {
    if (listId) {
      await watchlistService.removeFromCollection(listId, mediaId)
    }
  },

  getItemsWithDetails: async () => {
    try {
      const data = await watchlistService.getCollections()
      const collections = data.collections || data.watchlists || data
      const existing = Array.isArray(collections) ? collections.find(c => c.name === "Plan to Watch") : null
      if (!existing) return []

      const collectionData = await watchlistService.getCollection(existing.id)
      const items = collectionData.items || collectionData.movies || []

      const detailedItems = await Promise.all(items.map(async (item) => {
        try {
          const mediaType = item.movie?.media_type || 'movie'
          const movieId = item.movie_id
          
          let details = {}
          if (mediaType === 'tv') {
            const r = await api.get(`/api/v1/tv/${movieId}`)
            details = r.data
          } else {
            const r = await api.get(`/api/v1/movies/${movieId}`)
            details = r.data
          }
          
          return {
            ...item,
            movie: { ...item.movie, ...details }
          }
        } catch (e) {
          return item
        }
      }))
      
      return detailedItems
    } catch {
      return []
    }
  }
}
