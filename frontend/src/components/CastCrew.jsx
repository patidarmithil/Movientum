/**
 * CastCrew.jsx — Phase 1.3 (Improvement)
 *
 * Fetches /api/v1/movies/{movieId}/credits from the backend.
 * Backend calls TMDB live, caches 24 h in Redis.
 * No profile data stored in our DB.
 *
 * Layout:
 *  - Cast: horizontal scroll row, circular avatars, name + character
 *  - Crew: small grid, name + job badge
 */
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import './CastCrew.css'

const FALLBACK_COLORS = [
  '#7c3aed', '#db2777', '#0891b2', '#059669',
  '#d97706', '#dc2626', '#2563eb', '#16a34a',
]

function initials(name = '') {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function avatarColor(id) {
  return FALLBACK_COLORS[id % FALLBACK_COLORS.length]
}

function Avatar({ person, size = 72, isCrew = false }) {
  const [imgErr, setImgErr] = useState(false)

  if (person.profile_path && !imgErr) {
    return (
      <img
        src={person.profile_path}
        alt={person.name}
        className="cast-avatar__img"
        style={{ width: size, height: size }}
        onError={() => setImgErr(true)}
      />
    )
  }
  return (
    <div
      className="cast-avatar__fallback"
      style={{
        width: size,
        height: size,
        background: avatarColor(person.id || 0),
        fontSize: size * (isCrew ? 0.5 : 0.33),
      }}
      aria-label={person.name}
    >
      {isCrew ? '👤' : initials(person.name)}
    </div>
  )
}

export default function CastCrew({ movieId, isTV = false }) {
  const [credits, setCredits] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const endpoint = isTV
      ? `/api/v1/tv/${movieId}/credits`
      : `/api/v1/movies/${movieId}/credits`
    api.get(endpoint)
      .then((r) => { if (!cancelled) setCredits(r.data) })
      .catch(() => { if (!cancelled) setCredits({ cast: [], crew: [] }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [movieId, isTV])

  if (loading) {
    return (
      <div className="castcrew">
        <div className="castcrew__skeleton-row">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="castcrew__skeleton-card skeleton" />
          ))}
        </div>
      </div>
    )
  }

  if (!credits || (credits.cast.length === 0 && credits.crew.length === 0)) {
    return null
  }

  return (
    <section className="castcrew">
      {/* ── Cast ── */}
      {credits.cast.length > 0 && (
        <>
          <h3 className="castcrew__heading">Cast</h3>
          <div className="castcrew__cast-row">
            {credits.cast.map((p) => (
              <Link key={p.id} to={`/person/${p.id}`} className="cast-card">
                <div className="cast-avatar">
                  <Avatar person={p} size={72} />
                </div>
                <p className="cast-card__name">{p.name}</p>
                {p.character && (
                  <p className="cast-card__character">{p.character}</p>
                )}
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── Crew ── */}
      {credits.crew.length > 0 && (
        <>
          <h3 className="castcrew__heading castcrew__heading--crew">Crew</h3>
          <div className="castcrew__crew-grid">
            {credits.crew.map((p) => (
              <Link key={p.id} to={`/person/${p.id}`} className="crew-card">
                <div className="crew-avatar">
                  <Avatar person={p} size={48} isCrew={true} />
                </div>
                <div className="crew-card__info">
                  <p className="crew-card__name">{p.name}</p>
                  <span className="crew-card__job">{p.job}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
