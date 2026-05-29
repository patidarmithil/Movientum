/**
 * SearchBar.jsx — Debounced autocomplete search bar (Phase 3.5B)
 *
 * - Debounce 300ms, >=2 chars → fires autocomplete
 * - Dropdown: up to 8 results (poster + title + year)
 * - Click result → /movies/{id}
 * - Enter → /search?q=...
 * - Esc → close dropdown
 * - Keyboard arrows navigate list
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchService } from '../services/searchService'
import './SearchBar.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'


export default function SearchBar() {
  const navigate = useNavigate()

  const [query, setQuery]           = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [isOpen, setIsOpen]         = useState(false)
  const [isLoading, setIsLoading]   = useState(false)
  const [activeIdx, setActiveIdx]   = useState(-1)

  const inputRef   = useRef(null)
  const listRef    = useRef(null)
  const timerRef   = useRef(null)
  const containerRef = useRef(null)

  // ── Close on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false)
        setActiveIdx(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Debounced autocomplete ─────────────────────────────────────
  const fetchSuggestions = useCallback(async (val) => {
    if (val.length < 2) {
      setSuggestions([])
      setIsOpen(false)
      return
    }
    setIsLoading(true)
    try {
      const data = await searchService.autocomplete(val)
      const list = Array.isArray(data) ? data : (data.results ?? [])
      setSuggestions(list.slice(0, 8))
      setIsOpen(list.length > 0)
      setActiveIdx(-1)
    } catch {
      setSuggestions([])
      setIsOpen(false)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(timerRef.current)
    if (val.trim().length >= 2) {
      timerRef.current = setTimeout(() => fetchSuggestions(val.trim()), 300)
    } else {
      setSuggestions([])
      setIsOpen(false)
    }
  }

  // ── Keyboard navigation ────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (!isOpen && e.key !== 'Enter') return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIdx >= 0 && suggestions[activeIdx]) {
          goToMovie(suggestions[activeIdx])
        } else if (query.trim()) {
          goToSearch(query.trim())
        }
        break
      case 'Escape':
        setIsOpen(false)
        setActiveIdx(-1)
        inputRef.current?.blur()
        break
      default:
        break
    }
  }

  const goToMovie = (item) => {
    setIsOpen(false)
    setQuery('')
    setSuggestions([])
    if (item.media_type === 'tv') {
      navigate(`/tv/${item.id}`)
    } else {
      navigate(`/movies/${item.id}`)
    }
  }

  const goToSearch = (q) => {
    setIsOpen(false)
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim()) goToSearch(query.trim())
  }

  return (
    <div className="searchbar" ref={containerRef} role="combobox" aria-expanded={isOpen} aria-haspopup="listbox">
      <form className="searchbar__form" onSubmit={handleSubmit} aria-label="Movie search">
        <span className="searchbar__icon" aria-hidden="true">
          {isLoading ? (
            <span className="searchbar__spinner" />
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          )}
        </span>

        <input
          ref={inputRef}
          id="searchbar-input"
          type="text"
          className="searchbar__input"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setIsOpen(true)}
          placeholder="Search movies…"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls="searchbar-dropdown"
          aria-activedescendant={activeIdx >= 0 ? `search-item-${activeIdx}` : undefined}
        />

        {query && (
          <button
            type="button"
            className="searchbar__clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setSuggestions([])
              setIsOpen(false)
              inputRef.current?.focus()
            }}
          >
            ×
          </button>
        )}
      </form>

      {isOpen && suggestions.length > 0 && (
        <ul
          className="searchbar__dropdown"
          id="searchbar-dropdown"
          role="listbox"
          ref={listRef}
          aria-label="Search suggestions"
        >
          {suggestions.map((item, i) => {
            const posterUrl = item.poster_path
              ? `${TMDB_IMAGE_BASE}/w92${item.poster_path}`
              : null

            return (
              <li
                key={item.id}
                id={`search-item-${i}`}
                role="option"
                aria-selected={i === activeIdx}
                className={`searchbar__item${i === activeIdx ? ' searchbar__item--active' : ''}`}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(-1)}
                onClick={() => goToMovie(item)}
              >
                <div className="searchbar__item-poster">
                  {posterUrl ? (
                    <img src={posterUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="searchbar__item-poster-fallback">
                      {item.title?.[0] ?? '?'}
                    </div>
                  )}
                </div>
                <div className="searchbar__item-info">
                  <span className="searchbar__item-title">{item.title}</span>
                  {item.release_year && (
                    <span className="searchbar__item-year">{item.release_year}</span>
                  )}
                </div>
                <span className="searchbar__item-arrow" aria-hidden="true">›</span>
              </li>
            )
          })}

          <li className="searchbar__see-all" role="option" aria-selected={false} onClick={() => goToSearch(query)}>
            <span className="searchbar__icon-search" aria-hidden="true">🔍</span>
            See all results for <strong>"{query}"</strong>
          </li>
        </ul>
      )}
    </div>
  )
}
