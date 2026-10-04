/**
 * AddContentModal.jsx — Phase 5
 *
 * Props: { collectionId, isOpen, onClose, onItemAdded, existingItems? }
 *
 * Features:
 *  - Autofocused search bar — shared useInstantSearch (250 ms debounce, cache)
 *  - SearchOverlay-style result rows — poster, title, year • type, + button
 *  - + turns ✓ (green) when already added; optimistic after click
 *  - Dual-write: also POST /api/v1/watch/watchlist (old flat table for signals)
 *  - onItemAdded() callback → parent refetches collection
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useInstantSearch } from '../hooks/useInstantSearch'
import SearchResultRow from './SearchResultRow'
import { watchlistService } from '../services/watchlistService'
import { watchService } from '../services/watchService'
import { fireBurst } from '../utils/burstEffect'
import './AddContentModal.css'

const PLUS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
)
const CHECK_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)

// ── Main modal ────────────────────────────────────────────────────────────────
export default function AddContentModal({ collectionId, isOpen, onClose, onItemAdded, existingItems = [] }) {
  const [query, setQuery]       = useState('')
  const { results, loading: searching, error: searchError, active } = useInstantSearch(query)

  const [addedIds, setAddedIds] = useState(new Set()) // Stores strings like "id-media_type"
  // Track per-card loading state
  const [loadingIds, setLoadingIds] = useState(new Set())

  const inputRef    = useRef(null)

  // Sync existingMovieIds into addedIds when modal opens
  useEffect(() => {
    if (isOpen) {
      setAddedIds(new Set(existingItems.map(item => `${item.id}-${item.media_type || 'movie'}`)))
      setQuery('')
      // Lock body scroll
      document.body.style.overflow = 'hidden'
      // Autofocus
      setTimeout(() => inputRef.current?.focus(), 80)
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const showEmpty   = active && !searching && !searchError && results.length === 0
  const showPrompt  = !active

  return createPortal(
    <div className="acm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add Content">
      <div className="acm-panel" onClick={(e) => e.stopPropagation()}>
        <div className="acm-grab" aria-hidden="true"><span /></div>

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
            onChange={(e) => setQuery(e.target.value)}
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
              <div className="acm-results-list srr-list">
                {results.map((item) => {
                  const isTv = item.media_type === 'tv' || item.type === 'tv'
                  const absId = Math.abs(Number(item.id))
                  const addedKey = `${absId}-${isTv ? 'tv' : 'movie'}`
                  const isAdded = addedIds.has(addedKey)
                  const isLoading = loadingIds.has(addedKey)
                  const title = item.title || item.name
                  return (
                    <SearchResultRow
                      key={addedKey}
                      item={item}
                      added={isAdded}
                      actions={
                        <button
                          type="button"
                          className={`srr__btn${isAdded ? ' is-added' : ''}`}
                          onClick={(e) => !isAdded && !isLoading && handleAdd(item, e.currentTarget)}
                          aria-label={isAdded ? `${title} already added` : `Add ${title}`}
                          disabled={isAdded || isLoading}
                          id={`acm-add-${item.id}`}
                        >
                          {isLoading ? <span className="srr-spinner" /> : isAdded ? CHECK_ICON : PLUS_ICON}
                        </button>
                      }
                    />
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Mobile-only footer: a clear way out once titles are added */}
        <div className="acm-footer">
          <button type="button" className="acm-done-btn" onClick={onClose}>Done</button>
        </div>

      </div>
    </div>,
    document.body
  )
}
