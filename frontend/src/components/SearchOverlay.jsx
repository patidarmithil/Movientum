import React, { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { searchService } from '../services/searchService'
import RequestContentModal from './RequestContentModal'
import StaggerContainer, { StaggerItem } from './StaggerContainer'
import './SearchOverlay.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const CACHE_TTL = 300000 // 5 minutes

export default function SearchOverlay({ isOpen, setIsOpen }) {
  const navigate = useNavigate()
  const location = useLocation()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [searchType, setSearchType] = useState('content')
  
  const queryCacheRef = useRef({})
  const CACHE_MAX = 50
  
  const inputRef = useRef(null)
  const overlayRef = useRef(null)
  const containerRef = useRef(null)
  const debounceTimer = useRef(null)
  const abortControllerRef = useRef(null)

  const closeSearch = useCallback(() => {
    setIsOpen(false)
    setQuery('')
    setResults([])
    setActiveIdx(-1)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
  }, [setIsOpen])

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
    }
  }, [])

  const getCache = (q, type) => {
    const key = `${type}_${q}`
    const item = queryCacheRef.current[key]
    if (!item) return null
    if (Date.now() - item.timestamp > CACHE_TTL) {
      delete queryCacheRef.current[key]
      return null
    }
    return item.data
  }

  const setCache = (q, type, data) => {
    const key = `${type}_${q}`
    queryCacheRef.current[key] = {
      timestamp: Date.now(),
      data
    }
    
    // Evict oldest if we exceed max cache
    const keys = Object.keys(queryCacheRef.current)
    if (keys.length > CACHE_MAX) {
      const oldestKey = keys.reduce((oldest, k) => {
        return queryCacheRef.current[k].timestamp < queryCacheRef.current[oldest].timestamp ? k : oldest
      })
      delete queryCacheRef.current[oldestKey]
    }
  }

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (
        containerRef.current && !containerRef.current.contains(e.target) &&
        overlayRef.current && !overlayRef.current.contains(e.target)
      ) {
        closeSearch()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [closeSearch])

  // Close on route change
  useEffect(() => {
    closeSearch()
  }, [location, closeSearch])

  // Auto-focus input when search is opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  const fetchResults = useCallback(async (val) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const data = searchService.instantSearch 
        ? await searchService.instantSearch(val, searchType, controller.signal)
        : await searchService.autocomplete(val, searchType, controller.signal)
        
      const list = Array.isArray(data) ? data : (data.results ?? [])
      setResults(list)
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError' || err.message === 'canceled') {
        return
      }
      console.error(err)
      setResults([])
    } finally {
      if (abortControllerRef.current === controller) {
        setIsLoading(false)
      }
    }
  }, [searchType])

  const handleChange = (e) => {
    const val = e.target.value
    setQuery(val)
    clearTimeout(debounceTimer.current)
    
    if (val.trim().length < 2) {
      setResults([])
      setIsLoading(false)
    } else {
      setIsLoading(true)
      debounceTimer.current = setTimeout(() => {
        fetchResults(val.trim())
      }, 250)
    }
  }

  // Refetch when search type changes
  useEffect(() => {
    if (query.trim().length >= 2) {
      setIsLoading(true)
      clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        fetchResults(query.trim())
      }, 250)
    }
  }, [searchType])

  const handleKeyDown = (e) => {
    if (!isOpen && e.key !== 'Enter') return
    const listToNavigate = results
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, listToNavigate.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, -1))
        break
      case 'Enter':
        e.preventDefault()
        if (activeIdx >= 0 && listToNavigate[activeIdx]) {
          goToMovie(listToNavigate[activeIdx])
        } else if (results.length > 0) {
          goToMovie(results[0])
        }
        break
      case 'Escape':
        e.preventDefault()
        closeSearch()
        inputRef.current?.blur()
        break
      case 'Tab':
        closeSearch()
        break
      default:
        break
    }
  }

  const goToMovie = (item) => {
    closeSearch()
    if (item.media_type === 'person') {
      navigate(`/person/${item.id}`)
    } else if (item.media_type === 'tv') {
      navigate(`/tv/${item.id}`, { state: { movie: item } })
    } else {
      navigate(`/movies/${item.id}`, { state: { movie: item } })
    }
  }

  return (
    <div className="searchbar-wrapper" ref={containerRef}>


      {isOpen && createPortal(
        <div
          className="search-overlay"
          ref={overlayRef}
          style={{
            background: 'rgba(18, 18, 24, 0.85)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)'
          }}
        >
          <div className="search-overlay-input-wrapper">
            <div className="search-input-container">
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
                type="text"
                value={query}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                placeholder={searchType === 'person' ? "Search cast and crew…" : "Search movies or TV shows…"}
                autoComplete="off"
              />
              {query && (
                <button
                  type="button"
                  className="searchbar__clear"
                  onClick={() => {
                    setQuery('')
                    setResults([])
                    inputRef.current?.focus()
                  }}
                >
                  &times;
                </button>
              )}
            </div>
            
            <div className="search-type-tabs" style={{ display: 'flex', gap: '24px', marginTop: '16px', paddingLeft: '8px' }}>
              <button 
                type="button"
                onClick={() => setSearchType('content')}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  borderBottom: searchType === 'content' ? '2px solid white' : '2px solid transparent', 
                  color: searchType === 'content' ? 'white' : 'rgba(255,255,255,0.5)', 
                  cursor: 'pointer', 
                  fontWeight: '500', 
                  paddingBottom: '8px', 
                  fontSize: '15px',
                  transition: 'all 0.2s',
                  padding: '0 4px 8px 4px'
                }}
              >
                Content
              </button>
              <button 
                type="button"
                onClick={() => setSearchType('person')}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  borderBottom: searchType === 'person' ? '2px solid white' : '2px solid transparent', 
                  color: searchType === 'person' ? 'white' : 'rgba(255,255,255,0.5)', 
                  cursor: 'pointer', 
                  fontWeight: '500', 
                  paddingBottom: '8px', 
                  fontSize: '15px',
                  transition: 'all 0.2s',
                  padding: '0 4px 8px 4px'
                }}
              >
                Cast & Crew
              </button>
            </div>
          </div>

          <div className="search-overlay-content">
            {query.trim().length < 2 ? null : isLoading && results.length === 0 ? (
              <div className="search-loading-skeletons">
                <div className="search-results-grid">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="search-result-card" style={{opacity: 0.5}}>
                      <div className="search-result-poster"></div>
                      <div className="search-result-info" style={{background: '#444', height: '16px', width: '100px', borderRadius: '4px'}}></div>
                    </div>
                  ))}
                </div>
              </div>
            ) : results.length > 0 ? (
              <div className="search-results-section">
                <h4>SEARCH RESULTS</h4>
                <StaggerContainer 
                  key={`search-overlay-${query.trim()}-${results.length}`} 
                  className={`search-results-grid ${isLoading ? 'search-grid--loading' : ''}`} 
                  instant={true}
                >
                  {results.map((item, i) => {
                    const posterUrl = item.poster_path ? `${TMDB_IMAGE_BASE}/w92${item.poster_path}` : null
                    return (
                      <StaggerItem key={item.id} index={i}>
                        <Link 
                          to={item.media_type === 'person' ? `/person/${item.id}` : item.media_type === 'tv' ? `/tv/${item.id}` : `/movies/${item.id}`}
                          state={{ movie: item }}
                          className={`search-result-card ${i === activeIdx ? 'search-result-card--active' : ''}`}
                          onClick={() => closeSearch()}
                          onMouseEnter={() => setActiveIdx(i)}
                          onMouseLeave={() => setActiveIdx(-1)}
                          style={{ textDecoration: 'none', color: 'inherit' }}
                        >
                          {posterUrl ? (
                            <img className="search-result-poster" src={posterUrl} alt="" loading="lazy" />
                          ) : (
                            <div className="search-result-poster" style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
                              {item.title?.[0] ?? '?'}
                            </div>
                          )}
                          <div>
                            <div className="search-result-title">{item.title || item.name}</div>
                            {(item.release_year || item.media_type) && (
                              <div className="search-result-meta">
                                {[item.release_year, item.media_type === 'tv' ? 'TV Show' : item.media_type === 'movie' ? 'Movie' : item.media_type === 'person' ? 'Person' : item.media_type].filter(Boolean).join(' • ')}
                              </div>
                            )}
                          </div>
                        </Link>
                      </StaggerItem>
                    )
                  })}
                </StaggerContainer>
              </div>
            ) : query.trim().length >= 2 && !isLoading && (
              <div className="search-empty">
                <p>Could not find what you're looking for?</p>
                {searchType !== 'person' && (
                  <button 
                    onClick={() => setShowRequestModal(true)}
                    style={{ marginTop: '10px', background: '#3a3a40', border: 'none', color: 'white', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Request Content
                  </button>
                )}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showRequestModal && (
        <RequestContentModal 
          query={query} 
          onClose={() => setShowRequestModal(false)} 
        />
      )}
    </div>
  )
}
