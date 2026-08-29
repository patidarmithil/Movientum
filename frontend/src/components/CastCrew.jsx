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
import StaggerContainer, { StaggerItem } from './StaggerContainer'
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

/**
 * `credits` may be supplied by the caller — the detail pages get it inside their
 * page bundle, so passing it down avoids a second request for data the page
 * already holds. Without the prop the component fetches for itself exactly as
 * before, which keeps every other caller working unchanged.
 */
export default function CastCrew({ movieId, isTV = false, credits: creditsProp = null }) {
  const [credits, setCredits] = useState(creditsProp)
  const [loading, setLoading] = useState(!creditsProp)

  useEffect(() => {
    if (creditsProp) {
      setCredits(creditsProp)
      setLoading(false)
      return
    }
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
  }, [movieId, isTV, creditsProp])

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
          <div className="scroll-row-container">
            <div className="scroll-row-fade left-fade" />
            <StaggerContainer key={`cast-${movieId}-${loading}`} id={`cast-scroll-${movieId}`} className="castcrew__cast-row">
              {credits.cast.map((p, index) => (
                <StaggerItem key={p.id} index={index}>
                  <Link to={`/person/${p.id}`} className="cast-card">
                    <div className="cast-avatar">
                      <Avatar person={p} size={72} />
                    </div>
                    <p className="cast-card__name">{p.name}</p>
                    {p.character && (
                      <p className="cast-card__character">{p.character}</p>
                    )}
                  </Link>
                </StaggerItem>
              ))}
            </StaggerContainer>
            <div className="scroll-row-fade right-fade" />
          </div>
        </>
      )}

      {/* ── Crew ── */}
      {credits.crew.length > 0 && (
        <>
          <h3 className="castcrew__heading castcrew__heading--crew">Crew</h3>
          <div className="scroll-row-container">
            <div className="scroll-row-fade left-fade" />
            <StaggerContainer key={`crew-${movieId}-${loading}`} id={`crew-scroll-${movieId}`} className="castcrew__cast-row">
              {credits.crew.map((p, index) => (
                <StaggerItem key={p.id} index={index}>
                  <Link to={`/person/${p.id}`} className="cast-card">
                    <div className="cast-avatar">
                      <Avatar person={p} size={72} />
                    </div>
                    <p className="cast-card__name">{p.name}</p>
                    {p.job && (
                      <p className="cast-card__character">{p.job}</p>
                    )}
                  </Link>
                </StaggerItem>
              ))}
            </StaggerContainer>
            <div className="scroll-row-fade right-fade" />
          </div>
        </>
      )}
    </section>
  )
}
