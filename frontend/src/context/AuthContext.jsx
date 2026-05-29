/**
 * AuthContext.jsx — Global auth state (Phase 3.5A)
 *
 * State: { user, accessToken, isLoggedIn, isLoading }
 * Methods: login(), register(), logout(), refreshToken()
 *
 * On mount: reads localStorage → validates token → restores session.
 * Token storage keys:
 *   localStorage: 'mv_access_token', 'mv_refresh_token', 'mv_user'
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { authService } from '../services/authService'

const AuthContext = createContext(null)

const KEYS = {
  access:  'mv_access_token',
  refresh: 'mv_refresh_token',
  user:    'mv_user',
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
    localStorage.setItem(KEYS.access,  access)
    localStorage.setItem(KEYS.refresh, refresh)
    localStorage.setItem(KEYS.user,    JSON.stringify(userData))
    setAccessToken(access)
    setUser(userData)
    setIsLoggedIn(true)
  }, [])

  const clearSession = useCallback(() => {
    localStorage.removeItem(KEYS.access)
    localStorage.removeItem(KEYS.refresh)
    localStorage.removeItem(KEYS.user)
    setAccessToken(null)
    setUser(null)
    setIsLoggedIn(false)
  }, [])

  // ── Session restore on mount ────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      const storedAccess  = localStorage.getItem(KEYS.access)
      const storedRefresh = localStorage.getItem(KEYS.refresh)
      const storedUser    = localStorage.getItem(KEYS.user)

      if (!storedAccess || !storedRefresh) {
        setIsLoading(false)
        return
      }

      // Optimistically restore from localStorage
      try {
        const parsedUser = JSON.parse(storedUser)
        setAccessToken(storedAccess)
        setUser(parsedUser)
        setIsLoggedIn(true)

        // Validate token with backend
        const freshUser = await authService.getMe()
        setUser(freshUser)
        localStorage.setItem(KEYS.user, JSON.stringify(freshUser))
      } catch {
        // Token expired — try refresh
        try {
          const data = await authService.refreshToken(storedRefresh)
          persist(data.access_token, data.refresh_token, data.user ?? JSON.parse(storedUser))
        } catch {
          clearSession()
        }
      } finally {
        setIsLoading(false)
      }
    }
    restore()
  }, [persist, clearSession])

  // ── Public methods ──────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const data = await authService.login(email, password)
    persist(data.access_token, data.refresh_token, data.user)
    return data
  }, [persist])

  const register = useCallback(async (username, email, password) => {
    const data = await authService.register(username, email, password)
    persist(data.access_token, data.refresh_token, data.user)
    return data
  }, [persist])

  const logout = useCallback(async () => {
    try { await authService.logout() } catch { /* best-effort */ }
    clearSession()
  }, [clearSession])

  const refreshToken = useCallback(async () => {
    if (refreshingRef.current) return null
    refreshingRef.current = true
    try {
      const storedRefresh = localStorage.getItem(KEYS.refresh)
      if (!storedRefresh) throw new Error('No refresh token')
      const data = await authService.refreshToken(storedRefresh)
      const storedUser = localStorage.getItem(KEYS.user)
      persist(data.access_token, data.refresh_token, data.user ?? JSON.parse(storedUser))
      return data.access_token
    } catch {
      clearSession()
      throw new Error('Session expired')
    } finally {
      refreshingRef.current = false
    }
  }, [persist, clearSession])

  const value = {
    user,
    accessToken,
    isLoggedIn,
    isLoading,
    login,
    register,
    logout,
    refreshToken,
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
