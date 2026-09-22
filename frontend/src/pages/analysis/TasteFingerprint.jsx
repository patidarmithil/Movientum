import { useMemo } from 'react'

const SIZE = 440
const C = SIZE / 2
const R_BASE = 78        // the zero line every spoke grows from
const R_POS = 118        // longest outward spoke above the base
const R_NEG = 46         // deepest inward spoke below the base
const R_ERA = 206        // era ring radius
const LABELS = 5         // how many of the strongest genres get a label

const polar = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)]

/**
 * The hero graphic: one spoke per genre from the user's live taste profile.
 * Liked genres grow outward, disliked genres dig inward, and the outer ring
 * shows how the profile leans across decades. Genres are placed alphabetically
 * so the shape is stable between visits and only the lengths change.
 */
export default function TasteFingerprint({ genres = [], eras = [], interactions = 0 }) {
  const model = useMemo(() => {
    const list = [...genres].sort((a, b) => a.name.localeCompare(b.name))
    const maxPos = Math.max(1, ...list.map((g) => g.weight))
    const maxNeg = Math.max(1, ...list.map((g) => -g.weight))
    const step = (Math.PI * 2) / Math.max(list.length, 1)
    const labelled = new Set(
      [...list].sort((a, b) => b.weight - a.weight).slice(0, LABELS).filter((g) => g.weight > 0).map((g) => g.id),
    )
    const spokes = list.map((g, i) => {
      const a = -Math.PI / 2 + i * step
      const len = g.weight >= 0 ? (g.weight / maxPos) * R_POS : -(-g.weight / maxNeg) * R_NEG
      const [x1, y1] = polar(R_BASE, a)
      const [x2, y2] = polar(R_BASE + len, a)
      const [lx, ly] = polar(R_BASE + Math.max(len, 0) + 16, a)
      return { ...g, a, x1, y1, x2, y2, lx, ly, i, labelled: labelled.has(g.id) }
    })

    const eraMax = Math.max(1, ...eras.map((e) => Math.abs(e.weight)))
    const eraStep = (Math.PI * 2) / Math.max(eras.length, 1)
    const eraArcs = eras.map((e, i) => {
      const a0 = -Math.PI / 2 + i * eraStep + 0.04
      const a1 = a0 + eraStep - 0.08
      const [x0, y0] = polar(R_ERA, a0)
      const [x1, y1] = polar(R_ERA, a1)
      return {
        ...e,
        d: `M ${x0} ${y0} A ${R_ERA} ${R_ERA} 0 0 1 ${x1} ${y1}`,
        strength: Math.max(0, e.weight) / eraMax,
        mid: polar(R_ERA + 14, (a0 + a1) / 2),
      }
    })
    return { spokes, eraArcs }
  }, [genres, eras])

  const empty = model.spokes.length === 0
  const top = [...genres].sort((a, b) => b.weight - a.weight).slice(0, 3).map((g) => g.name)

  return (
    <figure className={`an-print${empty ? ' is-empty' : ''}`}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={empty ? 'Taste fingerprint, no data yet' : `Taste fingerprint. Strongest genres: ${top.join(', ')}.`}
      >
        <defs>
          <radialGradient id="anSpoke" cx={C} cy={C} r={R_BASE + R_POS} gradientUnits="userSpaceOnUse">
            <stop offset={R_BASE / (R_BASE + R_POS)} stopColor="#00E5A0" />
            <stop offset="1" stopColor="#9B59FF" />
          </radialGradient>
        </defs>

        {/* Guide rings */}
        <circle cx={C} cy={C} r={R_BASE + R_POS} className="an-print__guide" />
        <circle cx={C} cy={C} r={R_BASE + R_POS / 2} className="an-print__guide" />
        <circle cx={C} cy={C} r={R_BASE} className="an-print__base" />

        {/* Era ring */}
        {model.eraArcs.map((e) => (
          <path
            key={e.id}
            d={e.d}
            className="an-print__era"
            style={{ opacity: 0.12 + e.strength * 0.88 }}
          >
            <title>{`${e.id}: ${e.weight}`}</title>
          </path>
        ))}
        {model.eraArcs.filter((e) => e.strength > 0.6).map((e) => (
          <text key={`l-${e.id}`} x={e.mid[0]} y={e.mid[1]} className="an-print__era-label" textAnchor="middle" dominantBaseline="middle">
            {e.id}
          </text>
        ))}

        {/* Genre spokes */}
        {model.spokes.map((s) => (
          <g key={s.id}>
            <line
              x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
              pathLength="1"
              className={`an-print__spoke ${s.weight < 0 ? 'is-neg' : ''}`}
              stroke={s.weight < 0 ? '#FF4D6D' : 'url(#anSpoke)'}
              style={{ '--i': s.i }}
            >
              <title>{`${s.name}: ${s.weight > 0 ? '+' : ''}${s.weight}`}</title>
            </line>
            <circle cx={s.x2} cy={s.y2} r={s.labelled ? 4 : 2.2} className={`an-print__tip ${s.weight < 0 ? 'is-neg' : ''}`} style={{ '--i': s.i }} />
            {s.labelled && (
              <text
                x={s.lx} y={s.ly}
                className="an-print__label"
                textAnchor={Math.abs(Math.cos(s.a)) < 0.3 ? 'middle' : Math.cos(s.a) > 0 ? 'start' : 'end'}
                dominantBaseline="middle"
              >
                {s.name}
              </text>
            )}
          </g>
        ))}

        {/* Centre */}
        <text x={C} y={C - 6} textAnchor="middle" className="an-print__count">{interactions.toLocaleString()}</text>
        <text x={C} y={C + 16} textAnchor="middle" className="an-print__count-label">signals learned</text>
      </svg>
      <figcaption className="an-print__caption">
        {empty
          ? 'Your fingerprint appears after your first few watches, ratings or thumbs.'
          : 'Spokes outward: genres you lean into. Red spokes inward: genres you push away. Outer ring: decades.'}
      </figcaption>
    </figure>
  )
}
