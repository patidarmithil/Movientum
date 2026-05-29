/**
 * Register.jsx — Phase 3.5A
 *
 * Dark premium registration form.
 * - name + email + password + confirm password
 * - Live password-strength indicator (weak / fair / good / strong)
 * - Inline validation
 * - Redirect if already logged in
 * - Shared Login.css + Register.css styling
 */
import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Login.css'
import './Register.css'

// ── Password strength scorer ──────────────────────────────────
function scorePassword(pwd) {
  if (!pwd || pwd.length < 6) return { level: 'weak', pct: 15, label: 'Too short' }
  let score = 0
  if (pwd.length >= 8)  score++
  if (pwd.length >= 12) score++
  if (/[A-Z]/.test(pwd))          score++
  if (/[0-9]/.test(pwd))          score++
  if (/[^A-Za-z0-9]/.test(pwd))  score++

  if (score <= 1) return { level: 'weak',   pct: 20,  label: 'Weak' }
  if (score === 2) return { level: 'fair',  pct: 45,  label: 'Fair' }
  if (score === 3) return { level: 'good',  pct: 70,  label: 'Good' }
  return              { level: 'strong', pct: 100, label: 'Strong' }
}

function PasswordStrength({ password }) {
  const { level, pct, label } = scorePassword(password)
  if (!password) return null
  return (
    <div className={`pwd-strength pwd-strength--${level}`}>
      <div className="pwd-strength__bar-track">
        <div
          className="pwd-strength__bar-fill"
          style={{ width: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <span className="pwd-strength__label">{label}</span>
    </div>
  )
}

export default function Register() {
  const { register, isLoggedIn, isLoading } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername]   = useState('')
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [showPwd, setShowPwd]     = useState(false)
  const [showCfm, setShowCfm]     = useState(false)
  const [errors, setErrors]       = useState({})
  const [apiError, setApiError]   = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Already logged in → home
  useEffect(() => {
    if (!isLoading && isLoggedIn) navigate('/', { replace: true })
  }, [isLoggedIn, isLoading, navigate])

  // ── Validation ─────────────────────────────────────────────────
  const validate = () => {
    const e = {}
    if (!username.trim()) {
      e.username = 'Username is required'
    } else if (username.trim().length < 3) {
      e.username = 'Username must be at least 3 characters'
    } else if (/\s/.test(username.trim())) {
      e.username = 'Username cannot contain spaces'
    }

    if (!email.trim())                           e.email    = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(email))        e.email    = 'Enter a valid email'
    if (!password)                               e.password = 'Password is required'
    else if (password.length < 8)                e.password = 'Minimum 8 characters'
    if (password !== confirm)                    e.confirm  = 'Passwords do not match'
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
      await register(username.trim(), email, password)
      navigate('/', { replace: true })
    } catch (err) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.detail  ||
        'Sign up failed. Please try again.'
      setApiError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  const clearErr = (field) => setErrors((prev) => ({ ...prev, [field]: '' }))

  return (
    <main className="auth-page" id="register-page" aria-label="Register page">
      {/* Decorative blobs */}
      <div className="auth-page__blob auth-page__blob--1" aria-hidden="true" />
      <div className="auth-page__blob auth-page__blob--2" aria-hidden="true" />

      <div className="auth-card" role="main" style={{ maxWidth: 440 }}>
        {/* Logo */}
        <div className="auth-card__logo">
          <Link to="/" className="auth-card__logo" style={{ gap: '8px', textDecoration: 'none' }}>
            <span className="auth-card__logo-mark">M</span>
            <span className="auth-card__logo-text">Movientum</span>
          </Link>
        </div>

        <h1 className="auth-card__title">Create account</h1>
        <p className="auth-card__subtitle">Join Movientum and discover your next favourite film</p>

        {/* Error banner */}
        {apiError && (
          <div className="auth-banner" role="alert" id="register-error" style={{ marginBottom: 'var(--space-4)' }}>
            {apiError}
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate id="register-form">
          {/* Username */}
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="reg-username">Username</label>
            <input
              id="reg-username"
              type="text"
              autoComplete="username"
              className={`auth-field__input${errors.username ? ' auth-field__input--error' : ''}`}
              placeholder="johndoe"
              value={username}
              onChange={(e) => { setUsername(e.target.value); clearErr('username') }}
              disabled={submitting}
            />
            {errors.username && <span className="auth-field__error" role="alert">{errors.username}</span>}
          </div>

          {/* Email */}
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="reg-email">Email address</label>
            <input
              id="reg-email"
              type="email"
              autoComplete="email"
              className={`auth-field__input${errors.email ? ' auth-field__input--error' : ''}`}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); clearErr('email') }}
              disabled={submitting}
            />
            {errors.email && <span className="auth-field__error" role="alert">{errors.email}</span>}
          </div>

          {/* Password */}
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="reg-password">Password</label>
            <div className="auth-field__input-wrap">
              <input
                id="reg-password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="new-password"
                className={`auth-field__input auth-field__input--has-toggle${errors.password ? ' auth-field__input--error' : ''}`}
                placeholder="••••••••"
                value={password}
                onChange={(e) => { setPassword(e.target.value); clearErr('password') }}
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
            <PasswordStrength password={password} />
            {errors.password && <span className="auth-field__error" role="alert">{errors.password}</span>}
          </div>

          {/* Confirm password */}
          <div className="auth-field">
            <label className="auth-field__label" htmlFor="reg-confirm">Confirm password</label>
            <div className="auth-field__input-wrap">
              <input
                id="reg-confirm"
                type={showCfm ? 'text' : 'password'}
                autoComplete="new-password"
                className={`auth-field__input auth-field__input--has-toggle${errors.confirm ? ' auth-field__input--error' : ''}`}
                placeholder="••••••••"
                value={confirm}
                onChange={(e) => { setConfirm(e.target.value); clearErr('confirm') }}
                disabled={submitting}
              />
              <button
                type="button"
                className="auth-field__toggle"
                aria-label={showCfm ? 'Hide password' : 'Show password'}
                onClick={() => setShowCfm((v) => !v)}
                tabIndex={-1}
              >
                {showCfm ? '🙈' : '👁'}
              </button>
            </div>
            {errors.confirm && <span className="auth-field__error" role="alert">{errors.confirm}</span>}
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="auth-submit"
            id="register-submit"
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting && <span className="auth-submit__spinner" aria-hidden="true" />}
            {submitting ? 'Creating account…' : 'Create Account'}
          </button>
        </form>

        <p className="auth-card__footer">
          Already have an account?
          <Link to="/login" id="go-to-login">Sign in</Link>
        </p>
      </div>
    </main>
  )
}
