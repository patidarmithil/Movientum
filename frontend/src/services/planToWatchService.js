import api from '../utils/api'
import { watchlistService } from './watchlistService'

export const planToWatchService = {
  // Single cached call for the home page rail — replaces getOrCreate() +
  // getItemsWithDetails() (2-3 requests) + one detail fetch per item (up to
  // 100 more) with the pre-filtered, server-side-cached "what's coming up"
  // list. Read-only: never creates the "Plan to Watch" collection.
  getHomeStrip: async () => {
    try {
      const r = await api.get('/api/v1/watchlists/home-strip')
      return r.data || { items: [], collection_id: null }
    } catch {
      return { items: [], collection_id: null }
    }
  },

  getOrCreate: async () => {
    const data = await watchlistService.getCollections()
    const collections = data.collections || data.watchlists || data
    let existing = Array.isArray(collections) ? collections.find(c => c.name === "Plan to Watch") : null
    if (existing) return existing.id
    const created = await watchlistService.createCollection("Plan to Watch", "Auto-created list")
    return created.id
  },

  checkStatus: async (mediaId, mediaType = "movie") => {
    try {
      const status = await watchlistService.getMovieStatus(mediaId, mediaType)
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

  add: async (mediaId, mediaType = "movie") => {
    const listId = await planToWatchService.getOrCreate()
    await watchlistService.addToCollection(listId, mediaId, mediaType)
    return { listId }
  },

  remove: async (listId, mediaId, mediaType = "movie") => {
    if (listId) {
      await watchlistService.removeFromCollection(listId, mediaId, mediaType)
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
