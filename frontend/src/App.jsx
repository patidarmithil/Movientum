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
import TVDetail from './pages/TVDetail'
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
      <Navbar />
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

        {/* Phase 3.5B — Search */}
        <Route path="/search" element={<Search />} />

        {/* Improvement 1.4 — Person */}
        <Route path="/person/:id" element={<PersonPage />} />

        {/* Improvement 1.6 — Explore */}
        <Route path="/explore" element={<Explore />} />

        {/* Improvement 1.7 — TV Shows */}
        <Route path="/tv/:id" element={<TVDetail />} />

        {/* 404 fallback */}
        <Route
          path="*"
          element={
            <main style={{ padding: '120px 24px', textAlign: 'center' }}>
              <h1 style={{ fontFamily: 'Outfit, sans-serif', color: '#fff', fontSize: '2rem' }}>
                404 — Page Not Found
              </h1>
              <p style={{ color: '#9CA3AF', marginTop: '12px' }}>
                <a href="/" style={{ color: '#B048FF' }}>Go home →</a>
              </p>
            </main>
          }
        />
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
