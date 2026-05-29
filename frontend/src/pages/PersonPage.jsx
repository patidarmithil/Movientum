/**
 * PersonPage.jsx — Improvement 1.4
 *
 * Route: /person/:id
 * Fetches GET /api/v1/person/{id} → biography + filmography.
 * No DB — TMDB passthrough, 24 h Redis cache.
 */
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from '../utils/api'
import Aurora from '../components/Aurora'
import './PersonPage.css'

const FALLBACK_COLORS = [
  '#7c3aed', '#db2777', '#0891b2', '#059669',
  '#d97706', '#dc2626', '#2563eb', '#16a34a',
]

function initials(name = '') {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

export default function PersonPage() {
  const { id } = useParams()
  const personId = Number(id)

  const [person,  setPerson]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [credits, setCredits] = useState([])
  const [creditsLoading, setCreditsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api.get(`/api/v1/person/${personId}`)
      .then((r) => { if (!cancelled) setPerson(r.data) })
      .catch(() => { if (!cancelled) setError('Person not found') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [personId])

  useEffect(() => {
    let cancelled = false
    setCreditsLoading(true)
    api.get(`/api/v1/person/${personId}/credits`)
      .then((r) => { if (!cancelled) setCredits(r.data) })
      .catch((err) => console.error('Error fetching credits:', err))
      .finally(() => { if (!cancelled) setCreditsLoading(false) })
    return () => { cancelled = true }
  }, [personId])

  if (loading) {
    return (
      <main className="person-page page-content">
        <div className="container">
          <div className="person-page__hero">
            <div className="skeleton person-page__avatar-skeleton" />
            <div className="person-page__hero-info">
              <div className="skeleton" style={{ height: 36, width: '40%', borderRadius: 8, marginBottom: 12 }} />
              <div className="skeleton" style={{ height: 18, width: '30%', borderRadius: 6, marginBottom: 8 }} />
              <div className="skeleton" style={{ height: 18, width: '25%', borderRadius: 6 }} />
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (error || !person) {
    return (
      <main className="person-page page-content">
        <div className="container">
          <div className="error-state">
            <h2>Person not found</h2>
            <Link to="/" className="btn btn--ghost btn--md" style={{ marginTop: 16, display: 'inline-block' }}>
              ← Home
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const avatarColor = FALLBACK_COLORS[personId % FALLBACK_COLORS.length]
  const bioShort = person.biography?.length > 600
  const bioText  = (!bioExpanded && bioShort)
    ? person.biography.slice(0, 600) + '…'
    : person.biography

  return (
    <main className="person-page page-content">
      {/* ── Background Aurora Animation ── */}
      <div className="person-page-aurora-bg">
        <Aurora colorStops={["#3A1C71", "#D76D77", "#FFAF7B"]} speed={0.5} />
        <div className="person-page-aurora-overlay" />
      </div>

      <div className="container">
        {/* ── Content Wrapper ── */}
        <div className="person-page__content-wrapper">
          {/* ── Left Column (Main Info + Bio) ── */}
          <div className="person-page__main-col">
            {/* ── Hero ── */}
            <div className="person-page__hero">
              {/* Avatar */}
              <div className="person-page__avatar-wrap">
                {person.profile_path ? (
                  <img
                    src={person.profile_path}
                    alt={person.name}
                    className="person-page__avatar"
                  />
                ) : (
                  <div
                    className="person-page__avatar person-page__avatar--fallback"
                    style={{ background: avatarColor }}
                  >
                    {initials(person.name)}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="person-page__hero-info">
                <h1 className="person-page__name">{person.name}</h1>
                {person.known_for_department && (
                  <span className="person-page__dept">{person.known_for_department}</span>
                )}
                <dl className="person-page__meta">
                  {person.birthday && (
                    <>
                      <dt>Born</dt>
                      <dd>
                        {new Date(person.birthday).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                        {person.age && !person.deathday && ` (age ${person.age})`}
                      </dd>
                    </>
                  )}
                  {person.deathday && (
                    <>
                      <dt>Died</dt>
                      <dd>
                        {new Date(person.deathday).toLocaleDateString('en-US', {
                          year: 'numeric', month: 'long', day: 'numeric',
                        })}
                        {person.age && ` (age ${person.age})`}
                      </dd>
                    </>
                  )}
                  {person.place_of_birth && (
                    <>
                      <dt>Birthplace</dt>
                      <dd>{person.place_of_birth}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>


          {/* ── Biography ── */}
          {person.biography && (
            <section className="person-page__bio">
              <h2 className="person-page__section-title">Biography</h2>
              <p className="person-page__bio-text">{bioText}</p>
              {bioShort && (
                <button
                  className="person-page__bio-toggle"
                  onClick={() => setBioExpanded((e) => !e)}
                >
                  {bioExpanded ? 'Show less ↑' : 'Read more ↓'}
                </button>
              )}
            </section>
          )}
          </div>

          {/* ── Top Credits / Filmography ── */}
          {!creditsLoading && credits.length === 0 ? null : (
            <section className="person-page__filmography">
              <h2 className="person-page__section-title">Known For</h2>
              <div className="person-page__film-grid-wrap">
                {creditsLoading ? (
                  <div className="person-page__film-grid">
                    {Array.from({ length: 6 }).map((_, idx) => (
                      <div key={idx} className="film-card skeleton-film-card">
                        <div className="skeleton film-card__poster" style={{ aspectRatio: '2/3' }} />
                        <div className="skeleton" style={{ height: 12, marginTop: 6, width: '80%', borderRadius: 4 }} />
                        <div className="skeleton" style={{ height: 10, marginTop: 4, width: '40%', borderRadius: 4 }} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="person-page__film-grid">
                    {credits.map((w) => {
                      const isMovie = w.media_type === 'movie'
                      const isTV = w.media_type === 'tv'
                      const CardComponent = (isMovie || isTV) ? Link : 'div'
                      const cardProps = isMovie ? { to: `/movies/${w.id}` } : (isTV ? { to: `/tv/${w.id}` } : {})

                      return (
                        <CardComponent
                          key={`${w.media_type}-${w.id}`}
                          className={`film-card ${(!isMovie && !isTV) ? 'film-card--disabled' : ''}`}
                          {...cardProps}
                        >
                          <div className="film-card__poster-wrap">
                            <img
                              src={w.poster_path}
                              alt={w.title}
                              className="film-card__poster"
                              loading="lazy"
                            />
                            {w.media_type === 'tv' && (
                              <span className="film-card__badge">TV</span>
                            )}
                          </div>
                          <p className="film-card__title">{w.title}</p>
                          {w.release_year && (
                            <p className="film-card__year">{w.release_year}</p>
                          )}
                        </CardComponent>
                      )
                    })}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </main>
  )
}
