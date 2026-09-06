import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import Aurora from '../components/Aurora'
import ImageLightbox from '../components/ImageLightbox'
import { useAuth } from '../context/AuthContext'
import { tierListService } from '../services/tierListService'
import useTierDrag from '../hooks/useTierDrag'
// The board, row, tile and button rules are shared with the maker page.
import './TierBoard.css'
import './TierList.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

/**
 * Coming back from a board should land you where you left, and the global
 * ScrollRestore can only do that if the page is the same height and shows the
 * same templates on the first paint. So both the catalogue and the filter are
 * kept in sessionStorage: the grid renders full-height immediately, then the
 * network response revalidates it.
 */
const CATALOGUE_KEY = 'tierlist_catalogue_v1'
const FILTERS_KEY = 'tierlist_filters_v1'
const EMPTY_CATALOGUE = { categories: [], templates: [] }

function readSession(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch { /* private mode, or the quota is full — not worth failing over */ }
}

/** Three rows is enough to teach the gesture without turning the hero into a tool. */
const DEMO_ROWS = [
  { id: 'demo-s', label: 'S', color: '#E0596E' },
  { id: 'demo-a', label: 'A', color: '#E08A4C' },
  { id: 'demo-b', label: 'B', color: '#CDB050' },
]

/**
 * The hero is a working miniature of the thing you came here to use.
 *
 * It costs nothing extra: the posters are the cover images already returned with the
 * template catalogue. Two tiles start ranked so the shape of a finished board is
 * legible at a glance; the rest are yours to drag.
 */
function HeroBoard({ posters, onZoom }) {
  const [rows, setRows] = useState(() => ({
    'demo-s': posters.slice(0, 2),
    'demo-a': posters.slice(2, 3),
    'demo-b': [],
    tray: posters.slice(3, 10),
  }))

  useEffect(() => {
    setRows({
      'demo-s': posters.slice(0, 2),
      'demo-a': posters.slice(2, 3),
      'demo-b': [],
      tray: posters.slice(3, 10),
    })
  }, [posters])

  const { drag, startDrag, draggingKey, justDragged } = useTierDrag({
    onMove: (key, from, to, index) => {
      setRows((prev) => {
        const next = { ...prev }
        for (const z of Object.keys(next)) next[z] = next[z].filter((p) => p !== key)
        const at = Math.min(index, next[to].length)
        next[to] = [...next[to].slice(0, at), key, ...next[to].slice(at)]
        return next
      })
    },
  })

  const tile = (path, zone) => (
    <button
      key={path}
      type="button"
      className={'tier-tile' + (draggingKey === path ? ' tier-tile--dragging' : '')}
      data-tier-item={path}
      aria-label="Demo poster"
      onPointerDown={(e) => startDrag(e, path, zone)}
      onClick={() => { if (!justDragged()) onZoom(path) }}
    >
      <img src={`${TMDB_IMAGE_BASE}/w185${path}`} alt="" draggable="false" loading="lazy" />
    </button>
  )

  const zone = (id) => (
    <div
      className={'tier-row__zone' + (drag?.overZone === id ? ' is-over' : '')}
      data-tier-zone={id}
    >
      {rows[id].map((p) => tile(p, id))}
    </div>
  )

  return (
    <div className="tierlist-hero__board" aria-label="Try the tier board">
      <div className="tier-board">
        {DEMO_ROWS.map((r) => (
          <div className="tier-row" key={r.id}>
            <div className="tier-row__label" style={{ background: r.color }} data-len="short">
              <span>{r.label}</span>
            </div>
            {zone(r.id)}
          </div>
        ))}
      </div>
      <div
        className={'tierlist-hero__tray' + (drag?.overZone === 'tray' ? ' is-over' : '')}
        data-tier-zone="tray"
      >
        {rows.tray.map((p) => tile(p, 'tray'))}
      </div>
      {drag && (
        <div
          className="tier-ghost"
          style={{
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
            width: drag.width,
            height: drag.height,
          }}
          aria-hidden="true"
        >
          <img src={`${TMDB_IMAGE_BASE}/w185${drag.itemKey}`} alt="" draggable="false" />
        </div>
      )}
    </div>
  )
}

