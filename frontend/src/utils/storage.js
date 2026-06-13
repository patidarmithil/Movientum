/**
 * storage.js — Unified Storage Utility (Remember Me support)
 *
 * Dynamically routes read/write operations between localStorage and sessionStorage
 * based on whether 'Remember me' was selected during login.
 */

const KEYS = {
  access:   'mv_access_token',
  refresh:  'mv_refresh_token',
  user:     'mv_user',
  remember: 'mv_remember_me',
}

export const storage = {
  /**
   * Determine the target storage mechanism.
   * If Remember Me is true, use localStorage; otherwise sessionStorage.
   */
  getStorage() {
    const remember = localStorage.getItem(KEYS.remember) === 'true'
    return remember ? localStorage : sessionStorage
  },

  /**
   * Reads a key from current storage, falling back to either storage if not found.
   */
  getItem(key) {
    const current = this.getStorage()
    let value = current.getItem(key)
    if (!value) {
      value = sessionStorage.getItem(key) || localStorage.getItem(key)
    }
    return value
  },

  /**
   * Writes a key to current storage.
   */
  setItem(key, value) {
    this.getStorage().setItem(key, value)
  },

  /**
   * Removes a key from both storage locations.
   */
  removeItem(key) {
    sessionStorage.removeItem(key)
    localStorage.removeItem(key)
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
