import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../context/AuthContext'
import { watchlistService } from '../services/watchlistService'
import { planToWatchService } from '../services/planToWatchService'
import SearchOverlay from './SearchOverlay'
import TrailerModal from './TrailerModal'
import api from '../utils/api'
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
  
  const [trailerModalOpen, setTrailerModalOpen] = useState(false)
  const [trailerModalData, setTrailerModalData] = useState(null)
  const [trailerModalSeasons, setTrailerModalSeasons] = useState([])
  const [trailerModalMediaType, setTrailerModalMediaType] = useState('')
  const [trailerModalContentId, setTrailerModalContentId] = useState(null)
  const [trailerModalInitialSeason, setTrailerModalInitialSeason] = useState("all")

  const [activeNotifTab, setActiveNotifTab] = useState('released')
  const [clearedNotifs, setClearedNotifs] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('wl_notifs_cleared_list') || '[]')
    } catch {
      return []
    }
  })

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

  const formatDayMonth = (dateStr) => {
    const d = new Date(dateStr)
    const day = d.getDate()
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    const monthName = months[d.getMonth()]
    
    let suffix = 'th'
    if (day === 1 || day === 21 || day === 31) suffix = 'st'
    else if (day === 2 || day === 22) suffix = 'nd'
    else if (day === 3 || day === 23) suffix = 'rd'
    
    return `${day}${suffix} ${monthName}`
  }

  useEffect(() => {
    if (isLoggedIn) {
      const fetchWatchlistNotifications = async () => {
        try {
          // Reset notifications for testing as requested
          localStorage.removeItem('wl_notifs_seen')
          localStorage.removeItem('wl_notifs_cleared_list')

          const items = await planToWatchService.getItemsWithDetails()
          
          const now = new Date()
          const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
          
          const notifs = []
          const seenIds = new Set()
          
          for (const item of items) {
            const movie = item.movie
            if (!movie) continue
            if (seenIds.has(movie.id)) continue
            seenIds.add(movie.id)
            
            const isTv = movie.type === 'tv' || !!movie.first_air_date || (item.media_type === 'tv')
            
            if (!isTv) {
              const releaseDateStr = movie.release_date
              if (!releaseDateStr) continue
              const releaseDate = new Date(releaseDateStr)
              const diffTime = Math.floor((releaseDate - today) / (1000 * 60 * 60 * 24))
              
              if (diffTime <= 0) {
                notifs.push({
                  id: `notif-${movie.id}`,
                  message: `Released Movie: ${movie.title || movie.name}`,
                  poster_path: movie.poster_path,
                  created_at: releaseDate.toISOString(),
                  diff_days: diffTime,
                  category: 'released',
                  seen: false,
                  media_type: 'movie',
                  media_id: movie.id,
                  movie: movie
                })
              } else {
                notifs.push({
                  id: `notif-${movie.id}`,
                  message: `Releasing on ${formatDayMonth(releaseDate)}: ${movie.title || movie.name}`,
                  poster_path: movie.poster_path,
                  created_at: releaseDate.toISOString(),
                  diff_days: diffTime,
                  category: 'upcoming',
                  seen: false,
                  media_type: 'movie',
                  media_id: movie.id,
                  movie: movie
                })
              }
            } else {
              const firstAirDateStr = movie.first_air_date
              if (!firstAirDateStr) continue
              const firstAirDate = new Date(firstAirDateStr)
              const diffTime = Math.floor((firstAirDate - today) / (1000 * 60 * 60 * 24))
              
              if (diffTime > 0) {
                // Not yet aired -> Upcoming
                notifs.push({
                  id: `notif-${movie.id}`,
                  message: `${movie.name || movie.title}`,
                  poster_path: movie.poster_path,
                  created_at: firstAirDate.toISOString(),
                  diff_days: diffTime,
                  category: 'upcoming',
                  seen: false,
                  media_type: 'tv',
                  media_id: movie.id,
                  movie: movie
                })
              } else {
                // Released with few episodes (first_air_date <= today)
                const nextEp = movie.next_episode_to_air
                if (nextEp && nextEp.air_date) {
                  const epAirDate = new Date(nextEp.air_date)
                  const epDiffTime = Math.floor((epAirDate - today) / (1000 * 60 * 60 * 24))
                  
                  if (epDiffTime === 0) {
                    const seasonNum = nextEp.season_number || 1
                    const episodeNum = nextEp.episode_number || 1
                    const message = `Season ${seasonNum} Episode ${episodeNum} of ${movie.name || movie.title} was released`
                    
                    notifs.push({
                      id: `notif-${movie.id}-ep-${nextEp.id || episodeNum}`,
                      message: message,
                      poster_path: movie.poster_path,
                      created_at: epAirDate.toISOString(),
                      diff_days: epDiffTime,
                      category: 'released',
                      seen: false,
                      media_type: 'tv',
                      media_id: movie.id,
                      movie: movie,
                      season_number: seasonNum
                    })
                  } else if (epDiffTime > 0) {
                    const seasonNum = nextEp.season_number || 1
                    const episodeNum = nextEp.episode_number || 1
                    const message = `Season ${seasonNum} Episode ${episodeNum} of ${movie.name || movie.title}`
                    
                    notifs.push({
                      id: `notif-${movie.id}-ep-${nextEp.id || episodeNum}`,
                      message: message,
                      poster_path: movie.poster_path,
                      created_at: epAirDate.toISOString(),
                      diff_days: epDiffTime,
                      category: 'upcoming',
                      seen: false,
                      media_type: 'tv',
                      media_id: movie.id,
                      movie: movie,
                      season_number: seasonNum
                    })
                  }
                }
              }
            }
          }
          
          notifs.sort((a, b) => {
            const dateA = new Date(a.created_at)
            const dateB = new Date(b.created_at)
            if (a.category === 'upcoming' && b.category === 'upcoming') {
              return dateA - dateB // Closest upcoming first
            }
            return dateB - dateA // Latest released first
          })
          
          const savedSeen = JSON.parse(localStorage.getItem('wl_notifs_seen') || '{}')
          const finalNotifs = notifs.map(n => ({
            ...n,
            seen: savedSeen[n.id] || false
          }))
          
          setNotifications(finalNotifs)
        } catch (error) {
          console.error("Failed to load watchlist notifications", error)
        }
      }
      
      fetchWatchlistNotifications()
    } else {
      setNotifications([])
    }
  }, [isLoggedIn])

  const safeNotifications = Array.isArray(notifications) ? notifications : []
  const visibleNotifications = safeNotifications.filter(n => !clearedNotifs.includes(n.id))
  const unreadCount = visibleNotifications.filter(n => !n.seen && n.category === 'released').length

  const handleNotifClick = () => {
    setNotifOpen(!notifOpen)
    if (!notifOpen && unreadCount > 0) {
      const savedSeen = JSON.parse(localStorage.getItem('wl_notifs_seen') || '{}')
      visibleNotifications.forEach(n => savedSeen[n.id] = true)
      localStorage.setItem('wl_notifs_seen', JSON.stringify(savedSeen))
      setNotifications(safeNotifications.map(n => ({...n, seen: savedSeen[n.id] || false})))
    }
  }

  const handleClearNotifs = () => {
    const idsToClear = safeNotifications.map(n => n.id)
    const newCleared = [...clearedNotifs, ...idsToClear]
    setClearedNotifs(newCleared)
    localStorage.setItem('wl_notifs_cleared_list', JSON.stringify(newCleared))
  }

  const filteredNotifs = visibleNotifications.filter(n => n.category === activeNotifTab)

  const handlePlayTrailer = async (e, n) => {
    e.stopPropagation();
    try {
      const endpoint = n.media_type === 'tv' ? `/api/v1/tv/${n.media_id}/videos` : `/api/v1/movies/${n.media_id}/videos`;
      const r = await api.get(endpoint);
      setTrailerModalData(r.data);
      setTrailerModalContentId(n.media_id);
      setTrailerModalMediaType(n.media_type);
      setTrailerModalSeasons(n.movie?.seasons || []);
      setTrailerModalInitialSeason(n.season_number || "all");
      setTrailerModalOpen(true);
    } catch (err) {
      console.error("Failed to load trailer", err);
    }
  }

  const renderNotifItem = (n) => {
    const handleItemClick = () => {
      if (n.media_id && n.media_type) {
        setNotifOpen(false)
        navigate(`/${n.media_type === 'tv' ? 'tv' : 'movies'}/${n.media_id}`)
      }
    }
    
    return (
      <div
        key={n.id}
        className="navbar__notif-item"
        style={{ opacity: 1, cursor: 'pointer' }}
        onClick={handleItemClick}
      >
      {n.poster_path && (
        <img 
          src={`https://image.tmdb.org/t/p/w92${n.poster_path}`} 
          alt=""
        />
      )}
      <div className="navbar__notif-content">
        <span className="navbar__notif-message">
          {n.message}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
          <span className="navbar__notif-date">
            {formatDayMonth(n.created_at)}
          </span>
          <button 
            onClick={(e) => handlePlayTrailer(e, n)}
            style={{ 
              background: 'rgba(229, 9, 20, 0.1)', 
              border: 'none', 
              borderRadius: '4px',
              padding: '2px 6px',
              cursor: 'pointer', 
              display: 'flex', 
              alignItems: 'center', 
              color: '#E50914',
              gap: '4px',
              fontSize: '11px',
              fontWeight: '600'
            }}
            title="Play Trailer"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
            TRAILER
          </button>
        </div>
      </div>
    </div>
  )
  }

  const addTestNotification = () => {
    const newNotif = {
      id: Date.now(),
      message: "This is a test notification. Notifications are working!",
      seen: false,
      created_at: new Date().toISOString(),
      category: 'released'
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
              <a href="https://drive.google.com/file/d/1PcqTQEhuijVDgiO9vu-e9unlm5KCt1qx/view?usp=sharing" target="_blank" rel="noopener noreferrer" className="btn btn--ghost btn--sm" style={{ marginRight: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
                Documentation
              </a>
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

              {/* Recommendations nav button */}
              <NavLink
                to="/recommendations"
                className={({ isActive }) =>
                  `navbar__link navbar__link--icon${isActive ? ' navbar__link--active' : ''}`
                }
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
                  <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5Z"/>
                  <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z"/>
                </svg>
                <span>Recommendations</span>
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
                    <div className="navbar__notif-header">
                      <span>Notifications</span>
                      <button className="navbar__notif-clear-btn" onClick={handleClearNotifs} title="Clean History">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m15 4-2-2H9v3h10v-1Z"/>
                          <path d="M20 9H4v2h16V9Z"/>
                          <path d="M5 11v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>
                          <path d="M9 11v5"/>
                          <path d="M12 11v5"/>
                          <path d="M15 11v5"/>
                        </svg>
                      </button>
                    </div>
                    <div className="navbar__notif-tabs">
                      <button className={`navbar__notif-tab ${activeNotifTab === 'released' ? 'active' : ''}`} onClick={() => setActiveNotifTab('released')}>Released</button>
                      <button className={`navbar__notif-tab ${activeNotifTab === 'upcoming' ? 'active' : ''}`} onClick={() => setActiveNotifTab('upcoming')}>Upcoming</button>
                    </div>
                    <div className="navbar__notif-list">
                      {filteredNotifs.length === 0 ? (
                        <div className="navbar__notif-empty">
                          No notifications
                        </div>
                      ) : (
                        filteredNotifs.map(renderNotifItem)
                      )}
                    </div>
                    <div className="navbar__notif-footer">
                      Notifications are automatically removed after 30 days
                    </div>
                  </div>
                )}
              </div>
            )}

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
                      to="/explore"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-explore"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <circle cx="12" cy="12" r="10"></circle>
                        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                      </svg> Explore
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
                      to="/recommendations"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-recommendations"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
                        <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5Z"/>
                        <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z"/>
                      </svg> Recommendations
                    </Link>
                    <Link
                      to="/rec-content"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      id="nav-dna"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                      </svg> DNA
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
                    <a
                      href="https://drive.google.com/file/d/1PcqTQEhuijVDgiO9vu-e9unlm5KCt1qx/view?usp=sharing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="navbar__dropdown-item"
                      role="menuitem"
                      onClick={() => setDropOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                      </svg> Documentation
                    </a>

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
              <>
                <div className="navbar__auth-desktop-buttons">
                  <Link to="/login" className="btn btn--ghost btn--sm" id="nav-login">
                    Login
                  </Link>
                  <Link to="/signup" className="btn btn--primary btn--sm" id="nav-register">
                    Sign Up
                  </Link>
                </div>

                {/* Mobile avatar dropdown trigger for guest users */}
                <div className="navbar__user navbar__user--mobile-only" ref={dropRef}>
                  <button
                    className="navbar__avatar"
                    id="navbar-avatar-btn-guest"
                    aria-label="User menu"
                    aria-expanded={dropOpen}
                    aria-haspopup="true"
                    onClick={() => setDropOpen((v) => !v)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </button>

                  {dropOpen && (
                    <div className="navbar__dropdown" role="menu" id="navbar-dropdown">
                      <div className="navbar__dropdown-user">
                        <span className="navbar__dropdown-name">Guest User</span>
                        <span className="navbar__dropdown-email">Please log in to sync progress</span>
                      </div>
                      <div className="navbar__dropdown-divider" />
                      <Link
                        to="/login"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-login"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                          <polyline points="10 17 15 12 10 7" />
                          <line x1="15" y1="12" x2="3" y2="12" />
                        </svg> Login
                      </Link>
                      <Link
                        to="/signup"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-register"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="8.5" cy="7" r="4" />
                          <line x1="20" y1="8" x2="20" y2="14" />
                          <line x1="23" y1="11" x2="17" y2="11" />
                        </svg> Sign Up
                      </Link>
                      <div className="navbar__dropdown-divider" />
                      <Link
                        to="/news"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-news"
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
                        to="/explore"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-explore"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <circle cx="12" cy="12" r="10"></circle>
                          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                        </svg> Explore
                      </Link>
                      <Link
                        to="/rec-content"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-dna"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                          <line x1="12" y1="22.08" x2="12" y2="12"></line>
                        </svg> DNA
                      </Link>
                      <Link
                        to="/recommendations"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-recommendations"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
                          <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5Z"/>
                          <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z"/>
                        </svg> Recommendations
                      </Link>
                      <a
                        href="https://drive.google.com/file/d/1PcqTQEhuijVDgiO9vu-e9unlm5KCt1qx/view?usp=sharing"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg> Documentation
                      </a>
                      <Link
                        to="/analysis"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-analysis"
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
                        to="/help"
                        className="navbar__dropdown-item"
                        role="menuitem"
                        id="nav-dropdown-help"
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
                        id="nav-dropdown-about"
                        onClick={() => setDropOpen(false)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg" style={{ marginRight: '8px' }}>
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="16" x2="12" y2="12"></line>
                          <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg> About
                      </Link>
                    </div>
                  )}
                </div>
              </>
            )}

          {/* Search Trigger */}
          {!(location.pathname === '/intro' || location.pathname === '/about' || (location.pathname === '/' && !isLoggedIn)) && (
            <SearchOverlay isOpen={searchOpen} setIsOpen={setSearchOpen} />
          )}


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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg> Home
              </NavLink>
              <NavLink 
                to="/explore" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"></polygon>
                </svg> Explore
              </NavLink>
              <NavLink 
                to="/about" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg> About Movientum
              </NavLink>
              <NavLink 
                to="/news" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" />
                  <path d="M2 12h10" />
                  <path d="M2 17h10" />
                  <path d="M2 7h4" />
                </svg> News
              </NavLink>
              <NavLink 
                to="/rec-content" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg> Content DNA
              </NavLink>
              <NavLink 
                to="/recommendations" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
                  <path d="m5 3 1 2.5L8.5 6 6 7 5 9.5 4 7 1.5 6 4 5Z"/>
                  <path d="m19 17 1 2.5 2.5.5-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1Z"/>
                </svg> Recommendations
              </NavLink>
              
              {isLoggedIn && (
                <>
                  <NavLink 
                    to="/analysis" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
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
                    </svg> Analysis
                  </NavLink>
                  <NavLink 
                    to="/dashboard" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                      <line x1="18" y1="20" x2="18" y2="10"></line>
                      <line x1="12" y1="20" x2="12" y2="4"></line>
                      <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg> Dashboard
                  </NavLink>
                  <NavLink 
                    to="/settings" 
                    className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                      <circle cx="12" cy="12" r="3"></circle>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                    </svg> Settings
                  </NavLink>
                  {user?.role === 'admin' && (
                    <NavLink 
                      to="/admin" 
                      className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      </svg> Admin Panel
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg> Search
              </button>
              
              <NavLink 
                to="/help" 
                className={({ isActive }) => `navbar__mobile-drawer-link${isActive ? ' navbar__mobile-drawer-link--active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="nav-icon-svg">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg> Help
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
      {/* Trailer Modal Overlay */}
      {trailerModalData && (
        <TrailerModal
          isOpen={trailerModalOpen}
          onClose={() => setTrailerModalOpen(false)}
          data={trailerModalData}
          seasons={trailerModalSeasons}
          tvId={trailerModalMediaType === 'tv' ? trailerModalContentId : null}
          contentId={trailerModalContentId}
          mediaType={trailerModalMediaType}
          initialSeason={trailerModalInitialSeason}
        />
      )}
    </nav>
  )
}
