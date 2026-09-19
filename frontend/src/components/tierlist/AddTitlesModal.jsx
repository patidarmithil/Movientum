import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { searchService } from '../../services/searchService'
import { tierListService } from '../../services/tierListService'
import { itemKey } from '../../utils/tierPresets'
import { fileToTileImage, newUploadRef, putUpload, uploadUrl as uploadPreview } from '../../utils/tierUploads'
import './AddTitlesModal.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const DEBOUNCE_MS = 300
const TOP_N = 20

const SOURCE_LABEL = {
  anilist: 'characters from AniList',
  fandom: 'characters from the show’s wiki',
  tmdb: 'cast from TMDB',
}

/**
 * Drop any title from the catalogue onto a board — or that title's characters.
 *
 * One search box serves both tabs, because it is the same catalogue either way. On the
 * Titles tab a result is the tile; on the Characters tab a result is a show to open,
 * and the backend decides where its characters come from (AniList for anime, the show's
 * Fandom wiki for other animation, TMDB's cast for live action).
 *
 * What a character fetch returns lives in this component while the modal is open and
 * nowhere else — the server only caches a show once somebody saves a board from it.
 */
export default function AddTitlesModal({ onClose, onAdd, existing }) {
  const [tab, setTab] = useState('titles')

  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState([])
  const [uploadError, setUploadError] = useState('')

  // ── Characters tab ──────────────────────────────────────────
  const [show, setShow] = useState(null)            // { media, id, name }
  const [chars, setChars] = useState([])
  const [source, setSource] = useState('')
  const [charsTitle, setCharsTitle] = useState('')
  const [charsBusy, setCharsBusy] = useState(false)
  const [charsError, setCharsError] = useState('')

  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const timerRef = useRef(null)
  const abortRef = useRef(null)
  const cacheRef = useRef(new Map())

  const charsCacheRef = useRef(new Map())           // "tv:95557" → { source, title, items }
  const charSourceRef = useRef(new Map())           // item key → "tv:95557"

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    const q = query.trim()
    clearTimeout(timerRef.current)

    // Drop whatever is still in flight the moment the query changes, the way the
    // watchlist modal does — a slow response for "int" must not land on top of
    // the results for "interstellar".
    abortRef.current?.abort()

    if (q.length < 2) {
      setResults([])
      setBusy(false)
      setFailed(false)
      return
    }

    if (cacheRef.current.has(q)) {
      setResults(cacheRef.current.get(q))
      setBusy(false)
      setFailed(false)
      return
    }

    setBusy(true)
    setFailed(false)
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const data = await searchService.instantSearch(q, 'content', controller.signal)
        const rows = (Array.isArray(data) ? data : [])
          .filter((r) => r.media_type !== 'person' && r.poster_path)
          .slice(0, 20)
        cacheRef.current.set(q, rows)
        setResults(rows)
      } catch (err) {
        if (err?.name === 'CanceledError' || err?.name === 'AbortError') return
        setResults([])
        setFailed(true)
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }, DEBOUNCE_MS)

    return () => clearTimeout(timerRef.current)
  }, [query])

  const openShow = async (row) => {
    const media = row.media_type === 'tv' ? 'tv' : 'movie'
    const name = row.title || row.name
    const sourceKey = `${media}:${row.id}`

    setShow({ media, id: row.id, name })
    setCharsError('')

    const hit = charsCacheRef.current.get(sourceKey)
    if (hit) {
      setChars(hit.items)
      setSource(hit.source)
      setCharsTitle(hit.title)
      return
    }

    setChars([])
    setSource('')
    setCharsTitle('')
    setCharsBusy(true)
    try {
      const data = await tierListService.getShowCharacters(media, row.id)
      const items = (data?.items || []).map((c) => ({
        id: c.id,
        media: c.media,
        name: c.name,
        image: c.image,
        year: null,
      }))
      const entry = { source: data?.source || '', title: data?.title || name, items }
      charsCacheRef.current.set(sourceKey, entry)
      setChars(items)
      setSource(entry.source)
      setCharsTitle(entry.title)
      if (!items.length) setCharsError('No character art found for that one.')
    } catch (err) {
      setChars([])
      setCharsError(
        err?.response?.status === 503
          ? 'The character source is busy — try again in a moment.'
          : 'Could not load characters. Try again in a moment.'
      )
    } finally {
      setCharsBusy(false)
    }
  }

  const toggle = (row) => {
    const item = {
      id: row.id,
      media: row.media_type === 'tv' ? 'tv' : 'movie',
      name: row.title || row.name,
      image: row.poster_path,
      year: row.release_year ? Number(row.release_year) : null,
    }
    const key = itemKey(item)
    setPicked((prev) =>
      prev.some((p) => itemKey(p) === key)
        ? prev.filter((p) => itemKey(p) !== key)
        : [...prev, item]
    )
  }

  const rememberSource = (key) => {
    if (show) charSourceRef.current.set(key, `${show.media}:${show.id}`)
  }

  const toggleChar = (item) => {
    const key = itemKey(item)
    rememberSource(key)
    setPicked((prev) =>
      prev.some((p) => itemKey(p) === key)
        ? prev.filter((p) => itemKey(p) !== key)
        : [...prev, item]
    )
  }

  /**
   * Bulk picks — a 40-tile character board is not worth 40 clicks.
   * Anything already on the board stays out of the selection.
   */
  const pickMany = (n) => {
    const room = chars.filter((c) => !existing[itemKey(c)]).slice(0, n)
    setPicked((prev) => {
      const have = new Set(prev.map(itemKey))
      const add = room.filter((c) => !have.has(itemKey(c)))
      for (const c of add) rememberSource(itemKey(c))
      return [...prev, ...add]
    })
  }

  const clearChars = () => {
    const keys = new Set(chars.map(itemKey))
    setPicked((prev) => prev.filter((p) => !keys.has(itemKey(p))))
  }

  const backToShows = () => {
    setShow(null)
    setChars([])
    setSource('')
    setCharsTitle('')
    setCharsError('')
  }

  /**
   * Bring pictures in from the device.
   *
   * Same shape as the avatar upload — a hidden file input behind a button, an image
   * type check and a 5MB cap per file — except several files are accepted at once,
   * because a board is built out of a set, not one picture. Each one is downscaled
   * and stored in IndexedDB; the board itself only carries the short `upload:` key.
   */
  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return

    setUploadError('')
    const added = []
    const problems = []

    for (const file of files) {
      try {
        const dataUrl = await fileToTileImage(file)
        const ref = newUploadRef()
        await putUpload(ref, dataUrl)
        added.push({
          id: `${Date.now()}${added.length}`,
          media: 'upload',
          name: file.name.replace(/\.[^.]+$/, '').slice(0, 200),
          image: ref,
          year: null,
        })
      } catch (err) {
        problems.push(err?.message || `Could not read ${file.name}`)
      }
    }

    if (added.length) setPicked((prev) => [...prev, ...added])
    if (problems.length) setUploadError(problems.join('. '))
  }

  const commit = () => {
    if (picked.length) {
      // The shows behind the picked characters travel with the items: the board sends
      // them on save so the backend can cache those character lists for everyone else.
      const characterSources = [...new Set(
        picked.map((p) => charSourceRef.current.get(itemKey(p))).filter(Boolean)
      )]
      onAdd(picked, { characterSources })
    }
    onClose()
  }

  const pickedKeys = new Set(picked.map(itemKey))
  const showSearch = tab === 'titles' || !show

  return createPortal(
    <div className="atm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add titles">
      <div className="atm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="atm-head">
          <h2>Add titles</h2>
          <button type="button" className="atm-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="atm-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'titles'}
            className={'atm-tab' + (tab === 'titles' ? ' is-on' : '')}
            onClick={() => { setTab('titles'); backToShows() }}
          >
            Titles
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'characters'}
            className={'atm-tab' + (tab === 'characters' ? ' is-on' : '')}
            onClick={() => setTab('characters')}
          >
            Characters
          </button>
        </div>

        {showSearch && (
          <div className="atm-tools">
            <input
              ref={inputRef}
              className="atm-input"
              type="search"
              value={query}
              placeholder={tab === 'titles' ? 'Search any movie or show' : 'Search a show — Invincible, The Boys, Code Geass…'}
              aria-label={tab === 'titles' ? 'Search for a title' : 'Search for a show'}
              onChange={(e) => setQuery(e.target.value)}
            />
            {tab === 'titles' && (
              <>
                <button type="button" className="tier-btn tier-btn--quiet atm-upload" onClick={() => fileRef.current?.click()}>
                  Upload images
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={handleFiles}
                />
              </>
            )}
          </div>
        )}

        {uploadError && <p className="atm-upload-error">{uploadError}</p>}

        {showSearch && (
          <div className="atm-results">
            {query.trim().length < 2 && (
              <p className="atm-empty">
                {tab === 'titles'
                  ? 'Type a couple of letters to find anything in the catalogue.'
                  : 'Search a show, then pick the characters you want to rank.'}
              </p>
            )}
            {query.trim().length >= 2 && busy && <p className="atm-empty">Searching…</p>}
            {query.trim().length >= 2 && !busy && failed && (
              <p className="atm-empty">Search failed. Try again in a moment.</p>
            )}
            {query.trim().length >= 2 && !busy && !failed && results.length === 0 && (
              <p className="atm-empty">Nothing matched that. Try a shorter search.</p>
            )}

            {results.length > 0 && (
              <div className="atm-grid">
                {results.map((row) => {
                  const media = row.media_type === 'tv' ? 'tv' : 'movie'
                  const key = `${media}:${row.id}`
                  const already = tab === 'titles' && Boolean(existing[key])
                  const isPicked = tab === 'titles' && pickedKeys.has(key)
                  return (
                    <button
                      key={key}
                      type="button"
                      className={'atm-card' + (isPicked ? ' is-picked' : '')}
                      onClick={() => (tab === 'characters' ? openShow(row) : !already && toggle(row))}
                      disabled={already}
                      aria-pressed={isPicked}
                      title={row.title || row.name}
                    >
                      <span className="atm-card__art">
                        <img src={`${TMDB_IMAGE_BASE}/w342${row.poster_path}`} alt="" loading="lazy" />
                        {/* The state badge sits on the poster, so the card is the
                            artwork at a usable size rather than a thumbnail
                            alongside a line of text. */}
                        <span className="atm-card__state">
                          {tab === 'characters'
                            ? 'Characters →'
                            : already ? 'On the board' : isPicked ? 'Added' : '+'}
                        </span>
                      </span>
                      <span className="atm-card__title">{row.title || row.name}</span>
                      <span className="atm-card__meta">
                        {[row.release_year, media === 'tv' ? 'TV' : 'Movie'].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'characters' && show && (
          <>
            <div className="atm-charbar">
              <button type="button" className="tier-btn tier-btn--quiet" onClick={backToShows}>
                ← Shows
              </button>
              {/* The matched title and source are shown because a wiki or AniList match
                  can land on the wrong thing; seeing it here beats finding out after
                  30 tiles are on the board. */}
              <span className="atm-charbar__title">
                {charsTitle || show.name}
                {source && <em className="atm-charbar__source"> · {SOURCE_LABEL[source] || source}</em>}
              </span>
              <span className="atm-charbar__actions">
                <button type="button" className="tier-btn tier-btn--quiet" onClick={() => pickMany(TOP_N)} disabled={!chars.length}>
                  Top {TOP_N}
                </button>
                <button type="button" className="tier-btn tier-btn--quiet" onClick={() => pickMany(chars.length)} disabled={!chars.length}>
                  Select all
                </button>
                <button type="button" className="tier-btn tier-btn--quiet" onClick={clearChars} disabled={!chars.length}>
                  Clear
                </button>
              </span>
            </div>

            <div className="atm-results">
              {charsBusy && <p className="atm-empty">Loading characters…</p>}
              {!charsBusy && charsError && <p className="atm-empty">{charsError}</p>}

              {!charsBusy && chars.length > 0 && (
                <div className="atm-grid">
                  {chars.map((c) => {
                    const key = itemKey(c)
                    const already = Boolean(existing[key])
                    const isPicked = pickedKeys.has(key)
                    // AniList and wiki art are absolute URLs; a TMDB headshot is a path.
                    const src = c.image.startsWith('http') ? c.image : `${TMDB_IMAGE_BASE}/w342${c.image}`
                    return (
                      <button
                        key={key}
                        type="button"
                        className={'atm-card' + (isPicked ? ' is-picked' : '')}
                        onClick={() => !already && toggleChar(c)}
                        disabled={already}
                        aria-pressed={isPicked}
                        title={c.name}
                      >
                        <span className="atm-card__art">
                          <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" />
                          <span className="atm-card__state">
                            {already ? 'On the board' : isPicked ? 'Added' : '+'}
                          </span>
                        </span>
                        <span className="atm-card__title">{c.name}</span>
                        <span className="atm-card__meta">{c.media === 'person' ? 'Cast' : 'Character'}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {picked.some((p) => p.media === 'upload') && (
          <div className="atm-uploads">
            {picked.filter((p) => p.media === 'upload').map((p) => (
              <span key={itemKey(p)} className="atm-uploads__item" title={p.name}>
                <img src={uploadPreview(p.image)} alt="" />
                <button
                  type="button"
                  onClick={() => setPicked((prev) => prev.filter((x) => itemKey(x) !== itemKey(p)))}
                  aria-label={`Remove ${p.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <footer className="atm-foot">
          <span className="atm-count">
            {picked.length === 0 ? 'Nothing picked yet' : `${picked.length} to add`}
          </span>
          <button type="button" className="tier-btn tier-btn--primary" onClick={commit} disabled={!picked.length}>
            Add to the bin
          </button>
        </footer>
      </div>
    </div>,
    document.body
  )
}
