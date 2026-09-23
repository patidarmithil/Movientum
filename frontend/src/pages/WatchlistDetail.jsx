/**
 * WatchlistDetail.jsx
 *
 * Route: /watchlists/:collectionId (protected)
 *
 * Layout: sticky filter rail on the left (a bottom sheet on mobile), a cover
 * banner the owner can replace with an uploaded image, the collection header,
 * then a grid of the shared MovieCard (same card as /explore).
 *
 * Speed:
 *  - Collection payload is kept in memory + sessionStorage and rendered
 *    immediately on revisit, then revalidated in the background.
 *  - OTT availability is fetched only the first time an OTT filter is used.
 *  - AddContentModal is code-split and loaded on first open.
 *  - Filters run client-side over the already-loaded items.
 */
import { useState, useEffect, useCallback, useRef, useMemo, memo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import {
  LuSlidersHorizontal, LuChevronDown, LuPlus, LuPencil, LuLock, LuX, LuArrowLeft,
  LuStar, LuSparkles, LuCheck, LuImagePlus, LuTrash2, LuLoaderCircle,
} from 'react-icons/lu'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import { useAuth } from '../context/AuthContext'
import { watchlistService } from '../services/watchlistService'
import { OTT, ottMatches } from '../utils/ott'
import './WatchlistDetail.css'

const AddContentModal = lazy(() => import('../components/AddContentModal'))

const TMDB = 'https://image.tmdb.org/t/p'

const SORTS = [
  { value: 'added',  label: 'Recently added' },
  { value: 'rating', label: 'Top rated' },
  { value: 'newest', label: 'Newest release' },
  { value: 'oldest', label: 'Oldest release' },
  { value: 'title',  label: 'Title A–Z' },
]
const RATINGS = [
  { value: 0, label: 'Any rating' },
  { value: 6, label: '★ 6+' },
  { value: 7, label: '★ 7+' },
  { value: 8, label: '★ 8+' },
  { value: 9, label: '★ 9+' },
]
const TYPES = [
  { value: 'all',   label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv',    label: 'Shows' },
]

// OTT tiles + matching (TMDB provider id, then name) live in utils/ott.js, shared
// with the Explore filter rail.

const DEFAULT_FILTERS = { sort: 'added', type: 'all', minRating: 0, highlyRated: false, newReleases: false, ott: [] }
const HIGHLY_RATED = 7.5
const NEW_RELEASE_YEARS = 3
const COVER_MAX_BYTES = 8 * 1024 * 1024

const itemKey = (m) => `${m.id}-${m.media_type || 'movie'}`

function countActive(f) {
  return (f.sort !== 'added') + (f.type !== 'all') + (f.minRating > 0) + f.highlyRated + f.newReleases + (f.ott.length > 0)
}

// ── Stale-while-revalidate cache for the collection payload ──────────────────
const memCache = new Map()
const storeKey = (id) => `wl:coll:${id}`

function readCache(id) {
  if (memCache.has(id)) return memCache.get(id)
  try {
    const raw = sessionStorage.getItem(storeKey(id))
    if (raw) {
      const data = JSON.parse(raw)
      memCache.set(id, data)
      return data
    }
  } catch { /* storage blocked */ }
  return null
}
function writeCache(id, data) {
  memCache.set(id, data)
  try { sessionStorage.setItem(storeKey(id), JSON.stringify(data)) } catch { /* quota / private mode */ }
}

function toItems(data) {
  return (data?.items || []).map((item) => ({
    ...(item.movie || {}),
    id: item.movie?.id ?? item.movie_id,
    media_type: item.movie?.media_type || item.media_type || 'movie',
    // Key into the /providers map, built from the same watchlist_items columns
    // the backend uses, so it matches even if the movie row's type differs.
    pkey: `${item.media_type || item.movie?.media_type || 'movie'}:${item.movie_id ?? item.movie?.id}`,
    added_at: item.added_at,
  }))
}

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

// Downscale big phone photos before upload — the server re-encodes anyway,
// so this only saves bandwidth. Falls back to the original file on any error.
async function shrinkImage(file, maxW = 1920, maxH = 1080) {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.88))
    return blob ? new File([blob], 'cover.webp', { type: 'image/webp' }) : file
  } catch {
    return file
  }
}

