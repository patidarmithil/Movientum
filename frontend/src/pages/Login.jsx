/**
 * Login.jsx — Phase 3.5A
 *
 * Dark premium login form.
 * - Inline field validation
 * - Show/hide password toggle
 * - Aurora blob background
 * - Redirects to home if already logged in
 * - Redirects to ?redirect= param after login (e.g. /dashboard)
 */
import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Login.css'

export default function Login() {
  const { login, isLoggedIn, isLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [errors, setErrors]       = useState({})
  const [apiError, setApiError]   = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Already logged in → redirect
  useEffect(() => {
    if (!isLoading && isLoggedIn) navigate(redirect, { replace: true })
  }, [isLoggedIn, isLoading, navigate, redirect])

  // ── Validation ─────────────────────────────────────────────────
  const validate = () => {
    const e = {}
    if (!email.trim())                         e.email    = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(email))      e.email    = 'Enter a valid email'
    if (!password)                             e.password = 'Password is required'
    else if (password.length < 6)              e.password = 'Minimum 6 characters'
    return e
  }

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault()
    setApiError('')
    const fieldErrors = validate()
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) return

    setSubmitting(true)
    try {
      await login(email, password)
      navigate(redirect, { replace: true })
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || 'Login failed. Please try again.'
      setApiError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page" id="login-page" aria-label="Login page">
      {/* Decorative blobs */}
      <div className="auth-page__blob auth-page__blob--1" aria-hidden="true" />
      <div className="auth-page__blob auth-page__blob--2" aria-hidden="true" />

      <div className="auth-card" role="main">
        {/* Logo */}
        <div className="auth-card__logo">
          <Link to="/" className="auth-card__logo" style={{ gap: '8px', textDecoration: 'none' }}>
            <span className="auth-card__logo-mark">M</span>
            <span className="auth-card__logo-text">Movientum</span>
          </Link>
        </div>

        <h1 className="auth-card__title">Welcome back</h1>
        <p className="auth-card__subtitle">Sign in to your account to continue</p>

        {/* Error banner */}
        {apiError && (
          <div className="auth-banner" role="alert" id="login-error">
            {apiError}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate id="login-form">
          {/* Email */}
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="login-email">Email address</label>
            <div className="auth-field__input-wrap">
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                className={`auth-field__input${errors.email ? ' auth-field__input--error' : ''}`}
                placeholder="you@example.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors((prev) => ({ ...prev, email: '' })) }}
                disabled={submitting}
              />
            </div>
            {errors.email && <span className="auth-field__error" role="alert">{errors.email}</span>}
          </div>

          {/* Password */}
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="login-password">Password</label>
            <div className="auth-field__input-wrap">
              <input
                id="login-password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                className={`auth-field__input auth-field__input--has-toggle${errors.password ? ' auth-field__input--error' : ''}`}
                placeholder="••••••••"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrors((prev) => ({ ...prev, password: '' })) }}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-field__toggle"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                onClick={() => setShowPwd((v) => !v)}
                tabIndex={-1}
              >
                {showPwd ? '🙈' : '👁'}
              </button>
            </div>
            {errors.password && <span className="auth-field__error" role="alert">{errors.password}</span>}
          </div>

          {/* Remember me + Forgot */}
          <div className="auth-form__row">
            <label className="auth-check">
              <input type="checkbox" id="login-remember" />
              Remember me
            </label>
            <span className="auth-form__forgot" style={{ cursor: 'default', color: 'var(--text-muted)' }}>
              Forgot password?
            </span>
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="auth-submit"
            id="login-submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
            {submitting ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        <p className="auth-card__footer">
          Don't have an account?
          <Link to="/register" id="go-to-register">Sign up</Link>
        </p>
      </div>
    </main>
  )
}
