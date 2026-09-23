/**
 * ExploreMenu — the facet picker behind the navbar's Explore button.
 *
 * Desktop: a popover anchored under the button. Mobile (≤900px): a bottom sheet.
 * Both are portalled to <body> so the navbar's own overflow never clips them.
 * Arrow keys move between tiles, Esc closes and hands focus back to the button.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { LuLayoutGrid, LuX } from 'react-icons/lu'
import { FACETS } from '../../utils/exploreTaxonomy'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import './ExploreMenu.css'

const TILES = [
  ...FACETS,
  { id: 'all', label: 'Browse All', Icon: LuLayoutGrid, to: '/explore' },
]
const COLS = 3
const POPOVER_W = 540

export default function ExploreMenu({ open, onClose, anchorRef }) {
  const narrow = useMediaQuery('(max-width: 900px)')
  const panelRef = useRef(null)
  const tileRefs = useRef([])
  const [pos, setPos] = useState(null)

  // Anchor the popover under the button, kept inside the viewport.
  useLayoutEffect(() => {
    if (!open || narrow) return
    const place = () => {
      const r = anchorRef?.current?.getBoundingClientRect()
      if (!r) return
      const vw = window.innerWidth
      const left = Math.min(Math.max(12, r.left + r.width / 2 - POPOVER_W / 2), vw - POPOVER_W - 12)
      setPos({ top: r.bottom + 10, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, narrow, anchorRef])

  useEffect(() => {
    if (!open) return
    tileRefs.current[0]?.focus({ preventScroll: true })

    const onKey = (e) => {
      if (e.key === 'Escape') {
        onClose()
        anchorRef?.current?.focus?.()
      }
    }
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)

    let prevOverflow
    if (narrow) {
      prevOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      if (narrow) document.body.style.overflow = prevOverflow
    }
  }, [open, narrow, onClose, anchorRef])

  if (!open) return null

  const onGridKey = (e) => {
    const i = tileRefs.current.indexOf(document.activeElement)
    if (i < 0) return
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: COLS, ArrowUp: -COLS }[e.key]
    if (!step) return
    e.preventDefault()
    const next = Math.min(TILES.length - 1, Math.max(0, i + step))
    tileRefs.current[next]?.focus()
  }

  const grid = (
    <div className="xmenu__grid" role="menu" aria-label="Explore by" onKeyDown={onGridKey}>
      {TILES.map(({ id, label, Icon, to }, i) => (
        <Link
          key={id}
          to={to}
          role="menuitem"
          ref={(el) => { tileRefs.current[i] = el }}
          className={`xmenu__tile${id === 'all' ? ' xmenu__tile--all' : ''}`}
          onClick={onClose}
        >
          <span className="xmenu__icon" aria-hidden><Icon /></span>
          <span className="xmenu__label">{label}</span>
        </Link>
      ))}
    </div>
  )

  if (narrow) {
    return createPortal(
      <div className="xmenu-sheet" role="dialog" aria-modal="true" aria-labelledby="xmenu-title">
        <div className="xmenu-sheet__scrim" />
        <div className="xmenu-sheet__panel" ref={panelRef}>
          <span className="xmenu-sheet__grab" aria-hidden />
          <header className="xmenu-sheet__head">
            <h2 id="xmenu-title">Explore</h2>
            <button type="button" className="xmenu-sheet__close" onClick={onClose} aria-label="Close">
              <LuX />
            </button>
          </header>
          {grid}
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      className="xmenu"
      ref={panelRef}
      style={pos ? { top: pos.top, left: pos.left, width: POPOVER_W } : { visibility: 'hidden' }}
    >
      {grid}
    </div>,
    document.body,
  )
}
