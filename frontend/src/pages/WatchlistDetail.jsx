/**
 * WatchlistDetail.jsx — Phase 4 + 5 Redesigned
 *
 * Route: /watchlists/:collectionId (protected)
 *
 * Features:
 *  - Split cinematic banner with blurred ambient background & parallax
 *  - 3D PosterStack depth layout with fanning hover effects
 *  - Inside-banner Collection details overlay with creator avatar
 *  - Floating Action bar (Add, Edit, Like, Save) with micro-interactions
 *  - Smooth skeleton-to-card crossfade loading state
 *  - Staggered scroll-progressive card entry animation (IntersectionObserver)
 *  - Keep all existing edit, add, remove, and watchlist API logic intact
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import AddContentModal from '../components/AddContentModal'
import { useAuth } from '../context/AuthContext'
import { watchlistService } from '../services/watchlistService'
import './WatchlistDetail.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

// ── PosterStack (displays 3D fanning effect for up to 3 posters) ─────────────
function PosterStack({ posters, itemCount }) {
  const safePosters = (posters || []).filter(Boolean)
  const count = safePosters.length

  if (!itemCount || count === 0) {
    return (
      <div className="wld-poster-stack empty">
        <span className="wld-poster-stack__icon">🍿</span>
      </div>
    )
  }

  return (
    <div className="wld-poster-stack">
      {/* Front poster (primary) */}
      <img
        src={`${TMDB_IMAGE_BASE}${safePosters[0]}`}
        alt="Collection poster primary"
        className="wld-poster wld-poster--front"
        loading="lazy"
      />
      {/* Stacked poster 1 behind */}
      {safePosters[1] && (
        <img
          src={`${TMDB_IMAGE_BASE}${safePosters[1]}`}
          alt="Collection poster back 1"
          className="wld-poster wld-poster--back-1"
          loading="lazy"
        />
      )}
      {safePosters[2] && (
        <img
          src={`${TMDB_IMAGE_BASE}${safePosters[2]}`}
          alt="Collection poster back 2"
          className="wld-poster wld-poster--back-2"
          loading="lazy"
        />
      )}
    </div>
  )
}

// ── MovieCardWithRemove — wraps MovieCard, shows × on hover with scale transition ──
function MovieCardWithRemove({ movie, onRemove, removing, index }) {
  return (
    <div
      className={`wld-movie-wrap ${removing ? 'wld-movie-wrap--removing' : ''}`}
      style={{ '--card-index': index }}
    >
      <MovieCard movie={movie} />
      <button
        className="wld-remove-btn"
        onClick={(e) => { e.stopPropagation(); onRemove(movie) }}
        aria-label={`Remove ${movie.title} from collection`}
        title="Remove from collection"
      >
        ×
      </button>
    </div>
  )
}

