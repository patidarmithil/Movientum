/**
 * AuthContext.jsx — Global auth state (Phase 3.5A)
 *
 * State: { user, accessToken, isLoggedIn, isLoading }
 * Methods: login(), register(), logout(), refreshToken()
 *
 * On mount: reads sessionStorage → validates token → restores session.
 * Token storage keys:
 *   sessionStorage: 'mv_access_token', 'mv_refresh_token', 'mv_user'
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { authService } from '../services/authService'
import { storage } from '../utils/storage'
import { getOrCreateDeviceId, getDeviceId } from '../utils/deviceId'

const AuthContext = createContext(null)

const KEYS = {
  access:  'mv_access_token',
  refresh: 'mv_refresh_token',
  user:    'mv_user',
}

const REFRESH_LOCK_KEY = 'mv_refreshing'
const REFRESH_LOCK_TTL_MS = 5000  // 5 seconds max for a refresh cycle

function acquireRefreshLock() {
  try {
    const existing = localStorage.getItem(REFRESH_LOCK_KEY)
    if (existing && Date.now() - parseInt(existing, 10) < REFRESH_LOCK_TTL_MS) {
      return false  // another tab holds the lock
    }
    localStorage.setItem(REFRESH_LOCK_KEY, Date.now().toString())
    return true
  } catch { return true }  // if localStorage fails, proceed anyway
}

function releaseRefreshLock() {
  try { localStorage.removeItem(REFRESH_LOCK_KEY) } catch { /* ignore */ }
}

export function AuthProvider({ children }) {
  const [user, setUser]               = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [isLoggedIn, setIsLoggedIn]   = useState(false)
  const [isLoading, setIsLoading]     = useState(true)   // true until session resolved

  // Expose a ref so api.js interceptor can call refreshToken without circular import
  const refreshingRef = useRef(false)

  // ── Persist helpers ─────────────────────────────────────────────
  const persist = useCallback((access, refresh, userData) => {
    storage.setItem(KEYS.access,  access)
    storage.setItem(KEYS.refresh, refresh)
    storage.setItem(KEYS.user,    JSON.stringify(userData))
    setAccessToken(access)
    setUser(userData)
    setIsLoggedIn(true)
  }, [])

  const clearSession = useCallback(() => {
    storage.removeItem(KEYS.access)
    storage.removeItem(KEYS.refresh)
    storage.removeItem(KEYS.user)
    storage.setRememberMe(false)
    sessionStorage.clear()
    setAccessToken(null)
    setUser(null)
    setIsLoggedIn(false)
  }, [])

  // ── Session restore on mount ────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      const storedAccess  = storage.getItem(KEYS.access)
      const storedRefresh = storage.getItem(KEYS.refresh)
      const storedUser    = storage.getItem(KEYS.user)

      if (!storedAccess || !storedRefresh) {
        // Tokens gone -> try device session fallback
        const deviceId = getDeviceId()
        if (deviceId) {
          try {
            const data = await authService.deviceLogin(deviceId)
            persist(data.access_token, data.refresh_token, data.user)
            // Renew device session TTL on backend
            await authService.createDeviceSession(deviceId).catch(() => {})
            return
          } catch {
            // Device session expired — user must re-login
          }
        }
        setIsLoading(false)
        return
      }

      // Optimistically restore from storage
      try {
        let parsedUser = null
        try { parsedUser = storedUser ? JSON.parse(storedUser) : null } catch { parsedUser = null }
        setAccessToken(storedAccess)
        setUser(parsedUser)
        setIsLoggedIn(true)
        setIsLoading(false) // Set loading to false optimistically to mount UI immediately

        // Validate token with backend in background
        const freshUser = await authService.getMe()
        if (freshUser) {
          setUser(freshUser)
          storage.setItem(KEYS.user, JSON.stringify(freshUser))
        }
      } catch (err) {
        // Only a real auth rejection (401/403) means the session is dead.
        // Network failures, timeouts and 5xx (Azure cold start, DB pool
        // exhaustion) must NOT log the user out — otherwise a fresh page
        // load during a cold backend wipes a perfectly valid session and
        // the user has to reload two or three times to get back in.
        const status = err?.response?.status
        const isAuthFailure = status === 401 || status === 403

        if (!isAuthFailure) {
          // Keep the optimistically restored session as-is and retry later.
          setIsLoading(false)
          return
        }

        // Access token expired AND interceptor failed to refresh it.
        // Try device session fallback before giving up.
        const deviceId = getDeviceId()
        if (deviceId) {
          try {
            const data = await authService.deviceLogin(deviceId)
            persist(data.access_token, data.refresh_token, data.user)
          } catch {
            clearSession()
          }
        } else {
          clearSession()
        }
      } finally {
        setIsLoading(false)
      }
    }
    restore()
  }, [persist, clearSession])

  // ── Public methods ──────────────────────────────────────────────
  const login = useCallback(async (email, password, rememberMe) => {
    storage.setRememberMe(rememberMe)
    const data = await authService.login(email, password)
    persist(data.access_token, data.refresh_token, data.user)

    // Register device session (non-blocking, best-effort)
    const deviceId = getOrCreateDeviceId()
    if (deviceId) {
      authService.createDeviceSession(deviceId).catch(() => {})
    }

    return data
  }, [persist])

  const googleLogin = useCallback(async (credential) => {
    storage.setRememberMe(true)   // Google sign-in implies a persistent session
    const data = await authService.googleAuth(credential)
    persist(data.access_token, data.refresh_token, data.user)

    const deviceId = getOrCreateDeviceId()
    if (deviceId) {
      authService.createDeviceSession(deviceId).catch(() => {})
    }

    return data
  }, [persist])

  const register = useCallback(async (username, email, password) => {
    storage.setRememberMe(false)
    const data = await authService.register(username, email, password)
    persist(data.access_token, data.refresh_token, data.user)
    return data
  }, [persist])

  const logout = useCallback(async () => {
    try {
      await authService.logout()
      // Clean up device session from Redis
      const deviceId = getDeviceId()
      if (deviceId) {
        await authService.deleteDeviceSession(deviceId).catch(() => {})
      }
    } catch { /* best-effort */ }
    clearSession()
  }, [clearSession])

  const refreshToken = useCallback(async () => {
    if (refreshingRef.current) return null

    if (!acquireRefreshLock()) {
      // Another tab is refreshing — wait and read new token
      await new Promise(r => setTimeout(r, 1500))
      const newAccess = storage.getItem(KEYS.access)
      if (newAccess) {
        setAccessToken(newAccess)
        return newAccess
      }
      return null
    }

    refreshingRef.current = true
    try {
      const storedRefresh = storage.getItem(KEYS.refresh)
      if (!storedRefresh) throw new Error('No refresh token')
      const data = await authService.refreshToken(storedRefresh)
      const storedUser = storage.getItem(KEYS.user)
      persist(data.access_token, data.refresh_token, data.user ?? JSON.parse(storedUser))
      return data.access_token
    } catch {
      clearSession()
      throw new Error('Session expired')
    } finally {
      refreshingRef.current = false
      releaseRefreshLock()
    }
  }, [persist, clearSession])

  const updateUser = useCallback((newData) => {
    setUser(newData)
    storage.setItem(KEYS.user, JSON.stringify(newData))
  }, [])

  const value = {
    user,
    accessToken,
    isLoggedIn,
    isLoading,
    login,
    googleLogin,
    register,
    logout,
    refreshToken,
    updateUser,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// Convenience hook
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

export default AuthContext
