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

// Whether this user agent is a search crawler. The UA never changes during a
// session, so it is evaluated once at module load rather than re-running the
// regex on every outgoing request.
const BOT_UA_RE = /googlebot|bingbot|yandexbot|baiduspider|duckduckbot|yahoo! slurp|sogou|exabot|ia_archiver|facebot|facebookexternalhit|twitterbot|pinterest|slackbot|telegrambot|whatsapp/i;

const IS_BOT_UA = typeof window !== 'undefined' && !!window.navigator?.userAgent
  && BOT_UA_RE.test(window.navigator.userAgent.toLowerCase());

// ── Request interceptor — attach Bearer token ──────────────────
api.interceptors.request.use(
  (config) => {
    // Intercept and prevent crawling bots from hitting the server on any non-landing subpaths
    // Path still has to be read per request — it changes on navigation.
    const pathname = IS_BOT_UA && typeof window !== 'undefined' ? window.location.pathname : '';
    if (IS_BOT_UA && pathname !== '/' && pathname !== '/intro' && pathname !== '/about') {
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

// Refresh tokens rotate: the backend blacklists the old one on use. Two tabs
// reloading together would both send the same refresh token, the second gets a
// 401, and its forced logout wiped the pair the first tab had just stored. The
// lock (shared across tabs through localStorage) lets one tab refresh while the
// others wait and pick up the new token.
const REFRESH_LOCK_KEY = 'mv_refreshing'
const REFRESH_LOCK_TTL_MS = 10000
const REFRESH_WAIT_MS = 8000

const acquireRefreshLock = () => {
  try {
    const held = localStorage.getItem(REFRESH_LOCK_KEY)
    if (held && Date.now() - parseInt(held, 10) < REFRESH_LOCK_TTL_MS) return false
    localStorage.setItem(REFRESH_LOCK_KEY, Date.now().toString())
    return true
  } catch { return true }
}

const releaseRefreshLock = () => {
  try { localStorage.removeItem(REFRESH_LOCK_KEY) } catch { /* ignore */ }
}

/** Resolves with the access token once it differs from `stale`, or null on timeout. */
const waitForNewAccessToken = (stale) => new Promise((resolve) => {
  const started = Date.now()
  const tick = () => {
    const current = storage.getItem(KEYS.access)
    if (current && current !== stale) return resolve(current)
    if (Date.now() - started > REFRESH_WAIT_MS) return resolve(null)
    setTimeout(tick, 200)
  }
  tick()
})

const isAuthRejection = (err) => err?.response?.status === 401 || err?.response?.status === 403

/**
 * POST /auth/refresh, falling back to the secondary backend on a network or
 * 5xx failure the same way every other request does. A cold primary used to
 * make the refresh fail, which was treated as an expired session.
 */
const postRefresh = async (refreshToken) => {
  const body = { refresh_token: refreshToken }
  try {
    return await axios.post(`${BASE_URL}/api/v1/auth/refresh`, body, { timeout: 120000 })
  } catch (err) {
    const retryable = !err.response || err.response.status >= 500
    if (!retryable || !SECONDARY_URL || SECONDARY_URL === BASE_URL) throw err
    return axios.post(`${SECONDARY_URL}/api/v1/auth/refresh`, body, { timeout: 120000 })
  }
}

const clearStoredSession = () => {
  storage.removeItem(KEYS.access)
  storage.removeItem(KEYS.refresh)
  storage.removeItem('mv_user')
  window.dispatchEvent(new Event('mv:logout'))
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
      // Only a real rejection ends the session; a timeout or 5xx keeps it.
      if (isAuthRejection(error)) clearStoredSession()
      return Promise.reject(error)
    }

    if (
      original?.url?.includes('/auth/login') ||
      original?.url?.includes('/auth/device-login') ||
      original?.url?.includes('/auth/logout') ||
      original?.url?.includes('/auth/google')
    ) {
      return Promise.reject(error)
    }

    if (error.response?.status === 401 && !original._retry) {
      // The token this request carried may already be replaced — a login,
      // device login or another tab's refresh landed while it was in flight.
      // Retry with the current one instead of rotating the refresh token again.
      const sentAuth = original.headers?.['Authorization'] || original.headers?.Authorization
      const currentAccess = storage.getItem(KEYS.access)
      if (currentAccess && sentAuth !== `Bearer ${currentAccess}`) {
        original._retry = true
        original.headers['Authorization'] = `Bearer ${currentAccess}`
        return api(original)
      }

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

      // Another tab is mid-refresh with this same refresh token: wait for the
      // pair it stores rather than sending a token that is about to be revoked.
      if (!acquireRefreshLock()) {
        const fresh = await waitForNewAccessToken(currentAccess)
        isRefreshing = false
        if (fresh) {
          processQueue(null, fresh)
          original.headers['Authorization'] = `Bearer ${fresh}`
          return api(original)
        }
        processQueue(error, null)
        return Promise.reject(error)
      }

      try {
        // Call refresh directly (avoid circular import with AuthContext)
        const response = await postRefresh(storedRefresh)
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

        // Only a 401/403 from /auth/refresh means the session is over. A
        // timeout or 5xx (Azure cold start) keeps the tokens so the next
        // request can try again instead of logging the user out.
        // Also skip the logout when the stored pair changed while refreshing
        // (a login or device login in this tab, or another tab's refresh).
        const pairChanged = storage.getItem(KEYS.refresh) !== storedRefresh
        const latestAccess = storage.getItem(KEYS.access)
        if (pairChanged && latestAccess) {
          original.headers['Authorization'] = `Bearer ${latestAccess}`
          return api(original)
        }
        if (isAuthRejection(refreshError)) clearStoredSession()

        refreshError.message = `${refreshError.message} [MV-FAU02]`;
        return Promise.reject(refreshError)
      } finally {
        releaseRefreshLock()
      }
    }

    return Promise.reject(error)
  }
)

export default api
