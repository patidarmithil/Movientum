/**
 * api.js — Axios instance (Phase 3.5A)
 *
 * Phase 3.5A adds:
 *  - Request interceptor: attach Bearer token from sessionStorage
 *  - Response interceptor: handle 401 → refresh → retry (with infinite-loop guard)
 */
import axios from 'axios'
import { storage } from './storage'

const KEYS = {
  access:  'mv_access_token',
  refresh: 'mv_refresh_token',
}

const isLocalhost = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || 
   window.location.hostname === '127.0.0.1' || 
   window.location.hostname === '[::1]');

const fallbackAPIUrl = isLocalhost 
  ? 'http://localhost:8000' 
  : 'https://movientum.azurewebsites.net';

const BASE_URL = import.meta.env.VITE_API_URL || fallbackAPIUrl;

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 45000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Request interceptor — attach Bearer token ──────────────────
api.interceptors.request.use(
  (config) => {
    const token = storage.getItem(KEYS.access)
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ── Response interceptor — 401 → refresh → retry ─────────────
let isRefreshing = false
let failedQueue = []           // queue requests while refreshing

const processQueue = (error, token = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error)
    else prom.resolve(token)
  })
  failedQueue = []
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config

    // ── Basic error logging ──────────────────────────────────
    console.error('[API Error]', original?.url, error.response?.status, error.message)

    // Skip retry for refresh endpoint itself — prevents infinite loop
    if (original?.url?.includes('/auth/refresh')) {
      // Refresh failed → force logout
      storage.removeItem(KEYS.access)
      storage.removeItem(KEYS.refresh)
      storage.removeItem('mv_user')
      window.dispatchEvent(new Event('mv:logout'))
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && !original._retry) {
      // If already refreshing, queue this request until refresh completes
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        })
          .then((token) => {
            original.headers['Authorization'] = `Bearer ${token}`
            return api(original)
          })
          .catch((err) => Promise.reject(err))
      }

      original._retry = true
      isRefreshing = true

      const storedRefresh = storage.getItem(KEYS.refresh)

      if (!storedRefresh) {
        isRefreshing = false
        processQueue(error, null)
        return Promise.reject(error)
      }

      try {
        // Call refresh directly (avoid circular import with AuthContext)
        const response = await axios.post(
          `${BASE_URL}/api/v1/auth/refresh`,
          { refresh_token: storedRefresh }
        )
        const { access_token, refresh_token } = response.data.data
        storage.setItem(KEYS.access,  access_token)
        storage.setItem(KEYS.refresh, refresh_token)

        isRefreshing = false
        processQueue(null, access_token)

        // Retry original request with new token
        original.headers['Authorization'] = `Bearer ${access_token}`
        return api(original)
      } catch (refreshError) {
        isRefreshing = false
        processQueue(refreshError, null)

        // Refresh failed → clear session, redirect to login
        storage.removeItem(KEYS.access)
        storage.removeItem(KEYS.refresh)
        storage.removeItem('mv_user')
        window.dispatchEvent(new Event('mv:logout'))

        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api
