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
import { useEffect, lazy, Suspense } from 'react'
import { AnimatePresence } from 'motion/react'
import PageTransition from './components/PageTransition'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import InstallPrompt from './components/InstallPrompt'
import InfoBanner from './components/InfoBanner'
import { Analytics } from '@vercel/analytics/react'
import ProtectedRoute from './components/ProtectedRoute'

// ── Route splitting ──────────────────────────────────────────────
// Every page used to sit in one JS chunk, so opening a movie meant downloading,
// parsing and executing the admin dashboard, the settings tree and the analysis
// page first — and only then could the page fire its first API request.
//
// The four pages below stay eager on purpose: they are the entry points almost
// every session starts from, and lazy-loading them would insert a chunk round
// trip *before* the page can even ask the backend for its data — the opposite of
// what this change is for. Everything else loads on navigation.
import Home from './pages/Home'
import MovieDetail from './pages/MovieDetail'
import TVDetail from './pages/TVDetail'
import Intro from './pages/Intro'

const MovieList = lazy(() => import('./pages/MovieList'))
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Recommendations = lazy(() => import('./pages/Recommendations'))
const RecommendationsContent = lazy(() => import('./pages/RecommendationsContent'))
const Search = lazy(() => import('./pages/Search'))
const PersonPage = lazy(() => import('./pages/PersonPage'))
const Explore = lazy(() => import('./pages/Explore'))
const Analysis = lazy(() => import('./pages/Analysis'))
const News = lazy(() => import('./pages/News'))
const CompanyPage = lazy(() => import('./pages/CompanyPage'))
const CountryPage = lazy(() => import('./pages/CountryPage'))
const MostInterested = lazy(() => import('./pages/MostInterested'))
const Help = lazy(() => import('./pages/Help'))
const Privacy = lazy(() => import('./pages/Privacy'))
const TermsOfService = lazy(() => import('./pages/TermsOfService'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const WatchlistDetail = lazy(() => import('./pages/WatchlistDetail'))
const Settings = lazy(() => import('./pages/settings/Settings'))
const SettingsProfile = lazy(() => import('./pages/settings/SettingsProfile'))
const SettingsPassword = lazy(() => import('./pages/settings/SettingsPassword'))
const SettingsDeleteAccount = lazy(() => import('./pages/settings/SettingsDeleteAccount'))
const SettingsFeedback = lazy(() => import('./pages/settings/SettingsFeedback'))
const SettingsMyIssues = lazy(() => import('./pages/settings/SettingsMyIssues'))
const SettingsPrivacy = lazy(() => import('./pages/settings/SettingsPrivacy'))
const SettingsTerms = lazy(() => import('./pages/settings/SettingsTerms'))
const SettingsHelp = lazy(() => import('./pages/settings/SettingsHelp'))
const SettingsImport = lazy(() => import('./pages/settings/SettingsImport'))

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
  const { isLoggedIn, isLoading } = useAuth()

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
      {/* Suspense sits OUTSIDE AnimatePresence on purpose: AnimatePresence only
          tracks its direct child, so slotting a wrapper between it and the keyed
          <Routes> would break the page exit transitions.
          The fallback is deliberately empty — a lazy chunk resolves in tens of
          milliseconds on a warm connection, and flashing a spinner for that long
          reads as slower than showing nothing. */}
      <Suspense fallback={null}>
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          {/* Public */}
          {/* The root is a fork, never a destination: signed-in visitors land on
              /home, everyone else on /intro. Rendered as a redirect rather than
              the Intro component so the address bar matches the page.
              `isLoading` is held on deliberately — the session resolves
              asynchronously, and redirecting before it does would bounce a
              signed-in visitor with a stored token out to /intro. */}
          <Route
            path="/"
            element={
              isLoading ? null : <Navigate to={isLoggedIn ? '/home' : '/intro'} replace />
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
      </Suspense>
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
