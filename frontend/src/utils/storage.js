/**
 * storage.js — Unified Storage Utility (Remember Me support)
 *
 * Modified to force localStorage for all authentication keys with a 2-day expiration
 * and sliding/rolling window logic, ensuring login persists on all browsers for 2 days.
 */

const KEYS = {
  access:   'mv_access_token',
  refresh:  'mv_refresh_token',
  user:     'mv_user',
  remember: 'mv_remember_me',
  expires:  'mv_login_expires_at',
}

export const storage = {
  /**
   * Determine the target storage mechanism.
   * Force localStorage to remember sessions across browser closures for 2 days.
   */
  getStorage() {
    return localStorage
  },

  /**
   * Reads a key from current storage, falling back to either storage if not found.
   * Enforces a 2-day session timeout and slides expiration if active.
   */
  getItem(key) {
    const expiresAt = localStorage.getItem(KEYS.expires)
    if (expiresAt) {
      if (Date.now() > parseInt(expiresAt, 10)) {
        // Expired! Clear session immediately.
        this.removeItem(KEYS.access)
        this.removeItem(KEYS.refresh)
        this.removeItem(KEYS.user)
        localStorage.removeItem(KEYS.expires)
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('mv:logout'))
        }
        return null
      } else {
        // Sliding window: user is active, slide expiration for another 2 days
        const newExpiresAt = Date.now() + 2 * 24 * 60 * 60 * 1000
        localStorage.setItem(KEYS.expires, newExpiresAt.toString())
      }
    }

    const current = this.getStorage()
    let value = current.getItem(key)
    if (!value) {
      value = sessionStorage.getItem(key) || localStorage.getItem(key)
    }
    return value
  },

  /**
   * Writes a key to current storage and updates 2-day expiration timestamp.
   */
  setItem(key, value) {
    this.getStorage().setItem(key, value)

    if (key === KEYS.access || key === KEYS.refresh || key === KEYS.user) {
      const expiresAt = Date.now() + 2 * 24 * 60 * 60 * 1000
      localStorage.setItem(KEYS.expires, expiresAt.toString())
    }
  },

  /**
   * Removes a key from both storage locations.
   */
  removeItem(key) {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
    if (key === KEYS.access || key === KEYS.refresh || key === KEYS.user) {
      localStorage.removeItem(KEYS.expires)
    }
  },

  /**
   * Set or clear the Remember Me preference flag in localStorage.
   */
  setRememberMe(enabled) {
    if (enabled) {
      localStorage.setItem(KEYS.remember, 'true')
    } else {
      localStorage.removeItem(KEYS.remember)
    }
  },

  /**
   * Check if Remember Me preference flag is enabled.
   */
  getRememberMe() {
    return localStorage.getItem(KEYS.remember) === 'true'
  }
}

export default storage
