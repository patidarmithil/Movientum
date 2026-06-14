import { Link, NavLink, useNavigate } from 'react-router-dom'
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
  const [dropOpen, setDropOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const dropRef = useRef(null)
  
  const [notifications, setNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const notifRef = useRef(null)

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

  const unreadCount = notifications.filter(n => !n.seen).length

  const handleNotifClick = () => {
    setNotifOpen(!notifOpen)
    if (!notifOpen && unreadCount > 0) {
      notificationService.markAllSeen().then(() => {
        setNotifications(notifications.map(n => ({...n, seen: true})))
      })
    }
  }

  // Avatar initials from user name/email
  const initials = user
    ? (user.username || user.name || user.email || '?').charAt(0).toUpperCase()
    : '?'

  return (
    <nav
      className="navbar"
      role="navigation"
      aria-label="Main navigation"
      style={{
        background: 'rgba(13, 14, 18, 0.8)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)'
      }}
    >
      <div className="navbar__inner">
        
        {/* ── Logo + Brand Name + Beta Symbol ── */}
        <Link to="/" className="navbar__logo" aria-label="Movientum home" onClick={() => setMobileMenuOpen(false)}>
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
          
          {/* Search Trigger */}
          <SearchOverlay isOpen={searchOpen} setIsOpen={setSearchOpen} />
          
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

              {/* Feedback nav button */}
              <NavLink
                to="/feedback"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span>Feedback</span>
              </NavLink>
            </>
          )}

          {/* Auth Actions (Avatar dropdown or Login / SignUp buttons) */}
          <div className="navbar__actions">
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
                      {notifications.length === 0 ? (
                        <div className="navbar__notif-empty">No notifications</div>
                      ) : (
                        notifications.map(n => (
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
                      to="/news"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-news"
                      onClick={() => setDropOpen(false)}
                    >
                      <span>📰</span> News
                    </Link>
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
                    <Link
                      to="/feedback"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-feedback"
                      onClick={() => setDropOpen(false)}
                    >
                      <span>💡</span> Feedback
                    </Link>
                    {user?.role === 'admin' && (
                      <Link
                        to="/admin"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-admin"
                        onClick={() => setDropOpen(false)}
                      >
                        <span>🛡️</span> Admin Panel
                      </Link>
                    )}
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
              <div className="navbar__auth-desktop-buttons">
                <Link to="/login" className="btn btn--ghost btn--sm" id="nav-login">
                  Login
                </Link>
                <Link to="/register" className="btn btn--primary btn--sm" id="nav-register">
                  Sign Up
                </Link>
              </div>
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
              <Link to="/" className="navbar__logo" onClick={() => setMobileMenuOpen(false)}>
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
              
              <NavLink 
                to="/news" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <span>📰</span> News
              </NavLink>
              
              {isLoggedIn && (
                <>
                  <NavLink 
                    to="/dashboard" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span>📊</span> Dashboard
                  </NavLink>
                  <NavLink 
                    to="/analysis" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span>🔮</span> Analysis
                  </NavLink>
                  <NavLink 
                    to="/feedback" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <span>💡</span> Feedback
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
            </div>

            <div className="navbar__mobile-drawer-divider" />

            <div className="navbar__mobile-drawer-footer">
              {isLoggedIn ? (
                <div className="navbar__mobile-drawer-user-section">
                  <div className="navbar__mobile-drawer-user-info">
                    <div className="navbar__avatar" style={{ cursor: 'default' }}>{initials}</div>
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
                  <Link to="/register" className="btn btn--primary btn--md w-full" style={{ display: 'flex', justifyContent: 'center' }} onClick={() => setMobileMenuOpen(false)}>
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
