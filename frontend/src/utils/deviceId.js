const DEVICE_KEY = 'mv_device_id'

export function getOrCreateDeviceId() {
  try {
    const stored = localStorage.getItem(DEVICE_KEY)
    if (stored) return stored
    const id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
    return id
  } catch {
    // Private window or localStorage blocked
    return null
  }
}

export function getDeviceId() {
  try { return localStorage.getItem(DEVICE_KEY) } catch { return null }
}

export function clearDeviceId() {
  try { localStorage.removeItem(DEVICE_KEY) } catch { /* ignore */ }
}
