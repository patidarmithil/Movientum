/**
 * PersonPage.jsx — Improvement 1.4
 *
 * Route: /person/:id
 * Fetches GET /api/v1/pages/person/{id} → biography + filmography in one
 * request, served from one 24 h Redis bundle. No DB — TMDB passthrough.
 */
import { useParams, Link } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import { pageService } from '../services/pageService'
import Aurora from '../components/Aurora'
import { pageCache } from '../utils/pageCache'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import './PersonPage.css'

const FALLBACK_COLORS = [
  '#7c3aed', '#db2777', '#0891b2', '#059669',
  '#d97706', '#dc2626', '#2563eb', '#16a34a',
]

function initials(name = '') {
  return name.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

function FilmPoster({ src, alt }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <img
      src={src}
      alt={alt}
      className={`film-card__poster poster-progressive ${loaded ? 'poster-progressive--loaded' : ''}`}
      loading="lazy"
      onLoad={() => setLoaded(true)}
    />
  )
}

export default function PersonPage() {
  const { id } = useParams()
  const personId = Number(id)

  const cacheKey = `person-detail-${personId}`
  const cachedData = pageCache.get(cacheKey)

  const [person,  setPerson]  = useState(cachedData?.person || null)
  const [loading, setLoading] = useState(!cachedData?.person)
  const [error,   setError]   = useState(null)
  const [bioExpanded, setBioExpanded] = useState(false)
  const [credits, setCredits] = useState(cachedData?.credits || [])
  const [creditsLoading, setCreditsLoading] = useState(!cachedData?.credits)
  const [currentImgIdx, setCurrentImgIdx] = useState(0)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalIdx, setModalIdx] = useState(0)
  const [slideDir, setSlideDir] = useState('init')
  const [touchStart, setTouchStart] = useState(null)
  const wheelTimeout = useRef(null)

  useEffect(() => {
    if (person) {
      document.title = `${person.name} - Movientum`
    } else {
      document.title = 'Person Details - Movientum'
    }
  }, [person])

  // Biography + credits arrive together from one bundle request, served from a
  // single Redis key (GET /api/v1/pages/person/{id}).
  useEffect(() => {
    let cancelled = false
    if (!person) setLoading(true)
    if (credits.length === 0) setCreditsLoading(true)
    setError(null)

    pageService.getPerson(personId)
      .then((d) => {
        if (cancelled) return
        const detail = d?.detail || null
        const creditList = d?.credits || []
        if (detail) setPerson(detail)
        setCredits(creditList)
        pageCache.set(cacheKey, {
          ...(pageCache.get(cacheKey) || {}),
          person: detail,
          credits: creditList,
        })
      })
      .catch(() => { if (!cancelled && !person) setError('Person not found') })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
        setCreditsLoading(false)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personId])

  const images = person?.images?.length ? person.images : (person?.profile_path ? [person.profile_path] : [])
  
  useEffect(() => {
    if (!images.length || isModalOpen) return;
    const timer = setInterval(() => {
      setCurrentImgIdx((prev) => (prev + 1) % images.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [images.length, isModalOpen])

  const navigateModal = (direction) => {
    setSlideDir(direction)
    if (direction === 'next') {
      setModalIdx((prev) => (prev + 1) % images.length)
    } else {
      setModalIdx((prev) => (prev - 1 + images.length) % images.length)
    }
  }

  useEffect(() => {
    if (!isModalOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') navigateModal('next')
      if (e.key === 'ArrowLeft') navigateModal('prev')
      if (e.key === 'Escape') setIsModalOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen, images.length])

  const handleTouchStart = (e) => {
    setTouchStart(e.touches[0].clientX)
  }

  const handleTouchEnd = (e) => {
    if (touchStart === null) return
    const touchEnd = e.changedTouches[0].clientX
    const deltaX = touchEnd - touchStart
    if (deltaX > 50) navigateModal('prev')
    if (deltaX < -50) navigateModal('next')
    setTouchStart(null)
  }

  const handleWheel = (e) => {
    if (wheelTimeout.current) return
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    if (Math.abs(delta) < 20) return
    if (delta > 0) {
      navigateModal('next')
    } else {
      navigateModal('prev')
    }
    wheelTimeout.current = setTimeout(() => {
      wheelTimeout.current = null
    }, 120)
  }

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
        <Aurora
          colorStops={["#FFAF7B", "#FF5E62", "#8A2387"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="person-page-aurora-overlay" />
      </div>

      <div className="container">
        {/* ── Content Wrapper ── */}
        <div className="person-page__content-wrapper">
          {/* ── Left Column (Main Info + Bio) ── */}
          <div className="person-page__main-col">
            {/* ── Hero ── */}
            <div className="person-page__hero">
              {/* Avatar Carousel */}
              <div 
                className={`person-page__avatar-wrap ${images.length > 0 ? 'clickable' : ''}`}
                onClick={() => {
                  if (images.length > 0) {
                    setModalIdx(currentImgIdx);
                    setSlideDir('init');
                    setIsModalOpen(true);
                  }
                }}
              >
                {images.length > 0 ? (
                  <div className="person-page__avatar" style={{ position: 'relative', overflow: 'hidden' }}>
                    {images.map((imgUrl, idx) => (
                      <img
                        key={imgUrl}
                        src={imgUrl}
                        alt={person.name}
                        className="person-page__avatar-slide"
                        style={{
                          opacity: idx === currentImgIdx ? 1 : 0,
                          zIndex: idx === currentImgIdx ? 1 : 0
                        }}
                      />
                    ))}
                  </div>
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
              <div className="vertical-scroll-container">
                <div className="vertical-scroll-fade top-fade" />
                <div id={`person-known-for-${personId}`} className="person-page__film-grid-wrap">
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
                    <StaggerContainer key={`known-for-${personId}-${creditsLoading}`} className="person-page__film-grid" instant={true}>
                      {credits.map((w, index) => {
                        const isMovie = w.media_type === 'movie'
                        const isTV = w.media_type === 'tv'
                        const CardComponent = (isMovie || isTV) ? Link : 'div'
                        const cardProps = isMovie ? { to: `/movies/${w.id}` } : (isTV ? { to: `/tv/${w.id}` } : {})

                        return (
                          <StaggerItem key={`${w.media_type}-${w.id}`} index={index}>
                            <CardComponent
                              className={`film-card ${(!isMovie && !isTV) ? 'film-card--disabled' : ''}`}
                              {...cardProps}
                            >
                              <div className="film-card__poster-wrap">
                                <FilmPoster src={w.poster_path} alt={w.title} />
                                {w.media_type === 'tv' && (
                                  <span className="film-card__badge">TV</span>
                                )}
                              </div>
                              <p className="film-card__title">{w.title}</p>
                              {w.release_year && (
                                <p className="film-card__year">{w.release_year}</p>
                              )}
                            </CardComponent>
                          </StaggerItem>
                        )
                      })}
                    </StaggerContainer>
                  )}
                </div>
                <div className="vertical-scroll-fade bottom-fade" />
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Full screen modal */}
      {isModalOpen && images.length > 0 && (
        <div 
          className="person-page-image-modal" 
          onClick={() => setIsModalOpen(false)}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <button className="person-page-image-modal-close" onClick={() => setIsModalOpen(false)}>✕</button>

          <button 
            className="person-page-image-modal-nav prev" 
            onClick={(e) => { e.stopPropagation(); navigateModal('prev'); }}
          >
            ‹
          </button>

          <img 
            key={modalIdx}
            src={images[modalIdx]} 
            alt={person.name} 
            className={`person-page-image-modal-img slide-${slideDir}`}
            onClick={(e) => e.stopPropagation()}
          />

          <button 
            className="person-page-image-modal-nav next" 
            onClick={(e) => { e.stopPropagation(); navigateModal('next'); }}
          >
            ›
          </button>

          <div className="person-page-image-modal-counter">
            {modalIdx + 1}/{images.length}
          </div>
        </div>
      )}
    </main>
  )
}
