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
const SECONDARY_URL = import.meta.env.VITE_API_URL_SECONDARY || 'https://movientum-backend-secondary.onrender.com';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120000,
  headers: { 'Content-Type': 'application/json' },
})

// Helper to check if user agent is a search crawler bot
const isBotUserAgent = () => {
  if (typeof window === 'undefined' || !window.navigator || !window.navigator.userAgent) {
    return false;
  }
  const ua = window.navigator.userAgent.toLowerCase();
  return /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|yahoo! slurp|sogou|exabot|ia_archiver|facebot|facebookexternalhit|twitterbot|pinterest|slackbot|telegrambot|whatsapp/i.test(ua);
};

// ── Request interceptor — attach Bearer token ──────────────────
api.interceptors.request.use(
  (config) => {
    // Intercept and prevent crawling bots from hitting the server on any non-landing subpaths
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    if (isBotUserAgent() && pathname !== '/' && pathname !== '/intro' && pathname !== '/about') {
      console.warn(`[Bot Block] Prevented crawler request to ${config.url} on path ${pathname}`);
      return Promise.reject({ __isBotBlock: true, config });
    }

    const token = storage.getItem(KEYS.access)
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// ── DB overload detector ──────────────────────────────────────
// Both primary and secondary backends failing with a network/5xx error is
// treated as the DB (Supabase egress cap) being down, not a one-off blip.
// Throttled so one bad page load doesn't fire the banner a dozen times.
let lastDbOverloadDispatch = 0
const DB_OVERLOAD_THROTTLE_MS = 30000

const maybeSignalDbOverload = (error, original) => {
  const isServerOrNetworkError =
    !error.response ||
    error.code === 'ECONNABORTED' ||
    (error.response.status >= 500 && error.response.status <= 599)

  const exhaustedFallback = !SECONDARY_URL || original?._secondaryRetry
  if (!isServerOrNetworkError || !exhaustedFallback) return

  const now = Date.now()
  if (now - lastDbOverloadDispatch < DB_OVERLOAD_THROTTLE_MS) return
  lastDbOverloadDispatch = now

  window.dispatchEvent(new CustomEvent('mv:db-overload', {
    detail: { message: error.message, status: error.response?.status ?? null }
  }))
}

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
    // Resolve immediately with empty data format to prevent client-side JS crashes if bot blocked
    if (error && error.__isBotBlock) {
      return Promise.resolve({
        status: 200,
        statusText: 'OK',
        headers: {},
        config: error.config,
        data: {
          movies: [],
          total: 0,
          page: 1,
          limit: 20,
          results: [],
          articles: [],
          success: true,
          data: []
        }
      });
    }

    const original = error.config

    // ── Basic error logging ──────────────────────────────────
    console.error('[API Error]', original?.url, error.response?.status, error.message)

    let errorCode = 'MV-FNW01';
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      errorCode = 'MV-FNW02';
    } else if (error.response) {
      if (error.response.status === 401) {
        errorCode = 'MV-FAU01';
      } else if (error.response.data?.code) {
        errorCode = error.response.data.code;
      } else {
        errorCode = 'MV-BSV01';
      }
    }

    if (errorCode) {
      error.message = `${error.message} [${errorCode}]`;
      if (error.response?.data && typeof error.response.data === 'object') {
        error.response.data.message = `${error.response.data.message || error.message} [${errorCode}]`;
      }
    }

    // ── Secondary Backend Fallback ───────────────────────────
    if (!original._secondaryRetry && SECONDARY_URL && original.baseURL !== SECONDARY_URL) {
      const isNetworkOrServerError = 
        !error.response || 
        error.code === 'ECONNABORTED' ||
        (error.response.status >= 500 && error.response.status <= 599);

      if (isNetworkOrServerError) {
        console.warn(`[API Fallback] Primary failed, retrying with secondary backend: ${SECONDARY_URL}`);
        original._secondaryRetry = true;
        original.baseURL = SECONDARY_URL;

        return api(original);
      }
    }

    // Both backends exhausted (or no fallback configured) and still a server/network
    // error — signal the DB-overload banner before falling through to normal handling.
    maybeSignalDbOverload(error, original)

    // Skip retry for auth endpoints where 401 means invalid credentials, not an expired access token
    if (original?.url?.includes('/auth/refresh')) {
      // Refresh failed → force logout
      storage.removeItem(KEYS.access)
      storage.removeItem(KEYS.refresh)
      storage.removeItem('mv_user')
      window.dispatchEvent(new Event('mv:logout'))
      return Promise.reject(error)
    }

    if (original?.url?.includes('/auth/login') || original?.url?.includes('/auth/device-login')) {
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
          `${api.defaults.baseURL}/api/v1/auth/refresh`,
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

        refreshError.message = `${refreshError.message} [MV-FAU02]`;
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

export default api
