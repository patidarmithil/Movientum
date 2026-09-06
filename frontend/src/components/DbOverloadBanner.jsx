import { useEffect, useState } from 'react'
import './DbOverloadBanner.css'

const RESET_DAY = 6

function formatOrdinal(day) {
  if (day === 1 || day === 21 || day === 31) return `${day}st`
  if (day === 2 || day === 22) return `${day}nd`
  if (day === 3 || day === 23) return `${day}rd`
  return `${day}th`
}

function getNextResetDate() {
  const now = new Date()
  const resetThisMonth = new Date(now.getFullYear(), now.getMonth(), RESET_DAY)
  const target = now.getDate() < RESET_DAY ? resetThisMonth : new Date(now.getFullYear(), now.getMonth() + 1, RESET_DAY)
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${formatOrdinal(target.getDate())} ${months[target.getMonth()]}`
}

/**
 * Non-blocking apology toast shown when both backends fail with a server/network
 * error in a row (see api.js maybeSignalDbOverload) — read as the Supabase
 * free-tier egress cap being hit. Doesn't cover the page; the site stays usable.
 */
export default function DbOverloadBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const handler = () => setVisible(true)
    window.addEventListener('mv:db-overload', handler)
    return () => window.removeEventListener('mv:db-overload', handler)
  }, [])

  if (!visible) return null

  return (
    <div className="db-overload-toast" role="status" aria-live="polite">
      <button className="db-overload-close" onClick={() => setVisible(false)} aria-label="Dismiss">&times;</button>
      <div className="db-overload-icon">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      </div>
      <div className="db-overload-text">
        <p className="db-overload-desc">
          Sorry if something's broken right now — we're aware and fixing it. Feel free to keep browsing; full service resumes on <strong>{getNextResetDate()}</strong>.
        </p>
      </div>
    </div>
  )
}
