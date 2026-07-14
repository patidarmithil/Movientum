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
import './AIRecommendations.css'

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
  const signal = memoryMap[`${item.tmdb_id}:${item.media_type}`]

  const posterUrl = item.poster_path
    ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}`
    : null

  const detailHref = item.media_type === 'tv'
    ? `/tv/${item.tmdb_id}`
    : `/movie/${item.tmdb_id}`

  const cardClass = [
    'ai-rec-card',
    signal === 'up'   ? 'ai-rec-card--liked'    : '',
    signal === 'down' ? 'ai-rec-card--disliked'  : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={cardClass}>
      <div className="ai-rec-card__poster-wrap">
        {/* AI pick badge */}
        <span className="ai-rec-card__badge">✨ AI Pick</span>

        {/* Rating */}
        {item.vote_average > 0 && (
          <span className="ai-rec-card__rating">★ {item.vote_average?.toFixed(1)}</span>
        )}

        {/* Poster or placeholder */}
        <Link to={detailHref} tabIndex={-1}>
          {posterUrl ? (
            <img
              src={posterUrl}
              alt={item.title}
              className="ai-rec-card__poster"
              loading="lazy"
            />
          ) : (
            <div className="ai-rec-card__poster-placeholder">🎬</div>
          )}
        </Link>

        {/* Reason chip */}
        {item.reason && (
          <div className="ai-rec-card__reason" title={item.reason}>
            {item.reason}
          </div>
        )}

        {/* Thumbs overlay — logged-in only */}
        {isLoggedIn && (
          <div className="ai-rec-card__thumbs">
            <button
              className={`ai-rec-card__thumb-btn ai-rec-card__thumb-btn--up ${signal === 'up' ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); onThumb(item, 'up') }}
              title="Like"
              aria-label="Thumbs up"
            >
              👍
            </button>
            <button
              className={`ai-rec-card__thumb-btn ai-rec-card__thumb-btn--down ${signal === 'down' ? 'active' : ''}`}
              onClick={(e) => { e.preventDefault(); onThumb(item, 'down') }}
              title="Dislike"
              aria-label="Thumbs down"
            >
              👎
            </button>
          </div>
        )}
      </div>

      <Link to={detailHref} className="ai-rec-card__title" title={item.title}>
        {item.title}
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
      <div className="ai-recs__header">
        <h2 className="ai-recs__title">✨ AI Recommendations</h2>
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
            ✦ Personalized
          </span>
        )}
      </div>

      {/* ── IDLE ── */}
      {isIdle && (
        <div className="ai-recs__idle">
          <div className="ai-recs__idle-icon">✨</div>
          <p className="ai-recs__idle-text">
            Discover hidden gems and unexpected picks similar to <strong>{seedTitle}</strong> — curated by Gemini AI.
          </p>
          <button
            id="ai-recs-cta-btn"
            className="ai-recs__cta-btn"
            onClick={handleGetRecs}
          >
            ✨ Get AI Recommendations
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {isLoading && (
        <div className="ai-recs__loading">
          <div className="ai-recs__spinner-ring" />
          <p className="ai-recs__loading-text">✨ AI finding similar content...</p>
        </div>
      )}

      {/* ── ERROR ── */}
      {isError && (
        <div className="ai-recs__error">
          <p className="ai-recs__error-msg">⚠ AI could not generate results. Please try again.</p>
          <button className="ai-recs__retry-btn" onClick={handleGetRecs}>
            🔄 Retry
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
          <div className="ai-recs__scroll-wrap">
            {isRerunning && (
              <div className="ai-recs__rerun-overlay">
                <div className="ai-recs__spinner-ring" />
                <p className="ai-recs__rerun-overlay-text">Finding new picks...</p>
              </div>
            )}
            <div
              ref={scrollRef}
              className={`ai-recs__scroll-row${isRerunning ? ' ai-recs__scroll-row--rerunning' : ''}`}
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
              🔄 Re-run AI
            </button>
          </div>
        </>
      )}
    </section>
  )
}
