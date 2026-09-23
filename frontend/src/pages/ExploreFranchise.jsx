/**
 * ExploreFranchise.jsx — one franchise, every title in order.
 *
 * Route: /explore/franchise/:slug
 * Data:  GET /api/v1/tierlist/templates/{slug} — the tier-list template resolver,
 *        cached for a week server-side, so a franchise costs no extra TMDB work.
 *
 * Rail: sort (creator's order = release order), content type, fade watched.
 * Watch history is only fetched the first time "Fade watched" is switched on.
 * An OTT filter is left out on purpose: it would need one provider lookup per title.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LuArrowLeft, LuEye, LuSlidersHorizontal, LuX } from 'react-icons/lu'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import { FilterSheet, Select } from '../components/explore/ExploreFilters'
import { tierListService } from '../services/tierListService'
import { watchService } from '../services/watchService'
import { useAuth } from '../context/AuthContext'
import { useMediaQuery } from '../hooks/useMediaQuery'
import ExploreAurora from '../components/explore/ExploreAurora'
import '../components/explore/explore-tokens.css'
import './ExploreResults.css'
import './ExploreFranchise.css'

const TMDB = 'https://image.tmdb.org/t/p'

const SORTS = [
  { value: 'order',  label: "Creator's order" },
  { value: 'newest', label: 'Newest first' },
  { value: 'title',  label: 'Title A–Z' },
]
const TYPES = [
  { value: 'movie', label: 'Movies' },
  { value: 'tv',    label: 'Shows' },
]
const DEFAULTS = { sort: 'order', type: '', fade: false }

const memo = new Map()

function toMovie(it, index) {
  return {
    id: it.id,
    title: it.name,
    poster_path: it.image,
    release_year: it.year,
    media_type: it.media || 'movie',
    order: index + 1,
  }
}

function RailControls({ value, onChange, idPrefix, watchedPct, isLoggedIn }) {
  const set = (p) => onChange({ ...value, ...p })
  return (
    <div className="xfp">
      {isLoggedIn && (
        <section className="xfp__group">
          <label className="xfr__fade">
            <LuEye aria-hidden />
            <span>Fade watched</span>
            <input
              type="checkbox"
              role="switch"
              checked={value.fade}
              onChange={(e) => set({ fade: e.target.checked })}
            />
            <span className="xfr__switch" aria-hidden />
          </label>
          <div className="xfr__progress" aria-label={`${watchedPct}% watched`}>
            <span style={{ width: `${watchedPct}%` }} />
            <em>{watchedPct}%</em>
          </div>
        </section>
      )}
      <section className="xfp__group">
        <h3 className="xfp__title">Sort by</h3>
        <Select id={`${idPrefix}-sort`} label="Sort by" value={value.sort} options={SORTS} onChange={(v) => set({ sort: v || 'order' })} />
      </section>
      <section className="xfp__group">
        <h3 className="xfp__title">Content type</h3>
        <div className="xpills" role="group" aria-label="Content type">
          {TYPES.map((t) => {
            const on = value.type === t.value
            return (
              <button key={t.value} type="button" aria-pressed={on} className={`xpill${on ? ' is-on' : ''}`} onClick={() => set({ type: on ? '' : t.value })}>
                {t.label}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

export default function ExploreFranchise() {
  const { slug } = useParams()
  // Keyed so moving between franchises resets filters and data.
  return <FranchisePage key={slug} slug={slug} />
}

function FranchisePage({ slug }) {
  const { isLoggedIn } = useAuth()
  const isMobile = useMediaQuery('(max-width: 900px)')

  const [data, setData] = useState(() => memo.get(slug) ?? null)
  const [error, setError] = useState(false)
  const [filters, setFilters] = useState(DEFAULTS)
  const [watched, setWatched] = useState(null) // Set of "media:id", loaded on demand
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    if (memo.has(slug)) return
    let alive = true
    tierListService.getTemplate(slug)
      .then((d) => { memo.set(slug, d); if (alive) setData(d) })
      .catch(() => { if (alive) setError(true) })
    return () => { alive = false }
  }, [slug])

  useEffect(() => {
    if (!filters.fade || watched || !isLoggedIn) return
    let alive = true
    watchService.getHistory()
      .then((r) => {
        if (!alive) return
        const keys = (r?.items ?? []).map((it) => `${it.media_type || it.movie?.media_type || 'movie'}:${it.movie_id ?? it.movie?.id}`)
        setWatched(new Set(keys))
      })
      .catch(() => alive && setWatched(new Set()))
    return () => { alive = false }
  }, [filters.fade, watched, isLoggedIn])

  const title = data?.display_title || data?.title || ''
  useEffect(() => {
    if (title) document.title = `${title} - Movientum`
  }, [title])

  const all = useMemo(() => (data?.items ?? []).map(toMovie), [data])
  const shown = useMemo(() => {
    let list = filters.type ? all.filter((m) => m.media_type === filters.type) : all
    if (filters.sort === 'newest') list = [...list].sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0))
    else if (filters.sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title))
    return list
  }, [all, filters.type, filters.sort])

  const isWatched = useCallback((m) => !!watched?.has(`${m.media_type}:${m.id}`), [watched])
  const watchedPct = watched && all.length ? Math.round((all.filter(isWatched).length / all.length) * 100) : 0
  const years = all.map((m) => m.release_year).filter(Boolean)
  const span = years.length ? `${Math.min(...years)}–${Math.max(...years)}` : ''
  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const nActive = (filters.sort !== 'order') + !!filters.type + filters.fade

  if (error) {
    return (
      <main className="xfr page-content">
        <ExploreAurora variant="saga" />
        <div className="xfr__missing">
          <h1>Franchise not found</h1>
          <p>This collection may have been renamed. Pick one from the full list.</p>
          <Link to="/explore/franchise" className="xres__btn">All franchises</Link>
        </div>
      </main>
    )
  }

  return (
    <main className="xfr page-content">
      <ExploreAurora variant="saga" />
      <div className="xfr__layout">
        {!isMobile && (
          <aside className="xfr__rail" aria-label="Filters">
            <header className="xres__rail-head">
              <LuSlidersHorizontal aria-hidden />
              <h2>Filters</h2>
            </header>
            <RailControls value={filters} onChange={setFilters} idPrefix="fr" watchedPct={watchedPct} isLoggedIn={isLoggedIn} />
          </aside>
        )}

        <article className="xfr__main">
          <Link to="/explore/franchise" className="xfr__back"><LuArrowLeft aria-hidden /> All franchises</Link>

          <div className="xfr__hero">
            {data?.backdrop ? (
              <img src={`${TMDB}/w1280${data.backdrop}`} alt="" />
            ) : (
              <div className="xfr__hero-posters" aria-hidden>
                {all.slice(0, 5).map((m) => m.poster_path && (
                  <img key={`${m.media_type}-${m.id}`} src={`${TMDB}/w342${m.poster_path}`} alt="" />
                ))}
              </div>
            )}
          </div>

          <header className="xfr__head">
            <h1 className="xfr__title">{title || <span className="xfr__ghost" />}</h1>
            {data && (
              <p className="xfr__meta">
                {all.length} titles{span && `, ${span}`}
              </p>
            )}
          </header>

          {isMobile && (
            <div className="xres__mbar">
              <button type="button" className="xres__mbtn" onClick={() => setSheetOpen(true)}>
                <LuSlidersHorizontal aria-hidden /> Filters
                {nActive > 0 && <span className="xres__badge">{nActive}</span>}
              </button>
              {filters.type && (
                <button type="button" className="xres__chip" onClick={() => setFilters({ ...filters, type: '' })}>
                  {filters.type === 'movie' ? 'Movies' : 'Shows'} <LuX aria-hidden />
                </button>
              )}
            </div>
          )}

          {!data && <div className="xfr__grid"><MovieCardSkeleton count={10} /></div>}
          <ol className="xfr__grid">
            {shown.map((m) => (
              <li key={`${m.media_type}-${m.id}`} className={`xfr__item${filters.fade && isWatched(m) ? ' is-watched' : ''}`}>
                <span className="xfr__num" aria-hidden>{m.order}</span>
                <MovieCard movie={m} />
              </li>
            ))}
          </ol>

          {data && shown.length === 0 && (
            <div className="xres__state">
              <p>No {filters.type === 'tv' ? 'shows' : 'movies'} in this franchise.</p>
              <button type="button" className="xres__btn" onClick={() => setFilters(DEFAULTS)}>Show everything</button>
            </div>
          )}
        </article>
      </div>

      {isMobile && sheetOpen && (
        <FilterSheet
          initial={filters}
          defaults={DEFAULTS}
          onClose={closeSheet}
          onApply={(next) => { setFilters(next); setSheetOpen(false) }}
        >
          {(draft, setDraft) => (
            <RailControls value={draft} onChange={setDraft} idPrefix="frm" watchedPct={watchedPct} isLoggedIn={isLoggedIn} />
          )}
        </FilterSheet>
      )}
    </main>
  )
}
