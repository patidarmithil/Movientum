import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { useAuth } from '../context/AuthContext'
import { tierListService } from '../services/tierListService'
import useTierDrag from '../hooks/useTierDrag'
import { PRESETS, itemKey, makeRowId, rowsFromPreset } from '../utils/tierPresets'
import { downloadBoard } from '../utils/tierExport'
import TierRow from '../components/tierlist/TierRow'
import TierBin from '../components/tierlist/TierBin'
import { fullImageUrl, tileImageUrl } from '../utils/tierImages'
import { hydrateUploads, isUploadRef } from '../utils/tierUploads'
import ImageLightbox from '../components/ImageLightbox'
import AddTitlesModal from '../components/tierlist/AddTitlesModal'
import './TierBoard.css'

const DRAFT_PREFIX = 'mv_tier_draft_'

/** Drafts are keyed per board so switching templates does not clobber the last one. */
function draftKey(mode, id) {
  return `${DRAFT_PREFIX}${mode}_${id || 'new'}`
}

function readDraft(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeDraft(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* quota or private mode — a draft is a convenience, not a requirement */
  }
}

function clearDraft(key) {
  try { localStorage.removeItem(key) } catch { /* no-op */ }
}

export default function TierBoard({ mode = 'template' }) {
  const { slug, id, shareId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const readOnly = mode === 'share'
  const routeId = slug || id || shareId || 'new'
  const storageKey = draftKey(mode, routeId)

  const [title, setTitle] = useState('Untitled tier list')
  const [tile, setTile] = useState('poster')
  const [rows, setRows] = useState(() => rowsFromPreset('classic'))
  const [binKeys, setBinKeys] = useState([])
  const [meta, setMeta] = useState({})
  const [templateSlug, setTemplateSlug] = useState(null)
  const [savedId, setSavedId] = useState(mode === 'saved' ? id : null)
  const [savedShareId, setSavedShareId] = useState(mode === 'share' ? shareId : null)
  const [owner, setOwner] = useState(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [zoomed, setZoomed] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [heldKey, setHeldKey] = useState(null)
  const [announcement, setAnnouncement] = useState('')

  const hydrated = useRef(false)

  // ── Load ──────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false
    hydrated.current = false
    setLoading(true)
    setError('')

    const applyDraftOrDefault = (base) => {
      const draft = readOnly ? null : readDraft(storageKey)
      // Only a draft somebody actually ranked into is worth restoring. Otherwise a
      // board they opened once and abandoned would keep serving that day's template
      // contents forever, and every visit would announce a resume that never happened.
      const ranked = draft?.rows?.reduce((n, r) => n + (r.items?.length || 0), 0) || 0

      if (draft && draft.rows?.length && ranked > 0) {
        const meta = { ...base.meta, ...(draft.meta || {}) }
        const placed = new Set(draft.rows.flatMap((r) => r.items || []))
        // Titles the template has gained since the draft was written belong in the
        // bin; anything it has lost stays, because the person already ranked it.
        const bin = [
          ...(draft.binKeys || []).filter((k) => meta[k]),
          ...base.binKeys.filter((k) => !placed.has(k) && !(draft.binKeys || []).includes(k)),
        ]
        setTitle(draft.title ?? base.title)
        setTile(draft.tile ?? base.tile)
        setRows(draft.rows)
        setBinKeys(bin)
        setMeta(meta)
        setNotice('Picked up where you left off.')
        return
      }

      setTitle(base.title)
      setTile(base.tile)
      setRows(base.rows)
      setBinKeys(base.binKeys)
      setMeta(base.meta)
    }

    const run = async () => {
      try {
        if (mode === 'blank') {
          applyDraftOrDefault({
            title: 'Untitled tier list',
            tile: 'poster',
            rows: rowsFromPreset('classic'),
            binKeys: [],
            meta: {},
          })
          setTemplateSlug(null)
        } else if (mode === 'template') {
          const data = await tierListService.getTemplate(slug)
          if (cancelled) return
          const nextMeta = {}
          const keys = []
          for (const it of data.items || []) {
            const k = itemKey(it)
            nextMeta[k] = it
            keys.push(k)
          }
          setTemplateSlug(data.slug)
          applyDraftOrDefault({
            title: data.title,
            tile: data.tile || 'poster',
            rows: rowsFromPreset('classic'),
            binKeys: keys,
            meta: nextMeta,
          })
        } else {
          const data = mode === 'share'
            ? await tierListService.getShared(shareId)
            : await tierListService.get(id)
          if (cancelled) return
          setTitle(data.title)
          setTile(data.tile || 'poster')
          setRows(data.rows || [])
          setBinKeys(data.bin_items || [])
          setMeta(data.item_meta || {})
          setTemplateSlug(data.template_slug || null)
          setSavedId(data.id)
          setSavedShareId(data.share_id)
          setOwner(data.owner || null)
        }
      } catch (err) {
        if (cancelled) return
        const status = err?.response?.status
        if (status === 401) setError('Sign in to open this template — it is built from your own library.')
        else if (status === 404) setError('That tier list is not here. It may have been deleted.')
        else setError('Could not load this board. Check your connection and try again.')
      } finally {
        if (!cancelled) {
          setLoading(false)
          hydrated.current = true
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [mode, slug, id, shareId, storageKey, readOnly])

  // ── Draft autosave ────────────────────────────────────────────

  useEffect(() => {
    if (readOnly || !hydrated.current || loading) return
    const t = setTimeout(() => {
      writeDraft(storageKey, { title, tile, rows, binKeys, meta })
    }, 400)
    return () => clearTimeout(t)
  }, [title, tile, rows, binKeys, meta, storageKey, readOnly, loading])

  // ── Derived ───────────────────────────────────────────────────

  const entriesFor = useCallback(
    (keys) => keys.filter((k) => meta[k]).map((k) => ({ key: k, item: meta[k] })),
    [meta]
  )

  const binEntries = useMemo(() => entriesFor(binKeys), [entriesFor, binKeys])
  const rankedCount = useMemo(
    () => rows.reduce((n, r) => n + r.items.length, 0),
    [rows]
  )
  const totalCount = rankedCount + binKeys.length

  // ── Moving items ──────────────────────────────────────────────

  const moveItem = useCallback((key, fromZone, toZone, index) => {
    if (fromZone === toZone) {
      // Reorder inside one zone. The index was measured with the dragged tile
      // filtered out, so it already refers to the post-removal list.
      if (toZone === 'bin') {
        setBinKeys((prev) => {
          const without = prev.filter((k) => k !== key)
          const at = Math.min(index, without.length)
          return [...without.slice(0, at), key, ...without.slice(at)]
        })
      } else {
        setRows((prev) => prev.map((r) => {
          if (r.id !== toZone) return r
          const without = r.items.filter((k) => k !== key)
          const at = Math.min(index, without.length)
          return { ...r, items: [...without.slice(0, at), key, ...without.slice(at)] }
        }))
      }
      return
    }

    setBinKeys((prev) => {
      let next = prev.filter((k) => k !== key)
      if (toZone === 'bin') {
        const at = Math.min(index, next.length)
        next = [...next.slice(0, at), key, ...next.slice(at)]
      }
      return next
    })
    setRows((prev) => prev.map((r) => {
      if (r.id === fromZone) return { ...r, items: r.items.filter((k) => k !== key) }
      if (r.id === toZone) {
        const without = r.items.filter((k) => k !== key)
        const at = Math.min(index, without.length)
        return { ...r, items: [...without.slice(0, at), key, ...without.slice(at)] }
      }
      return r
    }))
  }, [])

  const { drag, startDrag, draggingKey, justDragged } = useTierDrag({ onMove: moveItem, disabled: readOnly })

  // Tap a tile and you get the artwork full size. The click the browser fires at
  // the end of a real drag has to be ignored, or every drop would open the poster.
  const openZoom = useCallback((item) => {
    if (justDragged()) return
    if (item?.image) setZoomed(item)
  }, [justDragged])

  /**
   * Locally uploaded tiles live in IndexedDB, so their pictures arrive a tick after
   * the board does. Cloning the affected meta entries afterwards is what makes the
   * memoised tiles re-render — nothing about the item changes except its identity.
   */
  useEffect(() => {
    const refs = Object.values(meta).map((m) => m?.image).filter(isUploadRef)
    if (!refs.length) return
    let cancelled = false
    hydrateUploads(refs).then(() => {
      if (cancelled) return
      setMeta((prev) => {
        const next = { ...prev }
        for (const [k, m] of Object.entries(prev)) {
          if (isUploadRef(m?.image)) next[k] = { ...m }
        }
        return next
      })
    })
    return () => { cancelled = true }
    // Runs once per board: the clone keeps `image` identical, so it cannot loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // ── Keyboard path ─────────────────────────────────────────────

  const zoneOrder = useMemo(() => [...rows.map((r) => r.id), 'bin'], [rows])

  const zoneLabel = useCallback((zoneId) => {
    if (zoneId === 'bin') return 'the bin'
    const row = rows.find((r) => r.id === zoneId)
    return row ? `tier ${row.label}` : zoneId
  }, [rows])

  const keysIn = useCallback((zoneId) => {
    if (zoneId === 'bin') return binKeys
    return rows.find((r) => r.id === zoneId)?.items || []
  }, [rows, binKeys])

  const onTileKeyDown = useCallback((e, key, zoneId) => {
    if (readOnly) return

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (heldKey === key) {
        setHeldKey(null)
        setAnnouncement(`${meta[key]?.name} placed in ${zoneLabel(zoneId)}.`)
      } else {
        setHeldKey(key)
        setAnnouncement(`${meta[key]?.name} picked up. Use the arrow keys to move it, then press Enter.`)
      }
      return
    }

    if (e.key === 'Escape' && heldKey) {
      e.preventDefault()
      setHeldKey(null)
      setAnnouncement('Cancelled.')
      return
    }

    if (heldKey !== key) return
    const zi = zoneOrder.indexOf(zoneId)
    const items = keysIn(zoneId)
    const pos = items.indexOf(key)

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const target = zoneOrder[zi + (e.key === 'ArrowDown' ? 1 : -1)]
      if (!target) return
      moveItem(key, zoneId, target, keysIn(target).length)
      setAnnouncement(`Moved to ${zoneLabel(target)}.`)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const next = pos + (e.key === 'ArrowRight' ? 1 : -1)
      if (next < 0 || next >= items.length) return
      moveItem(key, zoneId, zoneId, next)
      setAnnouncement(`Position ${next + 1} of ${items.length}.`)
    }
  }, [readOnly, heldKey, zoneOrder, keysIn, moveItem, meta, zoneLabel])

  // Keep focus on the held tile as it moves between rows.
  useEffect(() => {
    if (!heldKey) return
    const el = document.querySelector(`[data-tier-item="${CSS.escape(heldKey)}"]`)
    el?.focus({ preventScroll: false })
  }, [heldKey, rows, binKeys])

  // ── Row editing ───────────────────────────────────────────────

  const updateRow = useCallback((rowId, patch) => {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...patch } : r)))
  }, [])

  const insertRow = useCallback((at) => {
    setRows((prev) => {
      if (prev.length >= 12) return prev
      const next = [...prev]
      next.splice(at, 0, { id: makeRowId(), label: 'New', color: '#7A6FA8', items: [] })
      return next
    })
  }, [])

  const clearRow = useCallback((rowId) => {
    const row = rows.find((r) => r.id === rowId)
    if (!row?.items.length) return
    setBinKeys((b) => [...b, ...row.items])
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, items: [] } : r)))
  }, [rows])

  const removeRow = useCallback((rowId) => {
    if (rows.length <= 1) return
    const row = rows.find((r) => r.id === rowId)
    if (row?.items.length) setBinKeys((b) => [...b, ...row.items])
    setRows((prev) => prev.filter((r) => r.id !== rowId))
  }, [rows])

  const moveRow = useCallback((from, to) => {
    setRows((prev) => {
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      const [row] = next.splice(from, 1)
      next.splice(to, 0, row)
      return next
    })
  }, [])

  const applyPreset = useCallback((presetId) => {
    const stranded = rows.flatMap((r) => r.items)
    if (stranded.length) setBinKeys((b) => [...b, ...stranded])
    setRows(rowsFromPreset(presetId))
    setAnnouncement('Rows replaced. Every title went back to the bin.')
  }, [rows])

  const sendAllBack = useCallback(() => {
    const stranded = rows.flatMap((r) => r.items)
    if (!stranded.length) return
    setBinKeys((b) => [...b, ...stranded])
    setRows((prev) => prev.map((r) => ({ ...r, items: [] })))
  }, [rows])

  const addItems = useCallback((items) => {
    const nextMeta = { ...meta }
    const fresh = []
    for (const it of items) {
      const k = itemKey(it)
      if (!nextMeta[k]) fresh.push(k)
      nextMeta[k] = it
    }
    setMeta(nextMeta)
    if (fresh.length) setBinKeys((b) => [...b, ...fresh])
  }, [meta])

  // ── Save / share / export ─────────────────────────────────────

  const buildPayload = useCallback(() => {
    const used = new Set([...rows.flatMap((r) => r.items), ...binKeys])
    const trimmedMeta = {}
    for (const k of used) {
      const m = meta[k]
      if (m) trimmedMeta[k] = { name: m.name, image: m.image, year: m.year ?? null }
    }
    return {
      title: title.trim().slice(0, 120) || 'Untitled tier list',
      template_slug: templateSlug,
      tile,
      rows: rows.map((r) => ({ id: r.id, label: r.label, color: r.color, items: r.items })),
      bin_items: binKeys,
      item_meta: trimmedMeta,
      is_public: true,
    }
  }, [rows, binKeys, meta, title, templateSlug, tile])

  const handleSave = useCallback(async () => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    setSaving(true)
    setNotice('')
    try {
      const payload = buildPayload()
      const saved = savedId
        ? await tierListService.update(savedId, payload)
        : await tierListService.create(payload)
      setSavedId(saved.id)
      setSavedShareId(saved.share_id)
      clearDraft(storageKey)
      setNotice('Saved.')
      if (mode !== 'saved') navigate(`/tierlist/my/${saved.id}`, { replace: true })
    } catch (err) {
      setNotice(err?.response?.data?.detail || 'Could not save. Try again in a moment.')
    } finally {
      setSaving(false)
    }
  }, [user, navigate, buildPayload, savedId, storageKey, mode])

  const handleShare = useCallback(async () => {
    if (!savedShareId) {
      setNotice('Save the board first, then you can share it.')
      return
    }
    const url = `${window.location.origin}/tierlist/s/${savedShareId}`
    try {
      if (navigator.share) await navigator.share({ title, url })
      else {
        await navigator.clipboard.writeText(url)
        setNotice('Link copied.')
      }
    } catch {
      setNotice(url)
    }
  }, [savedShareId, title])

  /**
   * Deleting is only offered on a board that is already saved, and it asks first:
   * the board is the only copy, and the draft in localStorage goes with it.
   */
  const handleDelete = useCallback(async () => {
    if (!savedId) return
    if (!window.confirm('Delete this tier list? This cannot be undone.')) return
    setDeleting(true)
    try {
      await tierListService.remove(savedId)
      clearDraft(storageKey)
      navigate('/tierlist', { replace: true })
    } catch {
      setNotice('Could not delete the board. Try again in a moment.')
      setDeleting(false)
    }
  }, [savedId, storageKey, navigate])

  const handleDownload = useCallback(async () => {
    setNotice('Rendering the image…')
    try {
      await downloadBoard({
        title,
        tile,
        rows: rows.map((r) => ({
          label: r.label,
          color: r.color,
          items: r.items.map((k) => meta[k]).filter(Boolean),
        })),
      })
      setNotice('Image downloaded.')
    } catch {
      setNotice('Could not render the image. Try again once the posters have loaded.')
    }
  }, [title, tile, rows, meta])

  // ── Render ────────────────────────────────────────────────────

  const dragItem = drag ? meta[drag.itemKey] : null

  if (loading) {
    return (
      <main className="tierboard-page page-content">
        <div className="tierboard-page__inner">
          <div className="tierboard-skeleton" aria-label="Loading board">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="tierboard-skeleton__row skeleton" />
            ))}
          </div>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="tierboard-page page-content">
        <div className="tierboard-page__inner">
          <div className="error-state">{error}</div>
          <p className="tierboard-error-actions">
            <Link className="tier-btn" to="/tierlist">Back to templates</Link>
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="tierboard-page page-content">
      <div className="tierboard-page__inner">
        <header className="tierboard-head">
          <div className="tierboard-head__title">
            {readOnly ? (
              <h1>{title}</h1>
            ) : (
              <input
                className="tierboard-head__input"
                value={title}
                maxLength={120}
                aria-label="Tier list name"
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
            <p className="tierboard-head__meta">
              {readOnly && owner ? `Ranked by ${owner}. ` : ''}
              {rankedCount} of {totalCount} ranked
            </p>
          </div>

          <div className="tierboard-head__actions">
            {!readOnly && (
              <label className="tierboard-preset">
                <span>Rows</span>
                <select
                  value=""
                  aria-label="Replace the rows with a preset"
                  onChange={(e) => { if (e.target.value) applyPreset(e.target.value) }}
                >
                  <option value="">Change…</option>
                  {PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            )}
            <button type="button" className="tier-btn tier-btn--quiet" onClick={handleDownload}>
              Download image
            </button>
            {!readOnly && (
              <>
                <button type="button" className="tier-btn tier-btn--quiet" onClick={handleShare}>
                  Share
                </button>
                <button type="button" className="tier-btn tier-btn--primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : savedId ? 'Save changes' : 'Save'}
                </button>
                {savedId && (
                  <button
                    type="button"
                    className="tier-btn tier-btn--danger"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? 'Deleting…' : 'Delete'}
                  </button>
                )}
              </>
            )}
            {readOnly && (
              <Link className="tier-btn tier-btn--primary" to="/tierlist">Make your own</Link>
            )}
          </div>
        </header>

        {notice && <p className="tierboard-notice" role="status">{notice}</p>}

        {/* Board left, bin right: the two things a drag connects should never be a
            page-scroll apart. The bin keeps its own scrollbar; below 1024px the
            two collapse back into a stack. */}
        <div className="tierboard-layout">
          <div className="tier-board">
            {rows.map((row, i) => (
              <TierRow
                key={row.id}
                row={row}
                index={i}
                rowCount={rows.length}
                items={entriesFor(row.items)}
                tile={tile}
                readOnly={readOnly}
                isOver={drag?.overZone === row.id}
                dropIndex={drag?.overIndex ?? 0}
                draggingKey={draggingKey}
                heldKey={heldKey}
                onPointerDown={startDrag}
                onTileKeyDown={onTileKeyDown}
                onChange={(patch) => updateRow(row.id, patch)}
                onInsert={insertRow}
                onClear={() => clearRow(row.id)}
                onRemove={() => removeRow(row.id)}
                onMoveRow={moveRow}
                onZoom={openZoom}
              />
            ))}
          </div>

          <TierBin
            items={binEntries}
            tile={tile}
            readOnly={readOnly}
            isOver={drag?.overZone === 'bin'}
            dropIndex={drag?.overIndex ?? 0}
            draggingKey={draggingKey}
            heldKey={heldKey}
            rankedCount={rankedCount}
            onPointerDown={startDrag}
            onTileKeyDown={onTileKeyDown}
            onAddTitles={() => setAddOpen(true)}
            onShuffleBack={sendAllBack}
            onZoom={openZoom}
          />
        </div>

        <p className="tierboard-hint">
          Drag a title into a row to rank it. On a keyboard, focus a tile and press Enter
          to pick it up, then use the arrow keys.
        </p>
      </div>

      <div className="tier-live" role="status" aria-live="polite">{announcement}</div>

      {drag && dragItem && (
        <div
          className="tier-ghost"
          style={{
            transform: `translate3d(${drag.x}px, ${drag.y}px, 0)`,
            width: drag.width,
            height: drag.height,
          }}
          aria-hidden="true"
        >
          <img src={tileImageUrl(dragItem.image, tile)} alt="" draggable="false" />
        </div>
      )}

      {zoomed && (
        <ImageLightbox
          src={fullImageUrl(zoomed.image)}
          alt={zoomed.name}
          caption={[zoomed.name, zoomed.year].filter(Boolean).join(' · ')}
          onClose={() => setZoomed(null)}
        />
      )}

      {addOpen && (
        <AddTitlesModal
          onClose={() => setAddOpen(false)}
          onAdd={addItems}
          existing={meta}
        />
      )}
    </main>
  )
}
