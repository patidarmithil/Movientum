import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { searchService } from '../../services/searchService'
import { itemKey } from '../../utils/tierPresets'
import { fileToTileImage, newUploadRef, putUpload, uploadUrl as uploadPreview } from '../../utils/tierUploads'
import './AddTitlesModal.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'
const DEBOUNCE_MS = 300

/**
 * Drop any title from the catalogue onto a board.
 *
 * This is what a template cannot cover — the film you want to rank that nobody made
 * a list for. It runs on the same trigram instant-search the header uses, so a typo
 * still finds the film.
 */
export default function AddTitlesModal({ onClose, onAdd, existing }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState([])
  const [uploadError, setUploadError] = useState('')

  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const timerRef = useRef(null)
  const abortRef = useRef(null)
  const cacheRef = useRef(new Map())

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
    if (picked.length) onAdd(picked)
    onClose()
  }

  return createPortal(
    <div className="atm-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add titles">
      <div className="atm-panel" onClick={(e) => e.stopPropagation()}>
        <header className="atm-head">
          <h2>Add titles</h2>
          <button type="button" className="atm-close" onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className="atm-tools">
          <input
            ref={inputRef}
            className="atm-input"
            type="search"
            value={query}
            placeholder="Search any movie or show"
            aria-label="Search for a title"
            onChange={(e) => setQuery(e.target.value)}
          />
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
        </div>

        {uploadError && <p className="atm-upload-error">{uploadError}</p>}

        <div className="atm-results">
          {query.trim().length < 2 && (
            <p className="atm-empty">Type a couple of letters to find anything in the catalogue.</p>
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
                const already = Boolean(existing[key])
                const isPicked = picked.some((p) => itemKey(p) === key)
                return (
                  <button
                    key={key}
                    type="button"
                    className={'atm-card' + (isPicked ? ' is-picked' : '')}
                    onClick={() => !already && toggle(row)}
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
                        {already ? 'On the board' : isPicked ? 'Added' : '+'}
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