// ── Dropdown (listbox) ───────────────────────────────────────────────────────
function Dropdown({ value, options, onChange, label, id, className = '' }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const listRef = useRef(null)
  const selected = options.find((o) => o.value === value) || options[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    listRef.current?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }
  const choose = (opt) => { onChange(opt.value); setOpen(false) }

  const onListKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active]) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } // don't also close the sheet
    else if (e.key === 'Tab') { setOpen(false) }
  }

  return (
    <div className={`wl-dd ${open ? 'is-open' : ''} ${className}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className="wl-dd__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); openList() } }}
      >
        <span>{selected.label}</span>
        <LuChevronDown aria-hidden className="wl-dd__caret" />
      </button>
      {open && (
        <ul
          className="wl-dd__menu"
          role="listbox"
          tabIndex={-1}
          ref={listRef}
          aria-label={label}
          aria-activedescendant={`${id}-opt-${active}`}
          onKeyDown={onListKey}
        >
          {options.map((opt, i) => (
            <li
              key={opt.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={opt.value === value}
              className={`wl-dd__opt ${i === active ? 'is-active' : ''}`}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(opt)}
            >
              {opt.label}
              {opt.value === value && <LuCheck aria-hidden />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Filter panel (shared by the desktop rail and the mobile sheet) ───────────
function FilterPanel({ value, onChange, ottCounts, providersLoading, idPrefix }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const toggleOtt = (id) => set({ ott: value.ott.includes(id) ? value.ott.filter((x) => x !== id) : [...value.ott, id] })

  return (
    <div className="wl-fp">
      <section className="wl-fp__group">
        <h3 className="wl-fp__title">Sort by</h3>
        <Dropdown id={`${idPrefix}-sort`} label="Sort by" value={value.sort} options={SORTS} onChange={(v) => set({ sort: v })} className="wl-dd--block" />
      </section>

      <section className="wl-fp__group">
        <h3 className="wl-fp__title">Quick picks</h3>
        <div className="wl-chips">
          <button type="button" aria-pressed={value.highlyRated} className={`wl-chip wl-chip--gold ${value.highlyRated ? 'is-on' : ''}`} onClick={() => set({ highlyRated: !value.highlyRated })}>
            <span className="wl-chip__box" /> <LuStar aria-hidden /> Rated {HIGHLY_RATED}+
          </button>
          <button type="button" aria-pressed={value.newReleases} className={`wl-chip wl-chip--mint ${value.newReleases ? 'is-on' : ''}`} onClick={() => set({ newReleases: !value.newReleases })}>
            <span className="wl-chip__box" /> <LuSparkles aria-hidden /> Recent releases
          </button>
        </div>
      </section>

      <section className="wl-fp__group">
        <h3 className="wl-fp__title">Content type</h3>
        <div className="wl-pills">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={value.type === t.value}
              className={`wl-pill ${value.type === t.value ? 'is-on' : ''}`}
              onClick={() => set({ type: t.value })}
            >
              {t.label}
            </button>
          ))}
          <Dropdown id={`${idPrefix}-rating`} label="Minimum rating" value={value.minRating} options={RATINGS} onChange={(v) => set({ minRating: v })} />
        </div>
      </section>

      <section className="wl-fp__group">
        <h3 className="wl-fp__title">
          OTT
          {providersLoading && <LuLoaderCircle className="wl-spin" aria-label="Checking where to watch" />}
        </h3>
        <div className="wl-ott">
          {OTT.map(({ id, label, bg, Icon, glyph }) => {
            const on = value.ott.includes(id)
            const n = ottCounts?.[id]
            return (
              <button key={id} type="button" aria-pressed={on} className={`wl-ott__tile ${on ? 'is-on' : ''} ${n === 0 ? 'is-empty' : ''}`} onClick={() => toggleOtt(id)}>
                <span className="wl-ott__logo" style={{ background: bg }} aria-hidden>
                  {Icon ? <Icon /> : glyph}
                </span>
                <span className="wl-ott__name">{label}</span>
                {n > 0 && <em className="wl-ott__n">{n}</em>}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ── Mobile bottom sheet ──────────────────────────────────────────────────────
function FilterSheet({ open, initial, onApply, onClose, ottCounts, providersLoading, onDraftChange }) {
  const [draft, setDraft] = useState(initial)
  const [dragY, setDragY] = useState(0)
  const dragStart = useRef(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open) return null

  const change = (next) => { setDraft(next); onDraftChange?.(next) }

  const onPointerDown = (e) => { dragStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId) }
  const onPointerMove = (e) => { if (dragStart.current != null) setDragY(Math.max(0, e.clientY - dragStart.current)) }
  const onPointerUp = () => {
    if (dragY > 110) onClose()
    dragStart.current = null
    setDragY(0)
  }

  return createPortal(
    <div className="wl-sheet" role="dialog" aria-modal="true" aria-labelledby="wl-sheet-title">
      <div className="wl-sheet__scrim" onClick={onClose} />
      <div className="wl-sheet__panel" style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}>
        <div
          className="wl-sheet__grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span />
        </div>
        <header className="wl-sheet__head">
          <LuSlidersHorizontal aria-hidden />
          <h2 id="wl-sheet-title">Filters</h2>
          <button type="button" className="wl-sheet__close" onClick={onClose} aria-label="Close filters"><LuX /></button>
        </header>
        <div className="wl-sheet__body">
          <FilterPanel value={draft} onChange={change} ottCounts={ottCounts} providersLoading={providersLoading} idPrefix="wl-m" />
        </div>
        <footer className="wl-sheet__foot">
          {countActive(draft) > 0 && (
            <button type="button" className="wl-sheet__clear" onClick={() => change(DEFAULT_FILTERS)}>Clear all</button>
          )}
          <button type="button" className="wl-btn wl-btn--primary wl-sheet__apply" onClick={() => onApply(draft)}>
            Apply changes
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ── Card: the shared MovieCard used on /explore, plus a remove button ──────
const WatchlistCard = memo(function WatchlistCard({ movie, onRemove }) {
  return (
    <div className="wl-item">
      <MovieCard movie={movie} />
      <button
        type="button"
        className="wl-item__remove"
        onClick={() => onRemove(movie)}
        aria-label={`Remove ${movie.title} from collection`}
        title="Remove from collection"
      >
        <LuX aria-hidden />
      </button>
    </div>
  )
})

// ── Inline edit form ─────────────────────────────────────────────────────────
function InlineEdit({ initialName, initialDescription, onSave, onCancel, saving }) {
  const [name, setName] = useState(initialName)
  const [desc, setDesc] = useState(initialDescription || '')
  const nameRef = useRef(null)

  useEffect(() => {
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [])

  const submit = (e) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onSave(trimmed, desc.trim())
  }

  return (
    <form className="wl-edit" onSubmit={submit} onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}>
      <label className="wl-edit__field">
        <span>Name</span>
        <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value.slice(0, 50))} maxLength={50} id="wl-edit-name" />
        <small>{name.length}/50</small>
      </label>
      <label className="wl-edit__field">
        <span>Description</span>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value.slice(0, 150))}
          maxLength={150}
          rows={2}
          placeholder="What ties these titles together?"
          id="wl-edit-desc"
        />
        <small>{desc.length}/150</small>
      </label>
      <div className="wl-edit__actions">
        <button type="submit" className="wl-btn wl-btn--primary" disabled={saving || !name.trim()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="wl-btn wl-btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function WatchlistDetail() {
  const { collectionId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isMobile = useMediaQuery('(max-width: 900px)')

  const [loadedId, setLoadedId]     = useState(collectionId)
  const [collection, setCollection] = useState(() => readCache(collectionId))
  const [items, setItems]           = useState(() => toItems(readCache(collectionId)))
  const [loading, setLoading]       = useState(() => !readCache(collectionId))
  const [error, setError]           = useState(null)

  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [providers, setProviders] = useState(null)        // { "movie:1": ["Netflix"] }
  const [providersLoading, setProvidersLoading] = useState(false)

  const [coverPreview, setCoverPreview] = useState(null)   // object URL while uploading
  const [coverBusy, setCoverBusy] = useState(false)
  const [coverError, setCoverError] = useState(null)
  const fileRef = useRef(null)

  // Route param changed without a remount → reset to the new collection's cache.
  if (loadedId !== collectionId) {
    const cached = readCache(collectionId)
    setLoadedId(collectionId)
    setCollection(cached)
    setItems(toItems(cached))
    setLoading(!cached)
    setError(null)
    setProviders(null)
    setFilters(DEFAULT_FILTERS)
  }

  useEffect(() => {
    document.title = collection ? `${collection.name} - Movientum` : 'Watchlist - Movientum'
  }, [collection])

  const applyData = useCallback((data) => {
    writeCache(collectionId, data)
    setCollection(data)
    setItems(toItems(data))
  }, [collectionId])

  const revalidate = useCallback(() => {
    return watchlistService.getCollection(collectionId)
      .then((data) => { applyData(data); setError(null) })
      .catch((err) => {
        if (readCache(collectionId)) return // keep showing the cached copy
        setError(err?.response?.status === 404
          ? 'This collection doesn’t exist or was deleted.'
          : 'Couldn’t load this collection. Check your connection and try again.')
      })
      .finally(() => setLoading(false))
  }, [collectionId, applyData])

  useEffect(() => { revalidate() }, [revalidate])

  // OTT data is only needed once someone actually filters by it.
  const ensureProviders = useCallback(() => {
    if (providers || providersLoading) return
    setProvidersLoading(true)
    watchlistService.getProviders(collectionId)
      .then((data) => setProviders(data?.items || {}))
      .catch(() => setProviders({}))
      .finally(() => setProvidersLoading(false))
  }, [collectionId, providers, providersLoading])

  // An added title has no provider data yet: refetch now if the OTT filter is
  // in use, otherwise just drop the stale map so the next OTT click reloads it.
  const onItemAdded = useCallback(() => {
    revalidate()
    if (!filters.ott.length) { setProviders(null); return }
    setProvidersLoading(true)
    watchlistService.getProviders(collectionId)
      .then((data) => setProviders(data?.items || {}))
      .catch(() => { /* keep the previous map */ })
      .finally(() => setProvidersLoading(false))
  }, [revalidate, filters.ott.length, collectionId])

  const changeFilters = useCallback((next) => {
    if (next.ott.length) ensureProviders()
    setFilters(next)
  }, [ensureProviders])

  const ottOf = useCallback((m) => {
    const list = providers?.[m.pkey] || []
    return OTT.filter((o) => list.some((p) => ottMatches(o, p))).map((o) => o.id)
  }, [providers])

  const ottCounts = useMemo(() => {
    if (!providers) return null
    const counts = Object.fromEntries(OTT.map((o) => [o.id, 0]))
    items.forEach((m) => ottOf(m).forEach((id) => { counts[id] += 1 }))
    return counts
  }, [providers, items, ottOf])

  const filteredItems = useMemo(() => {
    const f = filters
    const minYear = new Date().getFullYear() - NEW_RELEASE_YEARS + 1
    const ottActive = f.ott.length > 0 && providers
    let result = items.filter((m) => {
      if (f.type !== 'all' && m.media_type !== f.type) return false
      if (f.minRating && (m.vote_average || 0) < f.minRating) return false
      if (f.highlyRated && (m.vote_average || 0) < HIGHLY_RATED) return false
      if (f.newReleases && (!m.release_year || m.release_year < minYear)) return false
      if (ottActive && !ottOf(m).some((id) => f.ott.includes(id))) return false
      return true
    })
    const year = (m) => m.release_year || 0
    if (f.sort === 'rating') result = [...result].sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))
    else if (f.sort === 'newest') result = [...result].sort((a, b) => year(b) - year(a))
    else if (f.sort === 'oldest') result = [...result].sort((a, b) => (year(a) || 9999) - (year(b) || 9999))
    else if (f.sort === 'title') result = [...result].sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    return result
  }, [items, filters, providers, ottOf])

  const activeCount = countActive(filters)

  const handleSaveEdit = (newName, newDesc) => {
    setSaving(true)
    watchlistService.updateCollection(collectionId, newName, newDesc)
      .then((updated) => {
        applyData({
          ...collection,
          name: updated?.name ?? newName,
          description: updated?.description ?? newDesc,
          updated_at: updated?.updated_at ?? collection?.updated_at,
        })
        setEditing(false)
      })
      .catch(() => { /* keep the form open so the user can retry */ })
      .finally(() => setSaving(false))
  }

  const handleRemove = useCallback((movie) => {
    const key = itemKey(movie)
    setItems((prev) => prev.filter((m) => itemKey(m) !== key))
    setCollection((prev) => {
      if (!prev) return prev
      const next = {
        ...prev,
        item_count: Math.max(0, (prev.item_count || 1) - 1),
        items: (prev.items || []).filter((it) => `${it.movie?.id ?? it.movie_id}-${it.movie?.media_type || it.media_type || 'movie'}` !== key),
      }
      writeCache(collectionId, next)
      return next
    })
    watchlistService.removeFromCollection(collectionId, movie.id, movie.media_type || 'movie').catch(() => revalidate())
  }, [collectionId, revalidate])

  // ── Cover upload ─────────────────────────────────────────────────────────
  const onPickCover = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setCoverError('Use a JPG, PNG or WebP image.'); return }
    if (file.size > COVER_MAX_BYTES) { setCoverError('Image is larger than 8 MB.'); return }

    setCoverError(null)
    setCoverBusy(true)
    const preview = URL.createObjectURL(file)
    setCoverPreview(preview)
    try {
      const upload = await shrinkImage(file)
      const res = await watchlistService.uploadCover(collectionId, upload)
      applyData({ ...collection, cover_image_url: res.cover_image_url, updated_at: res.updated_at ?? collection?.updated_at })
    } catch (err) {
      setCoverError(err?.response?.data?.detail || 'Couldn’t upload the image. Try again.')
    } finally {
      setCoverBusy(false)
      setCoverPreview(null)
      URL.revokeObjectURL(preview)
    }
  }

  const onRemoveCover = async () => {
    setCoverBusy(true)
    setCoverError(null)
    try {
      const res = await watchlistService.deleteCover(collectionId)
      applyData({ ...collection, cover_image_url: null, updated_at: res?.updated_at ?? collection?.updated_at })
    } catch {
      setCoverError('Couldn’t remove the cover. Try again.')
    } finally {
      setCoverBusy(false)
    }
  }

  if (error) {
    return (
      <main className="wl-page page-content">
        <div className="wl-error">
          <p>{error}</p>
          <button className="wl-btn wl-btn--primary" onClick={() => navigate('/dashboard')} id="wl-back-btn">
            Go to dashboard
          </button>
        </div>
      </main>
    )
  }

  const itemCount = collection?.item_count ?? items.length
  const customCover = coverPreview || collection?.cover_image_url
  const posterCover = collection?.cover_posters?.[0] || items.find((m) => m.poster_path)?.poster_path
  const updated = collection?.updated_at
    ? new Date(collection.updated_at).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null
  const waitingForOtt = filters.ott.length > 0 && !providers

  return (
    <main className="wl-page page-content" id="watchlist-detail-page">
      <div className="wl-layout">

        {!isMobile && (
          <aside className="wl-rail" aria-label="Filters">
            <header className="wl-rail__head">
              <LuSlidersHorizontal aria-hidden />
              <h2>Filters</h2>
              {activeCount > 0 && (
                <button type="button" className="wl-rail__clear" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear</button>
              )}
            </header>
            <FilterPanel value={filters} onChange={changeFilters} ottCounts={ottCounts} providersLoading={providersLoading} idPrefix="wl-d" />
          </aside>
        )}

        <section className="wl-main">
          <div className={`wl-cover ${customCover ? 'has-custom' : ''}`}>
            {loading ? (
              <div className="wl-cover__skeleton" />
            ) : customCover ? (
              <img className="wl-cover__custom" src={customCover} alt="" fetchPriority="high" decoding="async" />
            ) : posterCover ? (
              <>
                <img className="wl-cover__blur" src={`${TMDB}/w342${posterCover}`} alt="" aria-hidden decoding="async" />
                <img className="wl-cover__img" src={`${TMDB}/w780${posterCover}`} alt="" fetchPriority="high" decoding="async" />
              </>
            ) : (
              <div className="wl-cover__empty" />
            )}

            {coverBusy && <div className="wl-cover__busy"><LuLoaderCircle className="wl-spin" aria-label="Uploading cover" /></div>}

            <button className="wl-cover__back" onClick={() => navigate(-1)} aria-label="Go back" id="wl-nav-back-btn">
              <LuArrowLeft aria-hidden />
            </button>
            <div className="wl-cover__actions">
              <button className="wl-btn wl-btn--primary" id="wl-add-content-btn" disabled={loading} onClick={() => setShowAddModal(true)}>
                <LuPlus aria-hidden /> Add content
              </button>
              <button
                className="wl-icon-btn wl-icon-btn--dark"
                onClick={() => setEditing(true)}
                disabled={loading || saving}
                aria-label="Edit name and description"
                title="Edit name and description"
                id="wl-edit-btn"
              >
                <LuPencil aria-hidden />
              </button>
            </div>

            {!loading && (
              <div className="wl-cover__tools">
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPickCover} hidden />
                <button type="button" className="wl-cover__tool" onClick={() => fileRef.current?.click()} disabled={coverBusy}>
                  <LuImagePlus aria-hidden /> {collection?.cover_image_url ? 'Change cover' : 'Upload cover'}
                </button>
                {collection?.cover_image_url && !coverBusy && (
                  <button type="button" className="wl-cover__tool wl-cover__tool--icon" onClick={onRemoveCover} aria-label="Remove cover image" title="Remove cover image">
                    <LuTrash2 aria-hidden />
                  </button>
                )}
              </div>
            )}
            {coverError && <p className="wl-cover__error" role="alert">{coverError}</p>}
          </div>

          <header className="wl-head">
            {editing ? (
              <InlineEdit
                initialName={collection?.name || ''}
                initialDescription={collection?.description || ''}
                onSave={handleSaveEdit}
                onCancel={() => setEditing(false)}
                saving={saving}
              />
            ) : (
              <>
                <div className="wl-head__titlerow">
                  <h1 className="wl-title">
                    {loading ? <span className="wl-skel wl-skel--title" /> : (collection?.name || 'Untitled collection')}
                  </h1>
                  {!loading && <span className="wl-badge"><LuLock aria-hidden /> Private</span>}
                </div>
                {!loading && collection?.description && <p className="wl-desc">{collection.description}</p>}
              </>
            )}

            <div className="wl-head__row">
              <div className="wl-owner" title={user?.username ? `Created by ${user.username}` : undefined}>
                {user?.avatar_url ? <img src={user.avatar_url} alt="" /> : <span>{(user?.username || 'U')[0].toUpperCase()}</span>}
              </div>
              <p className="wl-meta">
                {loading ? <span className="wl-skel wl-skel--meta" /> : (
                  <>
                    {itemCount} {itemCount === 1 ? 'item' : 'items'}
                    {updated && <> · Updated {updated}</>}
                    {activeCount > 0 && !waitingForOtt && <> · showing {filteredItems.length}</>}
                  </>
                )}
              </p>
            </div>
          </header>

          {isMobile && (
            <div className="wl-mbar">
              <button type="button" className="wl-mbar__btn" onClick={() => setSheetOpen(true)}>
                <LuSlidersHorizontal aria-hidden /> Filters
                {activeCount > 0 && <span className="wl-mbar__count">{activeCount}</span>}
              </button>
              <span className="wl-mbar__sort">{SORTS.find((s) => s.value === filters.sort)?.label}</span>
            </div>
          )}

          {waitingForOtt && <p className="wl-note"><LuLoaderCircle className="wl-spin" aria-hidden /> Checking where each title streams…</p>}

          {loading ? (
            <div className="wl-grid movie-grid" aria-busy="true">
              <MovieCardSkeleton count={10} />
            </div>
          ) : filteredItems.length > 0 ? (
            <div className="wl-grid movie-grid">
              {filteredItems.map((movie) => (
                <WatchlistCard key={itemKey(movie)} movie={movie} onRemove={handleRemove} />
              ))}
            </div>
          ) : items.length > 0 ? (
            <div className="wl-empty">
              <h3>No titles match these filters</h3>
              <p>Loosen a filter or clear them all to see the full collection.</p>
              <button className="wl-btn wl-btn--ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>
            </div>
          ) : (
            <div className="wl-empty">
              <h3>This collection is empty</h3>
              <p>Add movies and shows you want to keep together.</p>
              <button className="wl-btn wl-btn--primary" id="wl-add-first-btn" onClick={() => setShowAddModal(true)}>
                <LuPlus aria-hidden /> Add content
              </button>
            </div>
          )}
        </section>
      </div>

      {isMobile && (
        <FilterSheet
          key={sheetOpen ? 'open' : 'closed'}
          open={sheetOpen}
          initial={filters}
          onApply={(next) => { changeFilters(next); setSheetOpen(false) }}
          onClose={() => setSheetOpen(false)}
          onDraftChange={(next) => { if (next.ott.length) ensureProviders() }}
          ottCounts={ottCounts}
          providersLoading={providersLoading}
        />
      )}

      {showAddModal && (
        <Suspense fallback={null}>
          <AddContentModal
            collectionId={collectionId}
            isOpen={showAddModal}
            onClose={() => setShowAddModal(false)}
            onItemAdded={onItemAdded}
            existingItems={items.map((m) => ({ id: m.id, media_type: m.media_type }))}
          />
        </Suspense>
      )}
    </main>
  )
}
