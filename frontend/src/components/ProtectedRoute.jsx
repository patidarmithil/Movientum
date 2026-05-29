/**
 * ProtectedRoute.jsx — Phase 3.5A
 *
 * Wraps routes that require authentication.
 * While session is loading → renders null (avoids flash).
 * Not logged in → redirects to /login?redirect={currentPath}
 */
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function ProtectedRoute({ children }) {
  const { isLoggedIn, isLoading } = useAuth()
  const location = useLocation()

  // Session still loading — show nothing (skeleton could go here)
  if (isLoading) return null

  if (!isLoggedIn) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname)}`}
        replace
      />
    )
  }

  return children
}