// ── Inline Edit Form ─────────────────────────────────────────────────────────
function InlineEdit({ initialName, initialDescription, onSave, onCancel }) {
  const [name, setName] = useState(initialName)
  const [desc, setDesc] = useState(initialDescription || '')
  const nameRef = useRef(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleSave() }
    if (e.key === 'Escape') onCancel()
  }

  const handleSave = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onSave(trimmed, desc.trim())
  }

  return (
    <form className="wld-inline-edit" onSubmit={(e) => { e.preventDefault(); handleSave() }}>
      <input
        ref={nameRef}
        className="wld-inline-edit__name"
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 50))}
        onKeyDown={handleKeyDown}
        maxLength={50}
        placeholder="Collection name"
        aria-label="Collection name"
        id="wld-edit-name"
      />
      <span className="wld-inline-edit__char">{name.length}/50</span>
      <textarea
        className="wld-inline-edit__desc"
        value={desc}
        onChange={(e) => setDesc(e.target.value.slice(0, 150))}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
        maxLength={150}
        placeholder="Description (optional)"
        aria-label="Collection description"
        rows={2}
        id="wld-edit-desc"
      />
      <span className="wld-inline-edit__char">{desc.length}/150</span>
      <div className="wld-inline-edit__actions">
        <button type="submit" className="btn btn--accent wld-inline-edit__save" id="wld-save-btn">
          Save
        </button>
        <button type="button" className="btn btn--ghost wld-inline-edit__cancel" onClick={onCancel} id="wld-cancel-btn">
          Cancel
        </button>
      </div>
    </form>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function WatchlistDetail() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [collection, setCollection] = useState(null)
  const [items, setItems]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState(null)

  const [editing, setEditing]       = useState(false)
  const [saving, setSaving]         = useState(false)

  const [removingIds, setRemovingIds] = useState(new Set())

  // Phase 5 — AddContentModal
  const [showAddModal, setShowAddModal] = useState(false)

  // Visual enhancements: Local state for decorative Like and Save buttons
  const [liked, setLiked] = useState(() => {
    try {
      return localStorage.getItem(`wl_liked_${collectionId}`) === 'true'
    } catch {
      return false
    }
  })
  const [saved, setSaved] = useState(() => {
    try {
      return localStorage.getItem(`wl_saved_${collectionId}`) === 'true'
    } catch {
      return false
    }
  })

  // Visual enhancements: Skeleton crossfade helper
  const [showSkeleton, setShowSkeleton] = useState(true)

  // Sidebar Filters State
  const [sortOption, setSortOption] = useState('default')
  const [typeFilter, setTypeFilter] = useState('')
  const [minRating, setMinRating] = useState(0)

  const clearFilters = () => {
    setSortOption('default')
    setTypeFilter('')
    setMinRating(0)
  }

  const filteredItems = useMemo(() => {
    let result = [...items]
    
    if (typeFilter) {
      result = result.filter(item => item.media_type === typeFilter || (typeFilter === 'movie' && !item.media_type))
    }
    if (minRating > 0) {
      result = result.filter(item => (item.vote_average || 0) >= minRating)
    }

    if (sortOption === 'rating') {
      result.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
    } else if (sortOption === 'popularity') {
      result.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    } else if (sortOption === 'release_date') {
      result.sort((a, b) => new Date(b.release_date || b.first_air_date || 0) - new Date(a.release_date || a.first_air_date || 0))
    } else if (sortOption === 'title') {
      result.sort((a, b) => (a.title || a.name || '').localeCompare(b.title || b.name || ''))
    }

    return result
  }, [items, typeFilter, minRating, sortOption])

  const backdropRef = useRef(null)

  const fetchCollection = useCallback(() => {
    setLoading(true)
    setError(null)
    watchlistService.getCollection(collectionId)
      .then((data) => {
        setCollection(data)
        const rawItems = data.items || []
        const movies = rawItems.map((item) => ({
          ...(item.movie || item),
          _item_id: item.id,
        }))
        setItems(movies)
      })
      .catch((err) => {
        if (err?.response?.status === 404) setError('Collection not found.')
        else setError('Failed to load collection.')
      })
      .finally(() => setLoading(false))
  }, [collectionId])

  useEffect(() => {
    fetchCollection()
  }, [fetchCollection])

  // Scroll parallax effect on the backdrop image
  useEffect(() => {
    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (backdropRef.current) {
            backdropRef.current.style.transform = `translateY(${window.scrollY * 0.35}px) scale(1.05)`
          }
          ticking = false
        })
        ticking = true
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Crossfade loading controller
  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => setShowSkeleton(false), 400)
      return () => clearTimeout(timer)
    } else {
      setShowSkeleton(true)
    }
  }, [loading])

  // IntersectionObserver for scroll-progressive entry card fade-in
  useEffect(() => {
    if (filteredItems.length === 0 || loading) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('wld-movie-wrap--visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.05, rootMargin: '0px 0px -50px 0px' }
    )

    const elements = document.querySelectorAll('.wld-movie-wrap')
    elements.forEach((el) => observer.observe(el))

    return () => {
      elements.forEach((el) => observer.unobserve(el))
    }
  }, [filteredItems, loading])

  // Save liked/saved states locally
  const handleLikeToggle = () => {
    setLiked((prev) => {
      const next = !prev
      try { localStorage.setItem(`wl_liked_${collectionId}`, String(next)) } catch {}
      return next
    })
  }

  const handleSaveToggle = () => {
    setSaved((prev) => {
      const next = !prev
      try { localStorage.setItem(`wl_saved_${collectionId}`, String(next)) } catch {}
      return next
    })
  }

  // ── Inline edit save ────────────────────────────────────────────────────────
  const handleSaveEdit = (newName, newDesc) => {
    setSaving(true)
    watchlistService.updateCollection(collectionId, newName, newDesc)
      .then((updated) => {
        setCollection((prev) => ({ ...prev, name: updated.name ?? newName, description: updated.description ?? newDesc }))
        setEditing(false)
      })
      .catch(() => {
        // fail silently — keep edit open
      })
      .finally(() => setSaving(false))
  }

  // ── Remove item ─────────────────────────────────────────────────────────────
  const handleRemove = useCallback((movie) => {
    const movieId = movie.id ?? movie._item_id
    const mediaType = movie.media_type || 'movie'
    const removeKey = `${movieId}-${mediaType}`

    // Optimistic remove
    setRemovingIds((prev) => new Set([...prev, removeKey]))
    setItems((prev) => prev.filter((m) => m.id !== movieId))
    setCollection((prev) => prev ? { ...prev, item_count: Math.max(0, (prev.item_count || 1) - 1) } : prev)

    watchlistService.removeFromCollection(collectionId, movieId, mediaType)
      .catch(() => {
        // Revert — refetch
        fetchCollection()
      })
      .finally(() => {
        setRemovingIds((prev) => {
          const next = new Set(prev)
          next.delete(removeKey)
          return next
        })
      })
  }, [collectionId, fetchCollection])

  // ── Render ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className="wld-page page-content">
        <div className="container wld-error">
          <p>{error}</p>
          <button className="btn btn--accent" onClick={() => navigate('/dashboard')} id="wld-back-btn">
            ← Back to Dashboard
          </button>
        </div>
      </main>
    )
  }

  const coverPosters   = collection?.cover_posters || items.slice(0, 3).map((m) => m.poster_path).filter(Boolean)
  const itemCount      = collection?.item_count ?? items.length
  const backdropPoster = coverPosters && coverPosters.length > 0 ? coverPosters[0] : null

  return (
    <main className="wld-page page-content" id="watchlist-detail-page">
      <div className="wld-layout">
        
        {/* ── Sidebar (Filters) ─────────────────────────────────────────── */}
        <aside className="wld-sidebar">
          <h2 className="wld-sidebar-title">Explore Filters</h2>
          
          <div className="wld-filter-group">
            <label>Sort By</label>
            <select className="wld-filter-select" value={sortOption} onChange={(e) => setSortOption(e.target.value)}>
              <option value="default">Default (Added Date)</option>
              <option value="popularity">Most Popular</option>
              <option value="rating">Top Rated</option>
              <option value="release_date">Newest First</option>
              <option value="title">A - Z</option>
            </select>
          </div>

          <div className="wld-filter-group">
            <label>Type</label>
            <select className="wld-filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              <option value="movie">Movies</option>
              <option value="tv">TV Shows</option>
            </select>
          </div>

          <div className="wld-filter-group">
            <label>Min Rating</label>
            <select className="wld-filter-select" value={minRating} onChange={(e) => setMinRating(Number(e.target.value))}>
              <option value="0">Any Rating</option>
              <option value="5">★ 5.0+</option>
              <option value="6">★ 6.0+</option>
              <option value="7">★ 7.0+</option>
              <option value="8">★ 8.0+</option>
              <option value="9">★ 9.0+</option>
            </select>
          </div>

          {(sortOption !== 'default' || typeFilter !== '' || minRating > 0) && (
            <button className="btn btn--ghost" style={{width: '100%', marginTop: '10px'}} onClick={clearFilters}>
              Reset Filters
            </button>
          )}
        </aside>

        {/* ── Main Content Area ─────────────────────────────────────────── */}
        <div className="wld-main">
          
          {/* ── Split Cinematic Banner ────────────────────────────────────────── */}
          <div className="wld-banner" aria-label="Collection cover">
        
        {/* Ambient blurred backdrop background */}
        <div className="wld-banner__backdrop-wrap">
          {loading ? (
            <div className="wld-banner__skeleton" />
          ) : backdropPoster ? (
            <img
              ref={backdropRef}
              src={`${TMDB_IMAGE_BASE}${backdropPoster}`}
              alt=""
              className="wld-banner__backdrop"
            />
          ) : (
            <div className="wld-banner__backdrop empty-backdrop" />
          )}
          <div className="wld-banner__overlay" />
        </div>

        <div className="container wld-banner__container">
          {/* Floating Actions Overlay */}
          <div className="wld-banner__nav">
            <button
              className="wld-back-btn"
              onClick={() => navigate(-1)}
              aria-label="Go back"
              id="wld-nav-back-btn"
            >
              ← Back
            </button>

            <div className="wld-banner__actions">
              {!loading && (
                <>
                  <button
                    className={`wld-action-circ-btn ${liked ? 'active' : ''}`}
                    onClick={handleLikeToggle}
                    aria-label="Like collection"
                    title="Like collection"
                  >
                    {liked ? '❤️' : '🤍'}
                  </button>
                  <button
                    className={`wld-action-circ-btn ${saved ? 'active' : ''}`}
                    onClick={handleSaveToggle}
                    aria-label="Save collection"
                    title="Save collection"
                  >
                    🔖
                  </button>
                  <button
                    className="wld-edit-btn"
                    onClick={() => setEditing(true)}
                    aria-label="Edit collection"
                    title="Edit collection"
                    disabled={saving}
                    id="wld-edit-btn"
                  >
                    ✏️
                  </button>
                </>
              )}
              <button
                className="btn btn--accent wld-add-btn"
                id="wld-add-content-btn"
                disabled={loading}
                onClick={() => setShowAddModal(true)}
              >
                + Add Content
              </button>
            </div>
          </div>

          {/* Hero Content Grid */}
          <div className="wld-hero">
            <div className="wld-hero__left">
              {loading ? (
                <div className="wld-poster-stack__skeleton" />
              ) : (
                <PosterStack posters={coverPosters} itemCount={itemCount} />
              )}
            </div>

            <div className="wld-hero__right">
              {editing ? (
                <InlineEdit
                  initialName={collection?.name || ''}
                  initialDescription={collection?.description || ''}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="wld-hero__info-block">
                  <h1 className="wld-title">
                    {loading ? <span className="wld-skeleton wld-skeleton--title" /> : (collection?.name || 'My Collection')}
                  </h1>

                  {!loading && (
                    <>
                      <div className="wld-hero__meta">
                        <span className="wld-count">
                          {itemCount} {itemCount === 1 ? 'item' : 'items'}
                        </span>
                        {collection?.description && (
                          <>
                            <span className="wld-desc-dot">·</span>
                            <span className="wld-description" title={collection.description}>
                              {collection.description}
                            </span>
                          </>
                        )}
                      </div>

                      {user && (
                        <div className="wld-creator">
                          {user.avatar_url ? (
                            <img src={user.avatar_url} className="wld-creator__avatar" alt={user.username} />
                          ) : (
                            <div className="wld-creator__avatar-fallback">
                              {user.username ? user.username[0].toUpperCase() : 'U'}
                            </div>
                          )}
                          <span className="wld-creator__name">by {user.username || 'User'}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* ── Content Area ────────────────────────────────────────────────── */}
      <div className="wld-section wld-content">
        <h2 className="wld-section-title">Collection</h2>
        <div className="wld-grid-container">
          
          {/* Skeleton cards overlaying to crossfade */}
          {showSkeleton && (
            <div className={`movie-grid wld-skeleton-grid ${!loading ? 'wld-skeleton-grid--fade-out' : ''}`}>
              <MovieCardSkeleton count={8} />
            </div>
          )}

          {/* Real cards grid */}
          {(!loading || !showSkeleton) && filteredItems.length > 0 && (
            <div className="movie-grid wld-grid">
              {filteredItems.map((movie, idx) => {
                const movieKey = `${movie.id ?? movie._item_id}-${movie.media_type || 'movie'}`
                return (
                  <MovieCardWithRemove
                    key={movieKey}
                    movie={movie}
                    onRemove={handleRemove}
                    removing={removingIds.has(movieKey)}
                    index={idx}
                  />
                )
              })}
            </div>
          )}

          {/* Enhanced Empty State */}
          {!loading && filteredItems.length === 0 && (
            <div className="wld-empty">
              <div className="wld-empty__illustration">
                <span className="wld-empty__icon-glow">🍿</span>
                <span className="wld-empty__icon">🍿</span>
              </div>
              <h3 className="wld-empty__title">Your collection is empty.</h3>
              <p className="wld-empty__msg">Start building your taste.</p>
              <button
                className="btn btn--accent wld-empty__cta"
                id="wld-add-first-btn"
                onClick={() => setShowAddModal(true)}
              >
                + Add Content
              </button>
            </div>
          )}

        </div>
      </div>

      </div> {/* End wld-main */}
      </div> {/* End wld-layout */}

      {/* ── Phase 5: Add Content Modal ────────────────────────────────── */}
      <AddContentModal
        collectionId={collectionId}
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onItemAdded={fetchCollection}
        existingItems={items.map((m) => ({ id: m.id, media_type: m.media_type }))}
      />

    </main>
  )
}

