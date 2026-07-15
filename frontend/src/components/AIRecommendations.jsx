/**
 * AIRecommendations.jsx — Phase 6
 *
 * Full state machine: IDLE → LOADING → LOADED → ERROR | RERUNNING
 *
 * Props:
 *   seedTmdbId   {number}  TMDB id of the detail page item
 *   seedMediaType {string} 'movie' | 'tv'
 *   seedTitle     {string} title for display only
 */
import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { aiRecsService } from '../services/aiRecsService'
import ShinyText from './ShinyText'
import BorderGlow from './BorderGlow'
import { BsStars } from 'react-icons/bs'
import { FiThumbsUp, FiThumbsDown, FiRefreshCw, FiAlertTriangle, FiFilm } from 'react-icons/fi'
import './AIRecommendations.css'
import './MovieCard.css'
import './MovieRow.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

// Static TMDB genre list for dropdown
const TMDB_GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime',
  'Documentary', 'Drama', 'Family', 'Fantasy', 'History',
  'Horror', 'Music', 'Mystery', 'Romance', 'Science Fiction',
  'Sci-Fi', 'Thriller', 'War', 'Western',
  // Special
  'Hidden Gem', 'Classic (pre-2000)',
]

const STATE = { IDLE: 'IDLE', LOADING: 'LOADING', LOADED: 'LOADED', ERROR: 'ERROR', RERUNNING: 'RERUNNING' }

