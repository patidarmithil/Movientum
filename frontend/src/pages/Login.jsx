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
import { authService } from '../services/authService'
import './Login.css'

export default function Login() {
  const { login, isLoggedIn, isLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirect = searchParams.get('redirect') || '/'

  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPwd, setShowPwd]     = useState(false)
  const [errors, setErrors]       = useState({})
  const [apiError, setApiError]   = useState('')
  const [apiSuccess, setApiSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [isForgotPassword, setIsForgotPassword] = useState(false)

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
    setApiSuccess('')
    const fieldErrors = validate()
    setErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) return

    setSubmitting(true)
    try {
      if (isForgotPassword) {
        await authService.resetPassword(email, password)
        setApiSuccess("Password has been reset successfully. You can now sign in.")
        setIsForgotPassword(false)
      } else {
        await login(email, password, rememberMe)
        navigate(redirect, { replace: true })
      }
    } catch (err) {
      const msg = err?.response?.data?.message || err?.response?.data?.detail || 'An error occurred. Please try again.'
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
            <img src="/favicon.svg" alt="Movientum Logo" className="auth-card__logo-img" />
            <span className="auth-card__logo-text">
              MOVI
              <span className="brand-name__e" aria-label="E">
                <span className="brand-name__e-bar brand-name__e-bar--top"></span>
                <span className="brand-name__e-bar brand-name__e-bar--mid"></span>
                <span className="brand-name__e-bar brand-name__e-bar--bot"></span>
              </span>
              NTUM
            </span>
          </Link>
        </div>

        <h1 className="auth-card__title">{isForgotPassword ? 'Reset Password' : 'Welcome back'}</h1>
        <p className="auth-card__subtitle">{isForgotPassword ? 'Enter your email and a new password' : 'Sign in to your account to continue'}</p>

        {/* Error/Success banner */}
        {apiError && (
          <div className="auth-banner" role="alert" id="login-error">
            {apiError}
          </div>
        )}
        {apiSuccess && (
          <div className="auth-banner" role="alert" style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--success)', borderColor: 'rgba(34, 197, 94, 0.2)' }}>
            {apiSuccess}
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
            <label className="auth-field__label" htmlFor="login-password">{isForgotPassword ? 'New Password' : 'Password'}</label>
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
            {!isForgotPassword ? (
              <>
                <label className="auth-check">
                  <input
                    type="checkbox"
                    id="login-remember"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  Remember me
                </label>
                <span className="auth-form__forgot" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => { setIsForgotPassword(true); setApiError(''); setApiSuccess(''); }}>
                  Forgot password?
                </span>
              </>
            ) : (
              <span className="auth-form__forgot" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => { setIsForgotPassword(false); setApiError(''); }}>
                Back to Sign In
              </span>
            )}
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
            {submitting ? 'Please wait…' : (isForgotPassword ? 'Reset Password' : 'Sign In')}
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
