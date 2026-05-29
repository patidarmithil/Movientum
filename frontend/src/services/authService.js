/**
 * authService.js — Auth API service (Phase 3.5A)
 *
 * register(name, email, password)  → { access_token, refresh_token, user }
 * login(email, password)           → { access_token, refresh_token, user }
 * logout()                         → void (hits backend blacklist)
 * refreshToken()                   → { access_token, refresh_token }
 * getMe()                          → user profile
 */
import api from '../utils/api'

const BASE = '/api/v1/auth'

export const authService = {
  register: (username, email, password) =>
    api.post(`${BASE}/register`, { username, email, password }).then((r) => r.data.data),

  login: (email, password) =>
    api.post(`${BASE}/login`, { email, password }).then((r) => r.data.data),

  logout: () =>
    api.post(`${BASE}/logout`).then((r) => r.data.data),

  refreshToken: (refreshToken) =>
    api
      .post(`${BASE}/refresh`, {}, {
        headers: { Authorization: `Bearer ${refreshToken}` },
      })
      .then((r) => r.data.data),

  getMe: () =>
    api.get(`${BASE}/me`).then((r) => r.data.data),
}
