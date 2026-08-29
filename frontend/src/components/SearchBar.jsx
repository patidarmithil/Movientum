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
import { useNavigate, Link } from 'react-router-dom'
import { searchService } from '../services/searchService'
import './SearchBar.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'


export default function SearchBar({ onSelect, placeholder = "Search movies…" }) {
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
  const abortControllerRef = useRef(null)

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

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

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)
    try {
      const data = await searchService.autocomplete(val, 'content', controller.signal)
      const list = Array.isArray(data) ? data : (data.suggestions ?? data.results ?? [])
      setSuggestions(list.slice(0, 8))
      setIsOpen(list.length > 0)
      setActiveIdx(-1)
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError' || err.message === 'canceled') {
        return
      }
      setSuggestions([])
      setIsOpen(false)
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false)
      }
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
        } else if (query.trim() && !onSelect) {
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
    if (onSelect) {
      onSelect(item)
    } else {
      if (item.media_type === 'tv') {
        navigate(`/tv/${item.id}`)
      } else {
        navigate(`/movies/${item.id}`)
      }
    }
  }

  const goToSearch = (q) => {
    setIsOpen(false)
    if (!onSelect) navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (query.trim() && !onSelect) goToSearch(query.trim())
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
          placeholder={placeholder}
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
                onMouseEnter={() => setActiveIdx(i)}
                onMouseLeave={() => setActiveIdx(-1)}
                style={{ padding: 0 }}
              >
                <Link
                  to={item.media_type === 'tv' ? `/tv/${item.id}` : `/movies/${item.id}`}
                  className={`searchbar__item${i === activeIdx ? ' searchbar__item--active' : ''}`}
                  onClick={() => {
                    setIsOpen(false)
                    setQuery('')
                    setSuggestions([])
                  }}
                  style={{ textDecoration: 'none', color: 'inherit', display: 'flex', width: '100%', alignItems: 'center' }}
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
                </Link>
              </li>
            )
          })}

          {!onSelect && (
            <li className="searchbar__see-all-wrapper" role="option" aria-selected={false} style={{ padding: 0 }}>
              <Link
                to={`/search?q=${encodeURIComponent(query)}`}
                className="searchbar__see-all"
                onClick={() => {
                  setIsOpen(false)
                  setQuery('')
                  setSuggestions([])
                }}
                style={{ textDecoration: 'none', color: 'inherit', display: 'flex', width: '100%', alignItems: 'center' }}
              >
                <span className="searchbar__icon-search" aria-hidden="true">🔍</span>
                See all results for <strong>"{query}"</strong>
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
