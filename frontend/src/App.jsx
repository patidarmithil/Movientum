/**
 * App.jsx — Router setup (Phase 3.5A)
 *
 * Phase 3.5A adds:
 *  - AuthProvider wrapper (global auth context)
 *  - /login, /register routes
 *  - /dashboard (ProtectedRoute)
 *  - /search placeholder (Phase 3.5B)
 *
 * 'mv:logout' custom event from api.js interceptor clears auth state.
 */
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import { AnimatePresence } from 'motion/react'
import PageTransition from './components/PageTransition'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import InstallPrompt from './components/InstallPrompt'
import InfoBanner from './components/InfoBanner'
import { Analytics } from '@vercel/analytics/react'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import MovieList from './pages/MovieList'
import MovieDetail from './pages/MovieDetail'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Recommendations from './pages/Recommendations'
import RecommendationsContent from './pages/RecommendationsContent'
import Search from './pages/Search'
import PersonPage from './pages/PersonPage'
import Explore from './pages/Explore'
import Analysis from './pages/Analysis'
import TVDetail from './pages/TVDetail'
import News from './pages/News'
import CompanyPage from './pages/CompanyPage'
import CountryPage from './pages/CountryPage'
import MostInterested from './pages/MostInterested'
import Help from './pages/Help'
import Privacy from './pages/Privacy'
import TermsOfService from './pages/TermsOfService'
import Intro from './pages/Intro'
import Feedback from './pages/Feedback'
import AdminDashboard from './pages/AdminDashboard'
import WatchlistDetail from './pages/WatchlistDetail'
import Settings from './pages/settings/Settings'
import SettingsProfile from './pages/settings/SettingsProfile'
import SettingsPassword from './pages/settings/SettingsPassword'
import SettingsDeleteAccount from './pages/settings/SettingsDeleteAccount'
import SettingsFeedback from './pages/settings/SettingsFeedback'
import SettingsMyIssues from './pages/settings/SettingsMyIssues'
import SettingsPrivacy from './pages/settings/SettingsPrivacy'
import SettingsTerms from './pages/settings/SettingsTerms'
import SettingsHelp from './pages/settings/SettingsHelp'
import SettingsImport from './pages/settings/SettingsImport'
import ScrollRestore from './components/ScrollRestore'
import ErrorBoundary from './components/ErrorBoundary'
import ErrorPage from './pages/ErrorPage'
import AnalyticsLoader from './components/AnalyticsLoader'
import './index.css'
import './components/Navbar.css'

// Listens for forced-logout event dispatched by api.js interceptor
function LogoutListener() {
  const { logout } = useAuth()
  useEffect(() => {
    const handler = () => logout()
    window.addEventListener('mv:logout', handler)
    return () => window.removeEventListener('mv:logout', handler)
  }, [logout])
  return null
}

