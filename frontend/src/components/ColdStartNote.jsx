import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './ColdStartNote.css'

// Shown above For You when the backend says the user has no ratings or history
// yet (`cold_start: true`), so the picks are community favourites rather than
// personal ones. Dismissal is per user and only hides the note, not the picks.
const dismissKey = (user) => `mv:coldnote:${user?.username || user?.id || 'me'}`

function readDismissed(user) {
  try {
    return localStorage.getItem(dismissKey(user)) === '1'
  } catch {
    return false
  }
}

export default function ColdStartNote({ show }) {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(() => readDismissed(user))

  if (!show || dismissed) return null

  const dismiss = () => {
    setDismissed(true)
    try { localStorage.setItem(dismissKey(user), '1') } catch { /* private mode */ }
  }

  return (
    <div className="cold-note" role="note">
      <span className="cold-note__icon" aria-hidden="true">✦</span>
      <p className="cold-note__text">
        These are community favourites. Rate a few titles or{' '}
        <Link to="/settings/import">import your watch history</Link> and this row becomes yours.
      </p>
      <button type="button" className="cold-note__close" aria-label="Dismiss" onClick={dismiss}>×</button>
    </div>
  )
}
