import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { notificationService } from '../services/notificationService'
import SearchOverlay from './SearchOverlay'
import './Navbar.css'

/**
 * Navbar — Redesigned brand header.
 * Features left brand logo (favicon.svg) and beta label, left-shifted search bar,
 * and right-aligned actions (Explore and Account/User Profile avatar).
 */
export default function Navbar() {
  const { isLoggedIn, isLoading, user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [dropOpen, setDropOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const dropRef = useRef(null)
  
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)

  const [scrolled, setScrolled] = useState(false)

  // Track window scroll to change navbar glass style
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 10)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const [highlightExplore, setHighlightExplore] = useState(false)

  // Listen to explore page highlight requests
  useEffect(() => {
    const handleHighlight = (e) => {
      setHighlightExplore(e.detail)
    }
    window.addEventListener('mv:highlightExplore', handleHighlight)
    return () => window.removeEventListener('mv:highlightExplore', handleHighlight)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setDropOpen(false)
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setNotifOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleLogout = async () => {
    setDropOpen(false)
    setMobileMenuOpen(false)
    await logout()
    navigate('/')
  }

  useEffect(() => {
    if (isLoggedIn) {
      notificationService.getNotifications()
        .then(setNotifications)
        .catch(() => {})
    } else {
      setNotifications([])
    }
  }, [isLoggedIn])

  const safeNotifications = Array.isArray(notifications) ? notifications : []
  const unreadCount = safeNotifications.filter(n => !n.seen).length

  const handleNotifClick = () => {
    setNotifOpen(!notifOpen)
    if (!notifOpen && unreadCount > 0) {
      notificationService.markAllSeen().then(() => {
        setNotifications(safeNotifications.map(n => ({...n, seen: true})))
      })
    }
  }

  const addTestNotification = () => {
    const newNotif = {
      id: Date.now(),
      message: "This is a test notification. Notifications are working!",
      seen: false,
      created_at: new Date().toISOString()
    }
    setNotifications([newNotif, ...notifications])
  }

  // Avatar initials from user name/email
  const initials = user
    ? (user.username || user.name || user.email || '?').charAt(0).toUpperCase()
    : '?'

  const avatarUrl = user?.avatar_url
    ? (user.avatar_url.startsWith('http') ? user.avatar_url : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${user.avatar_url}`)
    : null

  return (
    <nav
      className={`navbar ${scrolled ? 'navbar--scrolled' : ''}`}
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="navbar__inner">
        
        {/* ── Logo + Brand Name + Beta Symbol ── */}
        <Link to="/home" className="navbar__logo" aria-label="Movientum home" onClick={() => setMobileMenuOpen(false)}>
          <img src="/favicon.svg" alt="Movientum Logo" className="navbar__logo-img" />
          <span className="navbar__logo-text">
            OVI
            <span className="brand-name__e" aria-label="E">
              <span className="brand-name__e-bar brand-name__e-bar--top"></span>
              <span className="brand-name__e-bar brand-name__e-bar--mid"></span>
              <span className="brand-name__e-bar brand-name__e-bar--bot"></span>
            </span>
            NTUM
          </span>
          <span className="navbar__logo-beta">β</span>
        </Link>

        {/* ── Right-Aligned Navigation Icons Group ── */}
        <div className="navbar__right-group">
          
          {(location.pathname === '/intro' || location.pathname === '/about' || (location.pathname === '/' && !isLoggedIn)) ? (
            <>
              <a href="https://github.com/patidarmithil/Movientum" target="_blank" rel="noopener noreferrer" className="btn btn--ghost btn--sm" style={{ marginRight: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                  <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                </svg>
                Source Code
              </a>
              <Link to="/home" className="btn btn--secondary btn--sm" style={{ marginRight: '8px' }}>Demo</Link>
            </>
          ) : (
            <>
              {/* Explore nav button (Compass Icon + Text) */}
              <NavLink
                to="/explore"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}${highlightExplore ? ' navbar__link--highlighted' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                </svg>
                <span>Explore</span>
              </NavLink>

              {/* News nav button */}
              <NavLink
                to="/news"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" />
                  <path d="M2 12h10" />
                  <path d="M2 17h10" />
                  <path d="M2 7h4" />
                </svg>
                <span>News</span>
              </NavLink>

              {/* Content DNA nav button */}
              <NavLink
                to="/rec-content"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <span>DNA</span>
              </NavLink>


              {isLoggedIn && (
                <>
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
                </>
              )}

              {!isLoggedIn && (
                <>
                  {/* About nav button */}
                  <NavLink
                    to="/about"
                    className={({ isActive }) =>
                      `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                    }
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    <span>About</span>
                  </NavLink>

                  {/* Help nav button */}
                  <NavLink
                    to="/help"
                    className={({ isActive }) =>
                      `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                    }
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                      <circle cx="12" cy="12" r="10"></circle>
                      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                      <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <span>Help</span>
                  </NavLink>
                </>
              )}
            </>
          )}

          {/* Auth Actions (Avatar dropdown or Login / SignUp buttons) */}
          <div className="navbar__actions">
            {/* Search Trigger Button */}
            {!(location.pathname === '/intro' || location.pathname === '/about' || (location.pathname === '/' && !isLoggedIn)) && (
              <button
                className="navbar__notif-btn"
                onClick={() => setSearchOpen(!searchOpen)}
                aria-label="Search"
                style={{ marginRight: '8px' }}
              >
                {searchOpen ? (
                  <svg key="cross" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg search-icon-animate">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                ) : (
                  <svg key="search" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg search-icon-animate">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                )}
              </button>
            )}

            {isLoggedIn && (
              <div className="navbar__user" ref={notifRef} style={{ marginRight: '8px' }}>
                <button
                  className="navbar__notif-btn"
                  onClick={handleNotifClick}
                  aria-label="Notifications"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                  {unreadCount > 0 && (
                    <span className="navbar__notif-badge">{unreadCount}</span>
                  )}
                </button>
                {notifOpen && (
                  <div className="navbar__notif-dropdown">
                    <div className="navbar__notif-header">Notifications</div>
                    <div className="navbar__notif-list">
                      {safeNotifications.length === 0 ? (
                        <div className="navbar__notif-empty">
                          No notifications
                          <br/><br/>
                          <button onClick={addTestNotification} className="btn btn--secondary btn--sm">Test Notifications</button>
                        </div>
                      ) : (
                        safeNotifications.map(n => (
                          <div
                            key={n.id}
                            className="navbar__notif-item"
                            style={{ opacity: n.seen ? 0.6 : 1 }}
                          >
                            <span className="navbar__notif-message">{n.message}</span>
                            <span className="navbar__notif-date">
                              {new Date(n.created_at).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

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
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={user?.username || 'User'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    initials
                  )}
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
                      to="/news"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-news"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" />
                        <path d="M2 12h10" />
                        <path d="M2 17h10" />
                        <path d="M2 7h4" />
                      </svg> News
                    </Link>
                    <Link
                      to="/dashboard"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-dashboard"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                      </svg> Dashboard
                    </Link>
                    <Link
                      to="/analysis"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-analysis"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <line x1="3" y1="22" x2="21" y2="22"></line>
                        <line x1="4" y1="22" x2="4" y2="16"></line>
                        <line x1="8" y1="22" x2="8" y2="12"></line>
                        <line x1="12" y1="22" x2="12" y2="9"></line>
                        <line x1="16" y1="22" x2="16" y2="11"></line>
                        <line x1="20" y1="22" x2="20" y2="5"></line>
                      </svg> Analysis
                    </Link>
                    <Link
                      to="/feedback"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-feedback"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
                      </svg> Feedback
                    </Link>
                    <Link
                      to="/settings"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-settings"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                      </svg> Settings
                    </Link>
                    <Link
                      to="/help"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <circle cx="12" cy="12" r="10"></circle>
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                      </svg> Help
                    </Link>
                    <Link
                      to="/about"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="16" x2="12" y2="12"></line>
                        <line x1="12" y1="8" x2="12.01" y2="8"></line>
                      </svg> About
                    </Link>

                    {user?.role === 'admin' && (
                      <Link
                        to="/admin"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-admin"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg> Admin Panel
                      </Link>
                    )}
                    <button
                      className="navbar__dropdown-item navbar__dropdown-item--danger"
                      role="menuitem"
                      id="nav-logout"
                      onClick={handleLogout}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px', color: 'var(--danger, #ef4444)' }}>
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                      </svg> Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="navbar__auth-desktop-buttons">
                <Link to="/login" className="btn btn--ghost btn--sm" id="nav-login">
                  Login
                </Link>
                <Link to="/signup" className="btn btn--primary btn--sm" id="nav-register">
                  Sign Up
                </Link>
              </div>
            )}

          {/* Search Trigger */}
          {!(location.pathname === '/intro' || location.pathname === '/about' || (location.pathname === '/' && !isLoggedIn)) && (
            <SearchOverlay isOpen={searchOpen} setIsOpen={setSearchOpen} />
          )}

            {/* Mobile Hamburger menu toggle button */}
            <button 
              className="navbar__hamburger"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

      </div>

      {/* ── Mobile sliding menu drawer & backdrop (Portalled to document.body) ── */}
      {createPortal(
        <>
          <div 
            className={`navbar__mobile-backdrop${mobileMenuOpen ? ' navbar__mobile-backdrop--open' : ''}`}
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className={`navbar__mobile-drawer${mobileMenuOpen ? ' navbar__mobile-drawer--open' : ''}`} role="dialog" aria-label="Mobile navigation">
            <div className="navbar__mobile-drawer-header">
              <Link to="/home" className="navbar__logo" onClick={() => setMobileMenuOpen(false)}>
                <img src="/favicon.svg" alt="" className="navbar__logo-img" style={{ width: '30px', height: '30px' }} />
                <span className="navbar__logo-text" style={{ fontSize: '15px' }}>OVIENTUM</span>
              </Link>
              <button 
                className="navbar__mobile-drawer-close"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
              >
                &times;
              </button>
            </div>
            
            <div className="navbar__mobile-drawer-divider" />
            
            <div className="navbar__mobile-drawer-links">
              <NavLink 
                to="/" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>🏠</span> Home
              </NavLink>
              <NavLink 
                to="/explore" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>🧭</span> Explore
              </NavLink>
              <NavLink 
                to="/about" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>✨</span> About Movientum
              </NavLink>
              <NavLink 
                to="/news" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>📰</span> News
              </NavLink>
              <NavLink 
                to="/rec-content" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>🧬</span> Content DNA
              </NavLink>
              
              {isLoggedIn && (
                <>
                  <NavLink 
                    to="/analysis" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span>🔮</span> Analysis
                  </NavLink>
                  <NavLink 
                    to="/dashboard" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span>📊</span> Dashboard
                  </NavLink>
                  <NavLink 
                    to="/settings" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span>⚙️</span> Settings
                  </NavLink>
                  {user?.role === 'admin' && (
                    <NavLink 
                      to="/admin" 
                      className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <span>🛡️</span> Admin Panel
                    </NavLink>
                  )}
                </>
              )}

              <button 
                className="navbar__mobile-drawer-link"
                onClick={() => {
                  setMobileMenuOpen(false)
                  setSearchOpen(true)
                }}
                style={{ background: 'none', border: 'none', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                <span>🔍</span> Search
              </button>
              
              <NavLink 
                to="/help" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>❓</span> Help
              </NavLink>
            </div>

            <div className="navbar__mobile-drawer-divider" />

            <div className="navbar__mobile-drawer-footer">
              {isLoggedIn ? (
                <div className="navbar__mobile-drawer-user-section">
                  <div className="navbar__mobile-drawer-user-info">
                    <div className="navbar__avatar" style={{ cursor: 'default' }}>
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={user?.username || 'User'}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        initials
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                      <span className="navbar__mobile-drawer-username">{user?.username || 'User'}</span>
                      <span className="navbar__mobile-drawer-email">{user?.email}</span>
                    </div>
                  </div>
                  <button 
                    className="btn btn--secondary btn--md w-full" 
                    style={{ marginTop: '16px', display: 'flex', justifyContent: 'center' }}
                    onClick={handleLogout}
                  >
                    Log Out
                  </button>
                </div>
              ) : (
                <div className="navbar__mobile-drawer-auth-buttons">
                  <Link to="/login" className="btn btn--secondary btn--md w-full" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setMobileMenuOpen(false)}>
                    Login
                  </Link>
                  <Link to="/signup" className="btn btn--primary btn--md w-full" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setMobileMenuOpen(false)}>
                    Sign Up
                  </Link>
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}
    </nav>
  )
}
