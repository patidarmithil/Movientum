/**
 * RatingMeter.jsx — Phase 3.5C (Upgraded Premium UI)
 *
 * SVG semicircular gauge (Moctale Meter) showing 4 rating categories.
 * Colors:
 *   Skip       #ff5a5f
 *   Timepass   #f5c542
 *   Go for it  #5fd19b
 *   Perfection #8b5cf6
 *
 * Props:
 *   movieId     — number (optional if props below are passed)
 *   onRated     — optional callback after rating submitted
 *   perfection  — number (optional)
 *   go_for_it   — number (optional)
 *   timepass    — number (optional)
 *   skip        — number (optional)
 *   total_votes — number (optional)
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { ratingService } from '../services/ratingService'
import { useAuth } from '../context/AuthContext'
import './RatingMeter.css'

const CATEGORIES = [
  { key: 'skip',       label: 'Skip',       color: '#ff5a5f' },
  { key: 'timepass',   label: 'Timepass',   color: '#f5c542' },
  { key: 'go_for_it',  label: 'Go for it',  color: '#5fd19b' },
  { key: 'perfection', label: 'Perfection', color: '#8b5cf6' },
]

const R = 70
const CX = 100
const CY = 90
const STROKE_W = 20 // increased thickness slightly (+10% from 18)

const GRADIENTS = {
  skip: 'url(#grad-skip)',
  timepass: 'url(#grad-timepass)',
  go_for_it: 'url(#grad-go_for_it)',
  perfection: 'url(#grad-perfection)',
}

export default function RatingMeter({
  movieId,
  onRated,
  perfection,
  go_for_it,
  timepass,
  skip,
  total_votes,
  userRating
}) {
  const { isLoggedIn } = useAuth()
  
  // Detect if distribution data is supplied via props
  const hasPropsData =
    perfection !== undefined ||
    go_for_it !== undefined ||
    timepass !== undefined ||
    skip !== undefined

  const [dist, setDist] = useState(null)
  const [myRating, setMyRating] = useState(userRating || null)
  const [loading, setLoading] = useState(!hasPropsData)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [animated, setAnimated] = useState(false)
  const [animationDone, setAnimationDone] = useState(false)
  const [hoveredCategory, setHoveredCategory] = useState(null)

  const hoverTimeoutRef = useRef(null)

  useEffect(() => {
    if (userRating !== undefined) {
      setMyRating(userRating)
    }
  }, [userRating])

  const safeTotal = hasPropsData ? (total_votes ?? 0) : (dist?.total ?? 0)

  let pctPerfection, pctGoForIt, pctTimepass, pctSkip
  let votesPerfection, votesGoForIt, votesTimepass, votesSkip

  if (hasPropsData) {
    // Props are percentages
    pctPerfection = perfection ?? 0
    pctGoForIt = go_for_it ?? 0
    pctTimepass = timepass ?? 0
    pctSkip = skip ?? 0

    // Derive raw votes
    votesPerfection = safeTotal > 0 ? Math.round((pctPerfection / 100) * safeTotal) : 0
    votesGoForIt = safeTotal > 0 ? Math.round((pctGoForIt / 100) * safeTotal) : 0
    votesTimepass = safeTotal > 0 ? Math.round((pctTimepass / 100) * safeTotal) : 0
    votesSkip = safeTotal > 0 ? Math.round((pctSkip / 100) * safeTotal) : 0
  } else {
    // API returns raw votes
    votesPerfection = dist?.perfection ?? 0
    votesGoForIt = dist?.go_for_it ?? 0
    votesTimepass = dist?.timepass ?? 0
    votesSkip = dist?.skip ?? 0

    // Derive percentages
    pctPerfection = safeTotal > 0 ? (votesPerfection / safeTotal) * 100 : 0
    pctGoForIt = safeTotal > 0 ? (votesGoForIt / safeTotal) * 100 : 0
    pctTimepass = safeTotal > 0 ? (votesTimepass / safeTotal) * 100 : 0
    pctSkip = safeTotal > 0 ? (votesSkip / safeTotal) * 100 : 0
  }

  const percentages = {
    perfection: pctPerfection,
    go_for_it: pctGoForIt,
    timepass: pctTimepass,
    skip: pctSkip,
  }

  const votes = {
    perfection: votesPerfection,
    go_for_it: votesGoForIt,
    timepass: votesTimepass,
    skip: votesSkip,
  }

  // Find category with the maximum votes (dominant category) as default
  let maxCategoryKey = 'go_for_it'
  let maxCount = -1
  CATEGORIES.forEach((cat) => {
    const count = votes[cat.key] || 0
    if (count > maxCount) {
      maxCount = count
      maxCategoryKey = cat.key
    }
  })

  // Center display resolution: default is the category with the maximum votes
  const activeCategory = hoveredCategory || maxCategoryKey
  const activeColor = CATEGORIES.find(c => c.key === activeCategory)?.color
  const activePct = Math.round(percentages[activeCategory] || 0)
  const activeVotes = votes[activeCategory] || 0

  // Animate center percentage count-up / transitions smoothly
  const [displayPct, setDisplayPct] = useState(0)
  const displayPctRef = useRef(0)

  // Keep the ref in sync with displayPct state to avoid effect dependency re-triggers
  useEffect(() => {
    displayPctRef.current = displayPct
  }, [displayPct])

  useEffect(() => {
    if (safeTotal === 0) {
      setDisplayPct(0)
      return
    }

    const start = displayPctRef.current
    const end = activePct
    if (start === end) return

    const duration = 250 // ms count-up duration
    const startTime = performance.now()
    let animationFrameId

    const updateNumber = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const easeProgress = 1 - Math.pow(1 - progress, 3) // easeOutCubic
      const current = Math.round(start + (end - start) * easeProgress)
      
      setDisplayPct(current)

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(updateNumber)
      }
    }

    animationFrameId = requestAnimationFrame(updateNumber)
    return () => cancelAnimationFrame(animationFrameId)
  }, [activePct, safeTotal])

  const fetchDist = useCallback(async () => {
    if (hasPropsData) return
    try {
      const data = await ratingService.getDistribution(movieId)
      setDist(data)
    } catch {
      setError('Failed to load ratings')
    } finally {
      setLoading(false)
    }
  }, [movieId, hasPropsData])

  useEffect(() => {
    if (!hasPropsData) {
      setLoading(true)
      setError(null)
      fetchDist()
    }
  }, [fetchDist, hasPropsData])

  // Reset distribution state on movieId change to avoid flashing old movie data
  useEffect(() => {
    if (!hasPropsData) {
      setDist(null)
    }
    setDisplayPct(0)
    setHoveredCategory(null)
  }, [movieId, hasPropsData])

  // Trigger sweep animation on load/movie change
  useEffect(() => {
    setAnimated(false)
    setAnimationDone(false)
    const timer = setTimeout(() => {
      setAnimated(true)
    }, 100)
    const doneTimer = setTimeout(() => {
      setAnimationDone(true)
    }, 1300)

    return () => {
      clearTimeout(timer)
      clearTimeout(doneTimer)
    }
  }, [movieId, perfection, go_for_it, timepass, skip])

  const handleRate = async (category) => {
    if (!isLoggedIn || submitting) return
    setSubmitting(true)
    try {
      await ratingService.submitRating(movieId, category)
      setMyRating(category)
      await fetchDist()
      onRated?.()
    } catch {
      setError('Rating failed — are you logged in?')
    } finally {
      setSubmitting(false)
    }
  }

  const handleMouseEnter = (key) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    setHoveredCategory(key)
  }

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
    }
    hoverTimeoutRef.current = setTimeout(() => {
      setHoveredCategory(null)
    }, 120)
  }

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current)
      }
    }
  }, [])

  if (loading) {
    return (
      <div className="rating-meter rating-meter--loading" aria-label="Loading rating meter">
        <div className="rating-meter__skeleton" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="rating-meter rating-meter--error">
        <span>{error}</span>
      </div>
    )
  }

  // Build only segments with active votes
  const activeSegments = CATEGORIES.map((cat) => {
    const count = votes[cat.key]
    const pct = percentages[cat.key]
    return { ...cat, count, pct }
  }).filter((seg) => seg.count > 0)

  // Layout segments proportionally along the 100% pathLength
  let currentOffset = 0
  const segmentsWithLayout = activeSegments.map((seg) => {
    const dashStart = currentOffset
    const dashLength = seg.pct
    currentOffset += seg.pct
    
    return {
      ...seg,
      dashStart,
      dashLength,
    }
  })

  return (
    <div className="rating-meter-wrapper">
      {/* Radial ambient glow behind card */}
      <div className="rating-meter__blur-bleed" style={{ '--bleed-color': activeColor }} />

      <div className="rating-meter" id={`rating-meter-${movieId || 'prop'}`} role="region" aria-label="Rating distribution" style={{ '--active-color': activeColor }}>
        {/* SVG Gauge */}
        <div className="rating-meter__gauge-wrap">
          <svg viewBox="0 0 200 100" className="rating-meter__svg" aria-hidden="true">
            <defs>
              {/* Sweep clip path */}
              <clipPath id={`gauge-clip-${movieId || 'prop'}`}>
                <path
                  d="M 20 90 A 70 70 0 0 1 180 90"
                  fill="none"
                  stroke="white"
                  strokeWidth={STROKE_W + 10}
                  strokeLinecap="round"
                  pathLength="100"
                  style={{
                    transition: 'stroke-dashoffset 1.2s cubic-bezier(0.25, 1, 0.5, 1)',
                    strokeDasharray: '100 100',
                    strokeDashoffset: animated ? 0 : 100
                  }}
                />
              </clipPath>

              {/* Vertical Gradients for physical volume feel */}
              <linearGradient id="grad-skip" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ff7e82" />
                <stop offset="100%" stopColor="#d63b40" />
              </linearGradient>
              <linearGradient id="grad-timepass" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffd875" />
                <stop offset="100%" stopColor="#d19c15" />
              </linearGradient>
              <linearGradient id="grad-go_for_it" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#8df0c1" />
                <stop offset="100%" stopColor="#3ca675" />
              </linearGradient>
              <linearGradient id="grad-perfection" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#b08aff" />
                <stop offset="100%" stopColor="#6b3cc7" />
              </linearGradient>
            </defs>

            {/* Faint base track ambient glow */}
            <path
              d="M 20 90 A 70 70 0 0 1 180 90"
              fill="none"
              stroke="rgba(255, 255, 255, 0.02)"
              strokeWidth={STROKE_W + 4}
              strokeLinecap="round"
              style={{ filter: 'blur(3px)', pointerEvents: 'none' }}
            />

            {/* Background Track */}
            {safeTotal === 0 ? (
              <path
                d="M 20 90 A 70 70 0 0 1 180 90"
                fill="none"
                stroke="rgba(255, 255, 255, 0.03)"
                strokeWidth={STROKE_W}
                strokeLinecap="round"
                strokeDasharray="4 4"
                className="rating-meter__track rating-meter__track--empty"
              />
            ) : (
              <path
                d="M 20 90 A 70 70 0 0 1 180 90"
                fill="none"
                stroke="rgba(255, 255, 255, 0.06)"
                strokeWidth={STROKE_W}
                strokeLinecap="round"
                className="rating-meter__track"
              />
            )}

            {/* Active segments */}
            {safeTotal > 0 && (
              <g clipPath={animationDone ? undefined : `url(#gauge-clip-${movieId || 'prop'})`}>
                {segmentsWithLayout.map((seg) => {
                  const isHovered = hoveredCategory === seg.key
                  const isFaded = hoveredCategory !== null && hoveredCategory !== seg.key

                  return (
                    <path
                      key={seg.key}
                      d="M 20 90 A 70 70 0 0 1 180 90"
                      fill="none"
                      stroke={GRADIENTS[seg.key]}
                      strokeWidth={STROKE_W}
                      strokeLinecap="round"
                      pathLength="100"
                      strokeDasharray={`${seg.dashLength} 100`}
                      strokeDashoffset={-seg.dashStart}
                      className={`rating-meter__arc ${isHovered ? 'is-hovered' : ''} ${isFaded ? 'is-faded' : ''}`}
                      style={{
                        '--glow-color': seg.color,
                      }}
                      onMouseEnter={() => handleMouseEnter(seg.key)}
                      onMouseLeave={handleMouseLeave}
                    />
                  )
                })}
              </g>
            )}

            {/* 1px outer rim highlight for physical glass reflection */}
            <path
              d="M 20 90 A 80 80 0 0 1 180 90"
              fill="none"
              stroke="rgba(255, 255, 255, 0.09)"
              strokeWidth="0.8"
              strokeLinecap="round"
              style={{ pointerEvents: 'none' }}
            />

            {/* Center text */}
            {safeTotal === 0 ? (
              <text
                x={100}
                y={62}
                textAnchor="middle"
                className="rating-meter__no-ratings"
                fill="rgba(255, 255, 255, 0.22)"
                fontSize="10"
                fontWeight="500"
                fontFamily="Inter, sans-serif"
                style={{ letterSpacing: '0.5px' }}
              >
                No ratings yet
              </text>
            ) : (
              <>
                <text
                  x={100}
                  y={70}
                  textAnchor="middle"
                  className="rating-meter__pct"
                  fill={activeColor}
                  fontSize="36"
                  fontWeight="800"
                  fontFamily="Outfit, sans-serif"
                  style={{
                    textShadow: `0 0 15px ${activeColor}33`,
                    letterSpacing: '-1.5px',
                    transition: 'fill 260ms ease, text-shadow 260ms ease'
                  }}
                >
                  {displayPct}%
                </text>
                <text
                  x={100}
                  y={90}
                  textAnchor="middle"
                  className="rating-meter__votes"
                  fill="rgba(255, 255, 255, 0.32)"
                  fontSize="11"
                  fontWeight="500"
                  fontFamily="Inter, sans-serif"
                  style={{ letterSpacing: '0.2px' }}
                >
                  {activeVotes} / {safeTotal} Votes
                </text>
              </>
            )}
          </svg>
        </div>

        {/* Legend */}
        <div className="rating-meter__legend">
          {CATEGORIES.map((cat) => {
            const count = votes[cat.key]
            const pct = safeTotal > 0 ? Math.round((count / safeTotal) * 100) : 0
            const isActive = activeCategory === cat.key && safeTotal > 0

            return (
              <div
                key={cat.key}
                className={`rating-meter__legend-item ${isActive ? 'is-active' : ''}`}
                onMouseEnter={() => handleMouseEnter(cat.key)}
                onMouseLeave={handleMouseLeave}
                style={{
                  '--legend-color': cat.color,
                }}
              >
                <span className="rating-meter__legend-dot" style={{ background: cat.color }} />
                <span className="rating-meter__legend-name">{cat.label}</span>
                <span className="rating-meter__legend-pct" style={{ color: cat.color }}>
                  {pct}%
                </span>
              </div>
            )
          })}
        </div>

        {/* Rating Pills (logged-in only) */}
        {isLoggedIn && (
          <div className="rating-meter__pills" role="group" aria-label="Rate this movie">
            <p className="rating-meter__pills-label">Your rating:</p>
            <div className="rating-meter__pills-row">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  id={`rate-pill-${movieId || 'prop'}-${cat.key}`}
                  className={`rating-meter__pill${myRating === cat.key ? ' rating-meter__pill--active' : ''}`}
                  style={{
                    '--pill-color': cat.color,
                    borderColor: myRating === cat.key ? cat.color : 'transparent',
                  }}
                  onClick={() => handleRate(cat.key)}
                  disabled={submitting}
                  aria-pressed={myRating === cat.key}
                  title={`Rate as ${cat.label}`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isLoggedIn && (
          <p className="rating-meter__guest-note">
            <a href="/login">Log in</a> to rate this movie
          </p>
        )}
      </div>
    </div>
  )
}