// ── AI Card ──────────────────────────────────────────────────────
function AIRecCard({ item, isLoggedIn, memoryMap, onThumb }) {
  const [hasError, setHasError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const cardRef = useRef(null)
  
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px 100px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const signal = memoryMap[`${item.tmdb_id}:${item.media_type}`]

  const posterUrl = item.poster_path
    ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}`
    : null

  const detailHref = item.media_type === 'tv'
    ? `/tv/${item.tmdb_id}`
    : `/movies/${item.tmdb_id}`

  const ratingColor = item.vote_average >= 8 ? '#22C55E' : item.vote_average >= 6 ? '#FFC300' : '#EF4444'

  return (
    <div ref={cardRef} className="ai-rec-card">
      <Link
        to={detailHref}
        style={{ textDecoration: 'none', display: 'contents', color: 'inherit' }}
      >
        <BorderGlow
          className={`movie-card movie-card--standard ${isVisible ? 'visible' : ''}`}
          tabIndex={0}
          borderRadius={12}
          glowRadius={30}
          glowIntensity={0.85}
          colors={['#B048FF', '#00E5A0', '#FF4D6D']}
          backgroundColor="#1B1B1B"
        >
          <div className="movie-card__poster-wrap">
            {posterUrl && !hasError ? (
              <img
                src={posterUrl}
                alt={item.title}
                className={`movie-card__poster poster-progressive ${imageLoaded ? 'poster-progressive--loaded' : ''}`}
                loading="lazy"
                onLoad={() => setImageLoaded(true)}
                onError={() => setHasError(true)}
              />
            ) : (
              <div className="movie-card__poster-fallback">
                <span>{item.title}</span>
              </div>
            )}
            
            <span className="ai-rec-card__badge"><BsStars /></span>

            {item.vote_average > 0 && (
              <div className="movie-card__rating" style={{ color: ratingColor }}>
                {item.vote_average.toFixed(1)}
              </div>
            )}

            {item.media_type === 'tv' && (
              <div className="movie-card__tv-badge">TV</div>
            )}

            {isLoggedIn && (
              <div className="movie-card__feedback-overlay" onClick={e => e.preventDefault()}>
                <button
                  className={`movie-card__feedback-btn movie-card__feedback-btn--up ${signal === 'up' ? 'is-active' : ''}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onThumb(item, 'up') }}
                  title="Like"
                  aria-label="Thumbs up"
                >
                  <FiThumbsUp />
                </button>
                <button
                  className={`movie-card__feedback-btn movie-card__feedback-btn--down ${signal === 'down' ? 'is-active' : ''}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onThumb(item, 'down') }}
                  title="Dislike"
                  aria-label="Thumbs down"
                >
                  <FiThumbsDown />
                </button>
              </div>
            )}
          </div>

          <div className="movie-card__info">
            <h3 className="movie-card__title">{item.title}</h3>
            <p className="movie-card__meta">
              <span className="movie-card__year">{item.release_date ? item.release_date.slice(0, 4) : ''}</span>
            </p>
            {item.reason && (
              <p className="movie-card__meta" style={{ marginTop: '4px', fontStyle: 'italic', color: '#94a3b8', fontSize: '0.65rem', whiteSpace: 'normal', lineHeight: 1.2 }}>
                {item.reason}
              </p>
            )}
          </div>
        </BorderGlow>
      </Link>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────
export default function AIRecommendations({ seedTmdbId, seedMediaType, seedTitle }) {
  const { isLoggedIn } = useAuth()

  const [uiState,      setUiState]      = useState(STATE.IDLE)
  const [results,      setResults]      = useState([])
  const [metadata,     setMetadata]     = useState(null)   // { personalized, resolved, dropped }
  const [memoryMap,    setMemoryMap]    = useState({})     // { "tmdbId:mediaType": 'up'|'down' }
  const [focusGenre,   setFocusGenre]   = useState('')
  const [moreLike,     setMoreLike]     = useState([])     // [{ title, year, media_type }]
  const [previousIds,  setPreviousIds]  = useState([])
  const [rerunCount,   setRerunCount]   = useState(0)
  const [errorMessage, setErrorMessage] = useState('AI could not generate results. Please try again.')
  const scrollRef = useRef(null)

  // Build memory map from existing signals on items
  const buildMemoryMap = useCallback((items) => {
    const map = {}
    items.forEach(item => {
      if (item.ai_liked === true)  map[`${item.tmdb_id}:${item.media_type}`] = 'up'
      if (item.ai_liked === false) map[`${item.tmdb_id}:${item.media_type}`] = 'down'
    })
    return map
  }, [])

  // Load user memory on mount if logged in
  useEffect(() => {
    if (!isLoggedIn) return
    aiRecsService.getMemory()
      .then(data => {
        const map = {}
        data.liked?.forEach(i => { map[`${i.tmdb_id}:${i.media_type}`] = 'up' })
        data.disliked?.forEach(i => { map[`${i.tmdb_id}:${i.media_type}`] = 'down' })
        setMemoryMap(prev => ({ ...map, ...prev }))
      })
      .catch(() => {/* silent — memory not critical */})
  }, [isLoggedIn])

  const fetchRecs = useCallback(async ({
    previousIdsParam = [],
    rerunCountParam = 0,
    focusGenreParam = '',
    moreLikeParam = [],
    isRerun = false,
  } = {}) => {
    setUiState(isRerun ? STATE.RERUNNING : STATE.LOADING)

    try {
      // Map focus genre "Hidden Gem" / "Classic (pre-2000)" → string, others direct
      const resolvedGenre = focusGenreParam || null

      const data = await aiRecsService.getSimilar({
        seedTmdbId,
        seedMediaType,
        focusGenre:  resolvedGenre,
        moreLike:    moreLikeParam,
        previousIds: previousIdsParam,
        rerunCount:  rerunCountParam,
      })

      setResults(data.results || [])
      setMetadata({ personalized: data.personalized, resolved: data.resolved, dropped: data.dropped })
      setMemoryMap(prev => ({ ...buildMemoryMap(data.results || []), ...prev }))
      setUiState(STATE.LOADED)
    } catch (err) {
      console.error('[AIRecs] fetch failed:', err)
      if (err.response?.status === 429) {
        setErrorMessage(err.response?.data?.detail || 'Daily AI quota exceeded. Please try again tomorrow.')
      } else {
        setErrorMessage('AI could not generate results. Please try again.')
      }
      setUiState(STATE.ERROR)
    }
  }, [seedTmdbId, seedMediaType, buildMemoryMap])

  const handleGetRecs = useCallback(() => {
    fetchRecs({ rerunCountParam: 0, previousIdsParam: [], isRerun: false })
  }, [fetchRecs])

  const handleRerun = useCallback(() => {
    const newPrevIds = [...previousIds, ...results.map(r => r.tmdb_id)]
    const newRerunCount = rerunCount + 1
    setPreviousIds(newPrevIds)
    setRerunCount(newRerunCount)
    fetchRecs({
      previousIdsParam: newPrevIds,
      rerunCountParam:  newRerunCount,
      focusGenreParam:  focusGenre,
      moreLikeParam:    moreLike,
      isRerun: true,
    })
  }, [previousIds, results, rerunCount, focusGenre, moreLike, fetchRecs])

  const handleThumb = useCallback(async (item, signal) => {
    const key = `${item.tmdb_id}:${item.media_type}`
    // Toggle off if same signal
    const newSignal = memoryMap[key] === signal ? null : signal
    setMemoryMap(prev => ({ ...prev, [key]: newSignal }))
    if (!newSignal) return

    try {
      await aiRecsService.recordMemory({
        tmdbId:    item.tmdb_id,
        mediaType: item.media_type,
        signal:    newSignal,
        title:     item.title,
        genres:    [],
      })
    } catch (err) {
      // Revert on failure
      setMemoryMap(prev => ({ ...prev, [key]: memoryMap[key] ?? undefined }))
    }
  }, [memoryMap])

  // More-like chip toggle
  const toggleMoreLike = useCallback((item) => {
    const key = `${item.title}:${item.release_date?.slice(0,4)}`
    setMoreLike(prev => {
      const exists = prev.find(m => m.title === item.title)
      if (exists) return prev.filter(m => m.title !== item.title)
      return [...prev, { title: item.title, year: item.release_date ? parseInt(item.release_date.slice(0,4)) : null, media_type: item.media_type }]
    })
  }, [])

  // Drag scroll
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeft = useRef(0)

  const handleMouseDown = (e) => {
    isDragging.current = true
    startX.current = e.pageX - scrollRef.current.offsetLeft
    scrollLeft.current = scrollRef.current.scrollLeft
  }
  const handleMouseMove = (e) => {
    if (!isDragging.current) return
    e.preventDefault()
    const x = e.pageX - scrollRef.current.offsetLeft
    scrollRef.current.scrollLeft = scrollLeft.current - (x - startX.current) * 1.2
  }
  const handleMouseUp = () => { isDragging.current = false }

  const isLoading   = uiState === STATE.LOADING
  const isLoaded    = uiState === STATE.LOADED
  const isRerunning = uiState === STATE.RERUNNING
  const isError     = uiState === STATE.ERROR
  const isIdle      = uiState === STATE.IDLE

  return (
    <section className="ai-recs" aria-label="AI Recommendations">
      {/* ── Header ── */}
      <div className="section-header" style={{ flexWrap: 'wrap', marginBottom: '1rem', border: 'none', padding: 0 }}>
        <div className="section-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', marginRight: '8px' }}>
              <BsStars />
            </span>
            <ShinyText text="AI Recommendations" />
          </h2>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginLeft: 'auto' }}>
          <span className="ai-recs__gemini-badge">
            <ShinyText
              text="Powered by Gemini"
              speed={3}
              color="#c4b5fd"
              shineColor="#ede9fe"
              spread={100}
            />
          </span>
          {isLoaded && metadata?.personalized && (
            <span className="ai-recs__personalized-pill">
              <BsStars style={{ marginRight: '4px' }} /> Personalized
            </span>
          )}
        </div>
      </div>

      {/* ── IDLE ── */}
      {isIdle && (
        <div className="ai-recs__idle">
          <div className="ai-recs__idle-icon"><BsStars /></div>
          <p className="ai-recs__idle-text">
            Discover hidden gems and unexpected picks similar to <strong>{seedTitle}</strong> — curated by Gemini AI.
          </p>
          <button
            id="ai-recs-cta-btn"
            className="ai-recs__cta-btn"
            onClick={handleGetRecs}
          >
            <BsStars style={{ marginRight: '6px' }} /> Get AI Recommendations
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {isLoading && (
        <div className="ai-recs__loading">
          <div className="ai-recs__spinner-ring" />
          <p className="ai-recs__loading-text"><BsStars style={{ marginRight: '6px', verticalAlign: 'middle', marginTop: '-2px' }} /> AI finding similar content...</p>
        </div>
      )}

      {/* ── ERROR ── */}
      {isError && (
        <div className="ai-recs__error">
          <p className="ai-recs__error-msg">
            <FiAlertTriangle style={{ marginRight: '6px', verticalAlign: 'middle', marginTop: '-2px' }} /> 
            {errorMessage}
          </p>
          <button className="ai-recs__retry-btn" onClick={handleGetRecs}>
            <FiRefreshCw style={{ marginRight: '6px' }} /> Retry
          </button>
        </div>
      )}

      {/* ── LOADED / RERUNNING ── */}
      {(isLoaded || isRerunning) && (
        <>
          {/* Stats bar */}
          {metadata && (
            <div className="ai-recs__stats">
              <span>{metadata.resolved} results</span>
              {metadata.dropped > 0 && (
                <>
                  <span className="ai-recs__stats-dot" />
                  <span>{metadata.dropped} unresolved</span>
                </>
              )}
              {rerunCount > 0 && (
                <>
                  <span className="ai-recs__stats-dot" />
                  <span>Re-run #{rerunCount}</span>
                </>
              )}
            </div>
          )}

          {/* Scroll row */}
          <div className="scroll-row-container" style={{ position: 'relative' }}>
            {isRerunning && (
              <div className="ai-recs__rerun-overlay">
                <div className="ai-recs__spinner-ring" />
                <p className="ai-recs__rerun-overlay-text">Finding new picks...</p>
              </div>
            )}
            <div
              ref={scrollRef}
              className={`scroll-row${isRerunning ? ' ai-recs__scroll-row--rerunning' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {results.map((item) => (
                <AIRecCard
                  key={`${item.tmdb_id}:${item.media_type}`}
                  item={item}
                  isLoggedIn={isLoggedIn}
                  memoryMap={memoryMap}
                  onThumb={handleThumb}
                />
              ))}
            </div>
          </div>

          {/* ── Re-run Controls ── */}
          <div className="ai-recs__controls">
            <p className="ai-recs__controls-label">Not happy with results? Refine:</p>

            {/* Genre filter */}
            <div className="ai-recs__control-group">
              <span className="ai-recs__control-title">Focus genre</span>
              <select
                id="ai-recs-genre-select"
                className="ai-recs__select"
                value={focusGenre}
                onChange={(e) => setFocusGenre(e.target.value)}
              >
                <option value="">Any</option>
                {TMDB_GENRES.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>

            {/* More like — chip multi-select from current results */}
            <div className="ai-recs__control-group">
              <span className="ai-recs__control-title">More like</span>
              <div className="ai-recs__more-like-list" role="group" aria-label="More like selections">
                {results.slice(0, 12).map((item) => {
                  const selected = moreLike.some(m => m.title === item.title)
                  return (
                    <button
                      key={`${item.tmdb_id}:${item.media_type}`}
                      className={`ai-recs__more-like-chip${selected ? ' ai-recs__more-like-chip--selected' : ''}`}
                      onClick={() => toggleMoreLike(item)}
                      title={item.title}
                    >
                      {selected ? '✓ ' : ''}{item.title}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Rerun button */}
            <button
              id="ai-recs-rerun-btn"
              className="ai-recs__rerun-btn"
              onClick={handleRerun}
              disabled={isRerunning}
            >
              <FiRefreshCw style={{ marginRight: '6px' }} /> Re-run AI
            </button>
          </div>
        </>
      )}
    </section>
  )
}
