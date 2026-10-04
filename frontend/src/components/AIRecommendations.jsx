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
import { useState, useRef, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { aiRecsService } from '../services/aiRecsService'
import useFeedbackBuffer from '../hooks/useFeedbackBuffer'
import FeedbackControl from './FeedbackControl'
import ShinyText from './ShinyText'
import BorderGlow from './BorderGlow'
import { BsStars } from 'react-icons/bs'
import { FiRefreshCw, FiAlertTriangle } from 'react-icons/fi'
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
function AIRecCard({ item, memoryMap, onThumb, onDismiss, isExiting = false }) {
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
          className={`movie-card movie-card--standard ${isVisible ? 'visible' : ''}${isExiting ? ' is-exiting' : ''}`}
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

          </div>

          <div className="movie-card__info">
            <h3 className="movie-card__title">{item.title}</h3>
            {/* Control lives in the meta row; CSS lifts it onto the poster foot
                on desktop and keeps it inline here on touch. */}
            <div className="movie-card__meta">
              <span className="movie-card__year">{item.release_date ? item.release_date.slice(0, 4) : ''}</span>
              <FeedbackControl
                kind="title"
                tmdbId={item.tmdb_id}
                mediaType={item.media_type}
                source="ai_recommendations"
                value={signal ?? null}
                onChange={(next) => onThumb(item, next)}
                onDismiss={onDismiss}
              />
            </div>
            {item.reason && (
              <p className="ai-rec-card__why" title={item.reason}>
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
  // Refine controls start open on desktop, collapsed on phones (they would
  // otherwise push the results off screen).
  const [refineOpen,   setRefineOpen]   = useState(
    () => typeof window === 'undefined' || !window.matchMedia('(max-width: 768px)').matches,
  )
  const [results,      setResults]      = useState([])
  // Hide-and-replace on a thumbs-down. Gemini returns a short list, so there is
  // no buffer to slide in from — the row simply closes the gap.
  const [metadata,     setMetadata]     = useState(null)   // { personalized, resolved, dropped }
  const [memoryMap,    setMemoryMap]    = useState({})     // { "tmdbId:mediaType": 'up'|'down' }
  const [focusGenre,   setFocusGenre]   = useState('')
  const [moreLike,     setMoreLike]     = useState([])     // [{ title, year, media_type }]
  const [previousIds,  setPreviousIds]  = useState([])
  const [rerunCount,   setRerunCount]   = useState(0)
  const [errorMessage, setErrorMessage] = useState('AI could not generate results. Please try again.')
  const scrollRef = useRef(null)

  const { visible: visibleResults, isExiting, dismiss } = useFeedbackBuffer(results)

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

  const handleThumb = useCallback(async (item, nextSignal) => {
    const key = `${item.tmdb_id}:${item.media_type}`
    const previous = memoryMap[key]

    // FeedbackControl has already resolved the toggle and updated optimistically,
    // so `nextSignal` is the final state — null means the user retracted.
    setMemoryMap(prev => ({ ...prev, [key]: nextSignal }))
    if (!nextSignal) return

    try {
      // One request, not two. POST /ai-recs/memory writes the ai_rec_memory row
      // the Gemini prompt reads back *and* hands the same signal to the unified
      // feedback worker, so an AI thumb moves the taste profile exactly like a
      // "More Like This" or "For You" thumb does.
      await aiRecsService.recordMemory({
        tmdbId:    item.tmdb_id,
        mediaType: item.media_type,
        signal:    nextSignal,
        title:     item.title,
        genres:    [],
      })
    } catch {
      setMemoryMap(prev => ({ ...prev, [key]: previous ?? undefined }))
    }
  }, [memoryMap])

  // More-like chip toggle
  const toggleMoreLike = useCallback((item) => {
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
    <section className={`ai-recs ai-recs--${uiState.toLowerCase()}`} aria-label="AI Recommendations">
      {/* ── Header ── */}
      <header className="ai-recs__head">
        <h2 className="ai-recs__heading">
          <span className="ai-recs__heading-icon" aria-hidden><BsStars /></span>
          <ShinyText text="AI Recommendations" />
        </h2>
        <div className="ai-recs__meta">
          <span className="ai-recs__gemini-badge">Gemini</span>
          {isLoaded && metadata?.personalized && (
            <span className="ai-recs__personalized-pill">
              <BsStars aria-hidden /> Personalized for you
            </span>
          )}
        </div>
      </header>

      {/* ── IDLE: one prompt, one action ── */}
      {isIdle && (
        <div className="ai-recs__prompt">
          <div className="ai-recs__prompt-copy">
            <p className="ai-recs__prompt-title">
              Find titles like <strong>{seedTitle}</strong>
            </p>
            <p className="ai-recs__prompt-sub">
              Gemini looks past the obvious sequels and picks hidden gems with the same feel.
            </p>
          </div>
          <button
            id="ai-recs-cta-btn"
            type="button"
            className="ai-recs__cta-btn"
            onClick={handleGetRecs}
          >
            <BsStars aria-hidden /> Get AI picks
          </button>
        </div>
      )}

      {/* ── LOADING: poster-shaped placeholders, not a spinner ── */}
      {isLoading && (
        <div className="ai-recs__loading" role="status">
          <p className="ai-recs__loading-text">
            <span className="ai-recs__pulse-dot" aria-hidden /> Finding titles like {seedTitle}…
          </p>
          <div className="ai-recs__ghost-row" aria-hidden>
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="ai-recs__ghost" style={{ animationDelay: `${i * 90}ms` }} />
            ))}
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {isError && (
        <div className="ai-recs__error" role="alert">
          <p className="ai-recs__error-msg">
            <FiAlertTriangle aria-hidden /> {errorMessage}
          </p>
          <button type="button" className="ai-recs__retry-btn" onClick={handleGetRecs}>
            <FiRefreshCw aria-hidden /> Try again
          </button>
        </div>
      )}

      {/* ── LOADED / RERUNNING ── */}
      {(isLoaded || isRerunning) && (
        <>
          {metadata && (
            <div className="ai-recs__stats">
              <span className="ai-recs__stat">{metadata.resolved} picks</span>
              {metadata.dropped > 0 && <span className="ai-recs__stat">{metadata.dropped} not found</span>}
              {rerunCount > 0 && <span className="ai-recs__stat">Refined {rerunCount}×</span>}
            </div>
          )}

          <div className="scroll-row-container ai-recs__row-wrap">
            {isRerunning && (
              <div className="ai-recs__rerun-overlay" role="status">
                <div className="ai-recs__spinner-ring" />
                <p className="ai-recs__rerun-overlay-text">Finding new picks…</p>
              </div>
            )}
            <div
              ref={scrollRef}
              className={`scroll-row ai-recs__row${isRerunning ? ' ai-recs__scroll-row--rerunning' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {visibleResults.map((item) => (
                <AIRecCard
                  key={`${item.tmdb_id}:${item.media_type}`}
                  item={item}
                  memoryMap={memoryMap}
                  onThumb={handleThumb}
                  onDismiss={() => dismiss(item)}
                  isExiting={isExiting(item)}
                />
              ))}
            </div>
          </div>

          {/* ── Refine (collapsible; closed by default on phones) ── */}
          <div className={`ai-recs__refine${refineOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              className="ai-recs__refine-toggle"
              aria-expanded={refineOpen}
              aria-controls="ai-recs-controls"
              onClick={() => setRefineOpen((o) => !o)}
            >
              <span>Refine these picks</span>
              {(focusGenre || moreLike.length > 0) && (
                <span className="ai-recs__refine-count">
                  {(focusGenre ? 1 : 0) + moreLike.length}
                </span>
              )}
              <svg className="ai-recs__refine-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {refineOpen && (
              <div className="ai-recs__controls" id="ai-recs-controls">
                <div className="ai-recs__control-group ai-recs__control-group--genre">
                  <label className="ai-recs__control-title" htmlFor="ai-recs-genre-select">Focus on a genre</label>
                  <select
                    id="ai-recs-genre-select"
                    className="ai-recs__select"
                    value={focusGenre}
                    onChange={(e) => setFocusGenre(e.target.value)}
                  >
                    <option value="">Any genre</option>
                    {TMDB_GENRES.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>

                <div className="ai-recs__control-group ai-recs__control-group--more">
                  <span className="ai-recs__control-title" id="ai-recs-more-label">More like these picks</span>
                  <div className="ai-recs__more-like-list" role="group" aria-labelledby="ai-recs-more-label">
                    {results.slice(0, 12).map((item) => {
                      const selected = moreLike.some(m => m.title === item.title)
                      return (
                        <button
                          key={`${item.tmdb_id}:${item.media_type}`}
                          type="button"
                          className={`ai-recs__more-like-chip${selected ? ' ai-recs__more-like-chip--selected' : ''}`}
                          aria-pressed={selected}
                          onClick={() => toggleMoreLike(item)}
                          title={item.title}
                        >
                          {item.title}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <button
                  id="ai-recs-rerun-btn"
                  type="button"
                  className="ai-recs__rerun-btn"
                  onClick={handleRerun}
                  disabled={isRerunning}
                >
                  <FiRefreshCw aria-hidden /> Get new picks
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
