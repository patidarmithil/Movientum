// Bounded in-memory cache to prevent memory leaks, holding up to 100 entries.
// Used to store page component states so they render instantly upon navigating back.
const cache = new Map()
const MAX_ENTRIES = 100
const keysOrder = []

export const pageCache = {
  get: (key) => cache.get(key),
  set: (key, value) => {
    if (!cache.has(key)) {
      keysOrder.push(key)
      if (keysOrder.length > MAX_ENTRIES) {
        const oldestKey = keysOrder.shift()
        cache.delete(oldestKey)
      }
    }
    cache.set(key, value)
  },
  delete: (key) => {
    cache.delete(key)
    const idx = keysOrder.indexOf(key)
    if (idx !== -1) keysOrder.splice(idx, 1)
  },
  clear: () => {
    cache.clear()
    keysOrder.length = 0
  }
}
