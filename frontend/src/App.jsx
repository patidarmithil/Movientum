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
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useEffect } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Navbar from './components/Navbar'
import InstallPrompt from './components/InstallPrompt'
import { Analytics } from '@vercel/analytics/react'
import ProtectedRoute from './components/ProtectedRoute'
import Home from './pages/Home'
import MovieList from './pages/MovieList'
import MovieDetail from './pages/MovieDetail'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Search from './pages/Search'
import PersonPage from './pages/PersonPage'
import Explore from './pages/Explore'
import Analysis from './pages/Analysis'
import TVDetail from './pages/TVDetail'
import News from './pages/News'
import CompanyPage from './pages/CompanyPage'
import CountryPage from './pages/CountryPage'
import Help from './pages/Help'
import Feedback from './pages/Feedback'
import AdminDashboard from './pages/AdminDashboard'
import ScrollRestore from './components/ScrollRestore'
import ErrorBoundary from './components/ErrorBoundary'
import ErrorPage from './pages/ErrorPage'
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

function AppRoutes() {
  return (
    <>
      <LogoutListener />
      <ScrollRestore />
      <Navbar />
      <InstallPrompt />
      <Routes>
        {/* Public */}
        <Route path="/"           element={<Home />} />
        <Route path="/movies"     element={<MovieList />} />
        <Route path="/movies/:id" element={<MovieDetail />} />
        <Route path="/login"      element={<Login />} />
        <Route path="/register"   element={<Register />} />

        {/* Protected */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/analysis"
          element={
            <ProtectedRoute>
              <Analysis />
            </ProtectedRoute>
          }
        />

        {/* Phase 3.5B — Search */}
        <Route path="/search" element={<Search />} />

        {/* Improvement 1.4 — Person */}
        <Route path="/person/:id" element={<PersonPage />} />

        {/* Improvement 1.6 — Explore */}
        <Route path="/explore" element={<Explore />} />

        {/* Improvement H — Help */}
        <Route path="/help" element={<Help />} />

        {/* Improvement 1.7 — TV Shows */}
        <Route path="/tv/:id" element={<TVDetail />} />

        {/* News */}
        <Route path="/news" element={<News />} />

        {/* Production company & country browse */}
        <Route path="/company/:id"    element={<CompanyPage />} />
        <Route path="/country/:iso"   element={<CountryPage />} />

        {/* Feedback & Admin */}
        <Route
          path="/feedback"
          element={
            <ProtectedRoute>
              <Feedback />
            </ProtectedRoute>
          }
        />
        <Route 
          path="/admin" 
          element={
            <ProtectedRoute>
              <AdminDashboard />
            </ProtectedRoute>
          } 
        />
        {/* 404 fallback */}
        <Route path="*" element={<ErrorPage type="404" />} />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AuthProvider>
          <AppRoutes />
          <Analytics />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
