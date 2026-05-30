import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import SearchBar from './SearchBar'
import './Navbar.css'

/**
 * Navbar — Redesigned brand header.
 * Features left brand logo (favicon.svg) and beta label, left-shifted search bar,
 * and right-aligned actions (Explore and Account/User Profile avatar).
 */
export default function Navbar() {
  const { isLoggedIn, isLoading, user, logout } = useAuth()
  const navigate = useNavigate()
  const [dropOpen, setDropOpen] = useState(false)
  const dropRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setDropOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = async () => {
    setDropOpen(false)
    await logout()
    navigate('/')
  }

  // Avatar initials from user name/email
  const initials = user
    ? (user.username || user.name || user.email || '?').charAt(0).toUpperCase()
    : '?'

  return (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="navbar__inner">
        
        {/* ── Logo + Brand Name + Beta Symbol ── */}
        <Link to="/" className="navbar__logo" aria-label="Movientum home">
          <img src="/favicon.svg" alt="Movientum Logo" className="navbar__logo-img" />
          <span className="navbar__logo-text">MOVIENTUM</span>
          <span className="navbar__logo-beta">β</span>
        </Link>

        {/* ── Search (Shifted left next to logo) ── */}
        <div className="navbar__search">
          <SearchBar />
        </div>

        {/* ── Right-Aligned Navigation Icons Group ── */}
        <div className="navbar__right-group">
          
          {/* Explore nav button (Compass Icon + Text) */}
          <NavLink
            to="/explore"
            className={({ isActive }) =>
              `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
              <circle cx="12" cy="12" r="10"></circle>
              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
            </svg>
            <span>Explore</span>
          </NavLink>

          {isLoggedIn && (
            <>
              {/* Dashboard nav button */}
              <NavLink
                to="/dashboard"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
                <span>Dashboard</span>
              </NavLink>

              {/* Analysis nav button */}
              <NavLink
                to="/analysis"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <line x1="3" y1="22" x2="21" y2="22"></line>
                  <line x1="4" y1="22" x2="4" y2="16"></line>
                  <line x1="8" y1="22" x2="8" y2="12"></line>
                  <line x1="12" y1="22" x2="12" y2="9"></line>
                  <line x1="16" y1="22" x2="16" y2="11"></line>
                  <line x1="20" y1="22" x2="20" y2="5"></line>
                  <path d="M4 12l4-4 4-3 4 3.5 4-5.5"></path>
                  <circle cx="4" cy="12" r="1.2" fill="currentColor"></circle>
                  <circle cx="8" cy="8" r="1.2" fill="currentColor"></circle>
                  <circle cx="12" cy="5" r="1.2" fill="currentColor"></circle>
                  <circle cx="16" cy="8.5" r="1.2" fill="currentColor"></circle>
                  <circle cx="20" cy="3" r="1.2" fill="currentColor"></circle>
                </svg>
                <span>Analysis</span>
              </NavLink>
            </>
          )}

          {/* Auth Actions (Avatar dropdown or Login / SignUp buttons) */}
          <div className="navbar__actions">
            {isLoading ? (
              <div className="navbar__avatar-skeleton" aria-hidden="true" />
            ) : isLoggedIn ? (
              <div className="navbar__user" ref={dropRef}>
                <button
                  className="navbar__avatar"
                  id="navbar-avatar-btn"
                  aria-label="User menu"
                  aria-expanded={dropOpen}
                  aria-haspopup="true"
                  onClick={() => setDropOpen((v) => !v)}
                >
                  {initials}
                </button>

                {dropOpen && (
                  <div className="navbar__dropdown" role="menu" id="navbar-dropdown">
                    {user && (
                      <div className="navbar__dropdown-user">
                        <span className="navbar__dropdown-name">{user.username || 'User'}</span>
                        <span className="navbar__dropdown-email">{user.email}</span>
                      </div>
                    )}
                    <div className="navbar__dropdown-divider" />
                    <Link
                      to="/dashboard"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-dashboard"
                      onClick={() => setDropOpen(false)}
                    >
                      <span>📊</span> Dashboard
                    </Link>
                    <Link
                      to="/analysis"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-analysis"
                      onClick={() => setDropOpen(false)}
                    >
                      <span>🔮</span> Analysis
                    </Link>
                    <button
                      className="navbar__dropdown-item navbar__dropdown-item--danger"
                      role="menuitem"
                      id="nav-logout"
                      onClick={handleLogout}
                    >
                      <span>🚪</span> Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link to="/login" className="btn btn--ghost btn--sm" id="nav-login">
                  Login
                </Link>
                <Link to="/register" className="btn btn--primary btn--sm" id="nav-register">
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </div>

      </div>
    </nav>
  )
}
