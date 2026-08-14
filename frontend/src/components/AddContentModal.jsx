/**
 * AddContentModal.jsx — Phase 5
 *
 * Props: { collectionId, isOpen, onClose, onItemAdded, existingItems? }
 *
 * Features:
 *  - Autofocused search bar (debounced 300 ms)
 *  - Horizontal-scroll result cards — poster, title, + button
 *  - + turns ✓ (green) when already added; optimistic after click
 *  - Dual-write: also POST /api/v1/watch/watchlist (old flat table for signals)
 *  - onItemAdded() callback → parent refetches collection
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { searchService } from '../services/searchService'
import { watchlistService } from '../services/watchlistService'
import { watchService } from '../services/watchService'
import { fireBurst } from '../utils/burstEffect'
import './AddContentModal.css'

const TMDB_BASE = 'https://image.tmdb.org/t/p/w342'

// ── Single result card ────────────────────────────────────────────────────────
function ResultCard({ item, isAdded, isLoading, onAdd }) {
  const poster = item.poster_path ? `${TMDB_BASE}${item.poster_path}` : null
  const year   = item.release_year || (item.release_date ? item.release_date.slice(0, 4) : '')

  return (
    <div className="acm-card">
      <div className="acm-card__poster-wrap">
        {poster ? (
          <img
            src={poster}
            alt={item.title}
            className="acm-card__poster"
            loading="lazy"
          />
        ) : (
          <div className="acm-card__poster acm-card__poster--fallback">
            <span>{item.title?.[0] ?? '?'}</span>
          </div>
        )}

        {/* + / ✓ button */}
        <button
          className={`acm-card__add-btn ${isAdded ? 'is-added' : ''} ${isLoading ? 'is-loading' : ''}`}
          onClick={(e) => !isAdded && !isLoading && onAdd(item, e.currentTarget)}
          aria-label={isAdded ? `${item.title} already added` : `Add ${item.title}`}
          disabled={isAdded || isLoading}
          id={`acm-add-${item.id}`}
        >
          {isLoading ? (
            <span className="acm-spinner" />
          ) : isAdded ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          )}
        </button>
      </div>

      <div className="acm-card__info">
        <p className="acm-card__title">{item.title}</p>
        {year && <p className="acm-card__year">{year}</p>}
      </div>
    </div>
  )
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function AddContentModal({ collectionId, isOpen, onClose, onItemAdded, existingItems = [] }) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  const [addedIds, setAddedIds] = useState(new Set()) // Stores strings like "id-media_type"
  // Track per-card loading state
  const [loadingIds, setLoadingIds] = useState(new Set())

  const inputRef    = useRef(null)
  const debounceRef = useRef(null)
  const abortRef    = useRef(null)

  // Sync existingMovieIds into addedIds when modal opens
  useEffect(() => {
    if (isOpen) {
      setAddedIds(new Set(existingItems.map(item => `${item.id}-${item.media_type || 'movie'}`)))
      setQuery('')
      setResults([])
      setSearchError(null)
      // Lock body scroll
      document.body.style.overflow = 'hidden'
      // Autofocus
      setTimeout(() => inputRef.current?.focus(), 80)
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
  const handleQueryChange = useCallback((e) => {
    const val = e.target.value
    setQuery(val)

    clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()

    if (!val.trim() || val.trim().length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController()
      abortRef.current = controller

      setSearching(true)
      setSearchError(null)

      searchService
        .instantSearch(val.trim(), 'content', controller.signal)
        .then((data) => {
          // instantSearch returns array directly
          const arr = Array.isArray(data) ? data : (data?.results || [])
          setResults(arr.slice(0, 20))
        })
        .catch((err) => {
          if (err?.name !== 'CanceledError' && err?.name !== 'AbortError') {
            setSearchError('Search failed. Try again.')
          }
        })
        .finally(() => setSearching(false))
    }, 300)
  }, [])

  // Add item to collection
  const handleAdd = useCallback(async (item, btnEl) => {
    const isTv = item.media_type === 'tv' || item.type === 'tv'
    const absId = Math.abs(Number(item.id))
    const mediaType = isTv ? 'tv' : 'movie'
    const addedKey = `${absId}-${mediaType}`

    // Optimistic
    setAddedIds((prev) => new Set([...prev, addedKey]))
    setLoadingIds((prev) => new Set([...prev, addedKey]))
    fireBurst(btnEl)

    try {
      await watchlistService.addToCollection(collectionId, absId, mediaType)
      // Dual-write to old flat table (fire-and-forget)
      watchService.addToWatchlist(absId, mediaType).catch(() => {})
      // Notify parent to refetch
      onItemAdded?.()
    } catch {
      // Revert optimistic add
      setAddedIds((prev) => {
        const next = new Set(prev)
        next.delete(addedKey)
        return next
      })
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev)
        next.delete(addedKey)
        return next
      })
    }
  }, [collectionId, onItemAdded])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const showEmpty   = !searching && !searchError && query.trim().length >= 2 && results.length === 0
  const showPrompt  = !query.trim() || query.trim().length < 2

  return createPortal(
    <div className="acm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add Content">
      <div className="acm-panel" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="acm-header">
          <h2 className="acm-header__title">Add Content</h2>
          <button
            className="acm-close-btn"
            onClick={onClose}
            aria-label="Close"
            id="acm-close-btn"
          >
            ×
          </button>
        </div>

        {/* ── Search Bar ──────────────────────────────────────────────── */}
        <div className="acm-search-wrap">
          <svg className="acm-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            id="acm-search-input"
            className="acm-search-input"
            type="search"
            value={query}
            onChange={handleQueryChange}
            placeholder="Search movies & TV shows..."
            autoComplete="off"
            spellCheck={false}
            aria-label="Search content"
          />
          {searching && <span className="acm-search-spinner" />}
        </div>

        {/* ── Results ─────────────────────────────────────────────────── */}
        <div className="acm-results-wrap">
          {showPrompt && (
            <div className="acm-state-msg">
              <span className="acm-state-icon">🔍</span>
              <p>Type to search movies & TV shows</p>
            </div>
          )}

          {searchError && (
            <div className="acm-state-msg acm-state-msg--error">
              <p>{searchError}</p>
            </div>
          )}

          {showEmpty && (
            <div className="acm-state-msg">
              <span className="acm-state-icon">😶</span>
              <p>No results for "<strong>{query}</strong>"</p>
            </div>
          )}

          {results.length > 0 && (
            <>
              <p className="acm-results-label">SEARCH RESULTS</p>
              <div className="acm-results-scroll">
                {results.map((item) => {
                  const isTv = item.media_type === 'tv' || item.type === 'tv'
                  const absId = Math.abs(Number(item.id))
                  const addedKey = `${absId}-${isTv ? 'tv' : 'movie'}`
                  return (
                    <ResultCard
                      key={item.id}
                      item={item}
                      isAdded={addedIds.has(addedKey)}
                      isLoading={loadingIds.has(addedKey)}
                      onAdd={handleAdd}
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>

      </div>
    </div>,
    document.body
  )
}