function MobileRefreshDetector() {
  useEffect(() => {
    let lastScrollY = window.scrollY
    let lastTime = Date.now()
    let touchStartY = 0
    let touchStartTime = 0

    const handleScroll = () => {
      if (window.innerWidth > 768) return

      const currentScrollY = window.scrollY
      const currentTime = Date.now()
      const timeDiff = currentTime - lastTime

      if (timeDiff > 0) {
        const deltaY = currentScrollY - lastScrollY
        const velocity = deltaY / timeDiff // px/ms

        // Fast scroll up at top
        if (currentScrollY <= 5 && deltaY < -25 && velocity < -1.5) {
          window.location.reload()
        }
      }

      lastScrollY = currentScrollY
      lastTime = currentTime
    }

    const handleTouchStart = (e) => {
      if (window.innerWidth > 768) return
      if (window.scrollY <= 10) {
        touchStartY = e.touches[0].clientY
        touchStartTime = Date.now()
      }
    }

    const handleTouchEnd = (e) => {
      if (window.innerWidth > 768) return
      if (window.scrollY <= 10 && touchStartY > 0) {
        const touchEndY = e.changedTouches[0].clientY
        const touchEndTime = Date.now()
        const diffY = touchEndY - touchStartY
        const timeDiff = touchEndTime - touchStartTime

        if (timeDiff > 0 && timeDiff < 300) {
          const velocity = diffY / timeDiff
          if (diffY > 80 && velocity > 0.6) {
            window.location.reload()
          }
        }
      }
      touchStartY = 0
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  return null
}

function AppRoutes() {
  const location = useLocation()
  const { isLoggedIn } = useAuth()

  useEffect(() => {
    const path = location.pathname;
    let title = "Movientum — Your Movies, Your Way"; // default fallback

    if (path === "/" || path === "/intro" || path === "/about") {
      title = "About - Movientum";
    } else if (path === "/home") {
      title = "Home - Movientum";
    } else if (path === "/movies") {
      title = "Explore Movies - Movientum";
    } else if (path.startsWith("/movies/")) {
      title = "Movie Details - Movientum";
    } else if (path === "/login") {
      title = "Login - Movientum";
    } else if (path === "/register" || path === "/signup") {
      title = "Sign Up - Movientum";
    } else if (path === "/dashboard") {
      title = "Dashboard - Movientum";
    } else if (path === "/recommendations") {
      title = "Recommendations - Movientum";
    } else if (path === "/analysis") {
      title = "Analysis - Movientum";
    } else if (path === "/search") {
      title = "Search - Movientum";
    } else if (path === "/rec-content") {
      title = "Recommendation Content - Movientum";
    } else if (path.startsWith("/person/")) {
      title = "Person - Movientum";
    } else if (path === "/explore") {
      title = "Explore - Movientum";
    } else if (path === "/most-interested") {
      title = "Most Interested - Movientum";
    } else if (path === "/help") {
      title = "Help - Movientum";
    } else if (path === "/privacy") {
      title = "Privacy Policy - Movientum";
    } else if (path === "/terms" || path === "/terms-of-service") {
      title = "Terms of Service - Movientum";
    } else if (path.startsWith("/tv/")) {
      title = "TV Show Details - Movientum";
    } else if (path === "/news") {
      title = "News - Movientum";
    } else if (path.startsWith("/company/")) {
      title = "Company - Movientum";
    } else if (path.startsWith("/country/")) {
      title = "Country - Movientum";
    } else if (path === "/admin") {
      title = "Admin Dashboard - Movientum";
    } else if (path.startsWith("/settings")) {
      title = "Settings - Movientum";
    } else if (path.startsWith("/watchlists/")) {
      title = "Watchlist - Movientum";
    }

    document.title = title;
  }, [location.pathname]);

  return (
    <>
      <LogoutListener />
      <MobileRefreshDetector />
      <ScrollRestore />
      <Navbar />
      <InstallPrompt />
      <InfoBanner />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          <Route 
            path="/" 
            element={
              isLoggedIn || localStorage.getItem('hasSeenIntro') === 'true' ? (
                <PageTransition><Navigate to="/home" replace /></PageTransition>
              ) : (
                <PageTransition><Intro /></PageTransition>
              )
            } 
          />
          <Route path="/home"       element={<PageTransition><Home /></PageTransition>} />
          <Route path="/movies"     element={<PageTransition><MovieList /></PageTransition>} />
          <Route path="/movies/:id" element={<PageTransition><MovieDetail /></PageTransition>} />
          <Route path="/login"      element={<PageTransition><Login /></PageTransition>} />
          <Route path="/register"   element={<PageTransition><Register /></PageTransition>} />
          <Route path="/signup"     element={<PageTransition><Register /></PageTransition>} />

          {/* Protected */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <PageTransition><Dashboard /></PageTransition>
              </ProtectedRoute>
            }
          />

          <Route
            path="/recommendations"
            element={
              <ProtectedRoute>
                <PageTransition><Recommendations /></PageTransition>
              </ProtectedRoute>
            }
          />

          <Route
            path="/analysis"
            element={
              <ProtectedRoute>
                <PageTransition><Analysis /></PageTransition>
              </ProtectedRoute>
            }
          />

          {/* Phase 3.5B — Search */}
          <Route path="/search" element={<PageTransition><Search /></PageTransition>} />

          <Route path="/rec-content" element={<PageTransition><RecommendationsContent /></PageTransition>} />

          {/* Improvement 1.4 — Person */}
          <Route path="/person/:id" element={<PageTransition><PersonPage /></PageTransition>} />

          {/* Improvement 1.6 — Explore */}
          <Route path="/explore" element={<PageTransition><Explore /></PageTransition>} />

          {/* Most Interested Full List */}
          <Route path="/most-interested" element={<PageTransition><MostInterested /></PageTransition>} />

          {/* Improvement H — Help (Public standalone route) */}
          <Route path="/help" element={<PageTransition><Help /></PageTransition>} />
          
          {/* Legal Pages (Dual Routed) */}
          <Route path="/privacy" element={<PageTransition><Privacy /></PageTransition>} />
          <Route path="/terms" element={<PageTransition><TermsOfService /></PageTransition>} />
          <Route path="/terms-of-service" element={<PageTransition><TermsOfService /></PageTransition>} />

          {/* Landing / Intro page (standalone route) */}
          <Route path="/intro" element={<PageTransition><Intro /></PageTransition>} />
          <Route path="/about" element={<PageTransition><Intro /></PageTransition>} />

          {/* Improvement 1.7 — TV Shows */}
          <Route path="/tv/:id" element={<PageTransition><TVDetail /></PageTransition>} />

          {/* News */}
          <Route path="/news" element={<PageTransition><News /></PageTransition>} />

          {/* Production company & country browse */}
          <Route path="/company/:id"    element={<PageTransition><CompanyPage /></PageTransition>} />
          <Route path="/country/:iso"   element={<PageTransition><CountryPage /></PageTransition>} />

          {/* Feedback & Admin */}
          <Route path="/feedback" element={<Navigate to="/settings/feedback" replace />} />
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute>
                <PageTransition><AdminDashboard /></PageTransition>
              </ProtectedRoute>
            } 
          />

          {/* Settings */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <PageTransition><Settings /></PageTransition>
              </ProtectedRoute>
            }
          >
            <Route path="profile" element={<SettingsProfile />} />
            <Route path="password" element={<SettingsPassword />} />
            <Route path="delete-account" element={<SettingsDeleteAccount />} />
            <Route path="feedback" element={<SettingsFeedback />} />
            <Route path="my-issues" element={<SettingsMyIssues />} />
            <Route path="privacy" element={<SettingsPrivacy />} />
            <Route path="terms" element={<SettingsTerms />} />
            <Route path="help" element={<SettingsHelp />} />
            <Route path="import" element={<SettingsImport />} />
          </Route>
          
          {/* Phase 4 — Watchlist Detail */}
          <Route
            path="/watchlists/:collectionId"
            element={
              <ProtectedRoute>
                <PageTransition><WatchlistDetail /></PageTransition>
              </ProtectedRoute>
            }
          />

          {/* 404 fallback */}
          <Route path="*" element={<PageTransition><ErrorPage type="404" /></PageTransition>} />
        </Routes>
      </AnimatePresence>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <AnalyticsLoader />
          <AppRoutes />
          <Analytics />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
