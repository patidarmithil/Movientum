/**
 * RatingMeter.jsx — Phase 3.5C
 *
 * SVG semicircular gauge (Moctale Meter) showing 4 rating categories.
 * Colors:
 *   Skip       #FF4D6D
 *   Timepass   #FFC300
 *   Go for it  #00E5A0
 *   Perfection #9B59FF
 *
 * Props:
 *   movieId   — number
 *   isLoggedIn — bool (clickable pills when true)
 *   onRated   — optional callback after rating submitted
 */
import { useState, useEffect, useCallback } from 'react'
import { ratingService } from '../services/ratingService'
import { useAuth } from '../context/AuthContext'
import './RatingMeter.css'

const CATEGORIES = [
  { key: 'skip',       label: 'Skip',       color: '#FF4D6D' },
  { key: 'timepass',   label: 'Timepass',   color: '#FFC300' },
  { key: 'go_for_it',  label: 'Go for it',  color: '#00E5A0' },
  { key: 'perfection', label: 'Perfection', color: '#9B59FF' },
]

// SVG arc helpers (semicircle = 180°)
const R = 70
const CX = 100
const CY = 90
const STROKE_W = 18
const GAP = 3   // gap between segments in degrees

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = ((angleDeg - 180) * Math.PI) / 180
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
}

function arc(cx, cy, r, startDeg, endDeg) {
  const s = polarToCartesian(cx, cy, r, startDeg)
  const e = polarToCartesian(cx, cy, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`
}

function buildArcs(dist) {
  const total = dist.total || 0
  const segments = []

  if (total === 0) {
    // Equal quarters when no votes
    CATEGORIES.forEach((cat, i) => {
      const startDeg = i * 45 + GAP / 2
      const endDeg   = (i + 1) * 45 - GAP / 2
      segments.push({ ...cat, startDeg, endDeg, pct: 0 })
    })
  } else {
    let cursor = 0
    CATEGORIES.forEach((cat) => {
      const count = dist[cat.key] || 0
      const span  = (count / total) * 180
      const startDeg = cursor + GAP / 2
      const endDeg   = cursor + span - GAP / 2
      if (endDeg > startDeg + 0.5) {
        segments.push({ ...cat, startDeg, endDeg, pct: Math.round((count / total) * 100) })
      }
      cursor += span
    })
  }

  return segments
}

function dominant(dist) {
  if (!dist || dist.total === 0) return null
  return CATEGORIES.reduce((best, cat) =>
    (dist[cat.key] || 0) > (dist[best.key] || 0) ? cat : best
  )
}

export default function RatingMeter({ movieId, onRated }) {
  const { isLoggedIn } = useAuth()
  const [dist, setDist]       = useState(null)
  const [myRating, setMyRating] = useState(null) // category key of current user's pick
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState(null)

  const fetchDist = useCallback(async () => {
    try {
      const data = await ratingService.getDistribution(movieId)
      setDist(data)
    } catch {
      setError('Failed to load ratings')
    } finally {
      setLoading(false)
    }
  }, [movieId])

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchDist()
  }, [fetchDist])

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

  const safeDist = dist || { skip: 0, timepass: 0, go_for_it: 0, perfection: 0, total: 0 }
  const arcs     = buildArcs(safeDist)
  const dom      = dominant(safeDist)
  const total    = safeDist.total || 0

  return (
    <div className="rating-meter" id={`rating-meter-${movieId}`} role="region" aria-label="Rating distribution">
      {/* SVG Gauge */}
      <div className="rating-meter__gauge-wrap">
        <svg viewBox="0 0 200 100" className="rating-meter__svg" aria-hidden="true">
          {/* Track */}
          <path
            d={arc(CX, CY, R, 0, 180)}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={STROKE_W}
            strokeLinecap="round"
          />
          {/* Segments */}
          {arcs.map((seg) => (
            <path
              key={seg.key}
              d={arc(CX, CY, R, seg.startDeg, seg.endDeg)}
              fill="none"
              stroke={seg.color}
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              className="rating-meter__arc"
              style={{ filter: `drop-shadow(0 0 6px ${seg.color}88)` }}
            />
          ))}
          {/* Center text */}
          {dom && total > 0 ? (
            <>
              <text x={CX} y={CY - 14} textAnchor="middle" className="rating-meter__dom-label"
                fill={dom.color} fontSize="9" fontWeight="700" fontFamily="Outfit, sans-serif">
                {dom.label.toUpperCase()}
              </text>
              <text x={CX} y={CY + 2} textAnchor="middle" className="rating-meter__pct"
                fill="#fff" fontSize="20" fontWeight="800" fontFamily="Outfit, sans-serif">
                {Math.round(((safeDist[dom.key] || 0) / total) * 100)}%
              </text>
              <text x={CX} y={CY + 16} textAnchor="middle"
                fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="Inter, sans-serif">
                {safeDist[dom.key] || 0} / {total}
              </text>
            </>
          ) : (
            <>
              <text x={CX} y={CY} textAnchor="middle"
                fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="Inter, sans-serif">
                No ratings yet
              </text>
            </>
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="rating-meter__legend">
        {CATEGORIES.map((cat) => {
          const count = safeDist[cat.key] || 0
          const pct   = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <div key={cat.key} className="rating-meter__legend-item">
              <span className="rating-meter__legend-dot" style={{ background: cat.color }} />
              <span className="rating-meter__legend-name">{cat.label}</span>
              <span className="rating-meter__legend-pct" style={{ color: cat.color }}>{pct}%</span>
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
                id={`rate-pill-${movieId}-${cat.key}`}
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
  )
}
