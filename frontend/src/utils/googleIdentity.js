/**
 * googleIdentity.js — loads and initialises Google Identity Services.
 *
 * Deliberately dependency-free (no @react-oauth/google). Injects
 * https://accounts.google.com/gsi/client once, memoises the promise, and
 * resolves with window.google.accounts.id.
 */
let _promise = null

export function loadGoogleIdentity() {
  if (_promise) return _promise
  _promise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id)
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.defer = true
    s.onload = () => resolve(window.google.accounts.id)
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return _promise
}