export default function TierList() {
  const navigate = useNavigate()
  const { user } = useAuth()

  // Read once, on the first render — a lazy useState initialiser rather than a
  // ref, so nothing reads mutable state during render.
  const [cached] = useState(() => readSession(CATALOGUE_KEY, null))
  const [savedFilters] = useState(() => readSession(FILTERS_KEY, null))

  const [catalogue, setCatalogue] = useState(cached || EMPTY_CATALOGUE)
  const [mine, setMine] = useState([])
  const [activeCategory, setActiveCategory] = useState(savedFilters?.category || 'all')
  const [query, setQuery] = useState(savedFilters?.query || '')
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState('')
  const [zoomed, setZoomed] = useState(null)
  const gridRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    tierListService
      .getTemplates()
      .then((data) => {
        if (cancelled) return
        setCatalogue(data)
        writeSession(CATALOGUE_KEY, data)
      })
      .catch(() => {
        // A cached catalogue is still a usable page — only complain if there is
        // nothing on screen to fall back on.
        if (!cancelled && !cached) setError('Could not load the templates. Try again in a moment.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [cached])

  useEffect(() => {
    writeSession(FILTERS_KEY, { category: activeCategory, query })
  }, [activeCategory, query])

  useEffect(() => {
    if (!user) { setMine([]); return }
    let cancelled = false
    tierListService
      .getMine()
      .then((data) => { if (!cancelled) setMine(data.lists || []) })
      .catch(() => { if (!cancelled) setMine([]) })
    return () => { cancelled = true }
  }, [user])

  /** Cover posters from across the catalogue, seeded into the hero. */
  const heroPosters = useMemo(() => {
    const out = []
    for (const t of catalogue.templates) {
      for (const c of t.cover || []) {
        if (!out.includes(c)) out.push(c)
        if (out.length >= 10) return out
      }
    }
    return out
  }, [catalogue.templates])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalogue.templates.filter((t) => {
      if (activeCategory !== 'all' && t.category !== activeCategory) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [catalogue.templates, activeCategory, query])

  const countsByCategory = useMemo(() => {
    const map = {}
    for (const t of catalogue.templates) map[t.category] = (map[t.category] || 0) + 1
    return map
  }, [catalogue.templates])

  const pick = (category) => {
    setActiveCategory(category)
    setQuery('')
    // Only ever a response to a click — scrolling here on a restored render would
    // fight the scroll position being put back.
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="tierlist-page page-content">
      {/* Same aurora the dashboard and person pages run, in the page's own
          purple/green stops so the glass panes below still read as glass. */}
      <div className="tierlist-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#B048FF", "#00D4FF", "#FF006E"]}
          blend={0.5}
          amplitude={1.1}
          speed={0.7}
        />
        <div className="tierlist-aurora-overlay" />
      </div>

      <div className="tierlist-page__inner">

        <section className="tierlist-hero">
          <div className="tierlist-hero__copy">
            <h1>Rank everything you have watched.</h1>
            <p>
              Pick a set — a franchise, a director, a studio, a season of television —
              and drag it into order. Or rank your own watchlist, which is the one list
              nobody else has.
            </p>
            <div className="tierlist-hero__cta">
              <button type="button" className="tier-btn tier-btn--primary" onClick={() => navigate('/tierlist/new')}>
                Start a blank board
              </button>
              <a className="tier-btn tier-btn--quiet" href="#tierlist-templates">
                Browse {catalogue.templates.length || ''} templates
              </a>
            </div>
          </div>
          {heroPosters.length >= 6 && <HeroBoard posters={heroPosters} onZoom={setZoomed} />}
        </section>

        {mine.length > 0 && (
          <section className="tierlist-mine">
            <h2 className="tierlist-section-title">Your boards</h2>
            <div className="tierlist-mine__grid">
              {mine.map((b) => (
                <Link key={b.id} to={`/tierlist/my/${b.id}`} className="tierlist-saved">
                  <span className="tierlist-saved__covers">
                    {(b.covers || []).slice(0, 4).map((c, i) => (
                      <img key={c + i} src={`${TMDB_IMAGE_BASE}/w92${c}`} alt="" loading="lazy" />
                    ))}
                  </span>
                  <span className="tierlist-saved__body">
                    <span className="tierlist-saved__title">{b.title}</span>
                    <span className="tierlist-saved__meta">
                      {b.ranked_count} of {b.item_count} ranked
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="tierlist-browse" id="tierlist-templates">
          <nav className="tierlist-rail" aria-label="Template categories">
            <button
              type="button"
              className={'tierlist-rail__item' + (activeCategory === 'all' ? ' is-active' : '')}
              onClick={() => pick('all')}
            >
              <span>Everything</span>
              <span className="tierlist-rail__count">{catalogue.templates.length}</span>
            </button>
            {catalogue.categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={'tierlist-rail__item' + (activeCategory === c.id ? ' is-active' : '')}
                onClick={() => pick(c.id)}
              >
                <span>{c.label}</span>
                <span className="tierlist-rail__count">{countsByCategory[c.id] || 0}</span>
              </button>
            ))}
          </nav>

          <div className="tierlist-results" ref={gridRef}>
            <div className="tierlist-results__head">
              <input
                type="search"
                className="tierlist-search"
                value={query}
                placeholder="Find a template"
                aria-label="Search templates"
                onChange={(e) => setQuery(e.target.value)}
              />
              <p className="tierlist-results__count">
                {filtered.length} {filtered.length === 1 ? 'template' : 'templates'}
              </p>
            </div>

            {error && <div className="error-state">{error}</div>}

            {loading && (
              <div className="tierlist-grid">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="tierlist-card tierlist-card--skeleton skeleton" />
                ))}
              </div>
            )}

            {!loading && !error && filtered.length === 0 && (
              <div className="empty-state">
                No template matches that. Start a blank board and add titles by hand instead.
              </div>
            )}

            {!loading && !error && filtered.length > 0 && (
              <div className="tierlist-grid">
                {filtered.map((t) => (
                  <Link key={t.slug} to={`/tierlist/t/${t.slug}`} className="tierlist-card">
                    {/* The card is made of the content it holds — a fanned stack of
                        three real posters, not an icon standing in for them. */}
                    <span className="tierlist-card__fan" aria-hidden="true">
                      {(t.cover || []).slice(0, 3).map((c, i) => (
                        <img
                          key={c + i}
                          src={`${TMDB_IMAGE_BASE}/w185${c}`}
                          alt=""
                          loading="lazy"
                          style={{ '--i': i }}
                        />
                      ))}
                    </span>
                    <span className="tierlist-card__title">{t.title}</span>
                    <span className="tierlist-card__meta">
                      {t.auth ? 'From your library' : `${t.count} to rank`}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
      {zoomed && (
        <ImageLightbox
          src={`${TMDB_IMAGE_BASE}/original${zoomed}`}
          alt="Poster"
          onClose={() => setZoomed(null)}
        />
      )}

      <div className="fixed-bottom-fade" />
    </main>
  )
}
