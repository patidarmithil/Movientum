import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Pointer-event drag engine for the tier board.
 *
 * Built by hand rather than with a drag-and-drop library for two reasons: the project
 * has no DnD dependency and does not need a new one, and the HTML5 drag-and-drop API
 * does not fire on touch screens at all. Pointer events give mouse, touch and pen a
 * single code path, so a phone behaves exactly like a desktop.
 *
 * A "zone" is any element carrying data-tier-zone="<zoneId>". Tiles inside it must
 * carry data-tier-item="<itemKey>" so the drop index can be worked out from geometry.
 *
 * The consumer supplies onMove(itemKey, fromZone, toZone, index) and owns the state;
 * this hook only decides what the gesture meant.
 */

/** Below this distance the gesture is still a tap, so links keep working. */
const DRAG_THRESHOLD_PX = 6

/** How close to an edge the pointer has to get before the pile scrolls itself. */
const EDGE_PX = 56
const EDGE_SPEED = 14

/**
 * Nudges whichever scrollable container is under the pointer.
 *
 * The bin scrolls inside itself, so a tile can sit below the fold while the
 * pointer is already holding one. Without this, reaching it means dropping the
 * tile, scrolling, and picking it up again.
 */
function autoScroll(x, y) {
  const el = document.elementFromPoint(x, y)
  if (!el || !el.closest) return
  // The bin scrolls in its own zone, but the board scrolls in the container the
  // rows sit in, so walk up from whatever is under the pointer to the first
  // ancestor that can actually move.
  let scroller = null
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const overflowY = getComputedStyle(node).overflowY
      if (overflowY === 'auto' || overflowY === 'scroll') {
        scroller = node
        break
      }
    }
  }
  if (!scroller) return

  const r = scroller.getBoundingClientRect()
  if (y > r.bottom - EDGE_PX) scroller.scrollTop += EDGE_SPEED
  else if (y < r.top + EDGE_PX) scroller.scrollTop -= EDGE_SPEED
}

export function useTierDrag({ onMove, disabled = false }) {
  // Nothing in here drives rendering except `drag`, so the rest lives in refs to
  // avoid re-rendering the whole board on every pointermove.
  const [drag, setDrag] = useState(null)
  const stateRef = useRef(null)
  const frameRef = useRef(0)
  const onMoveRef = useRef(onMove)
  // When a gesture ends as a real drag the browser still fires a click on the
  // tile it started from. Anything listening for a tap has to know to ignore it.
  const dragEndRef = useRef(0)

  useEffect(() => { onMoveRef.current = onMove }, [onMove])

  const clear = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }
    stateRef.current = null
    setDrag(null)
  }, [])

  /**
   * Which zone is under the pointer, and where in it the tile would land.
   * Tiles wrap onto multiple lines, so the row band (y) is compared before x —
   * otherwise dropping on line two of a full row lands the tile on line one.
   */
  const hitTest = useCallback((x, y, draggedKey) => {
    const el = document.elementFromPoint(x, y)
    const zoneEl = el && el.closest ? el.closest('[data-tier-zone]') : null
    if (!zoneEl) return { zone: null, index: 0 }

    const zone = zoneEl.getAttribute('data-tier-zone')
    const tiles = Array.from(zoneEl.querySelectorAll('[data-tier-item]'))
      .filter((t) => t.getAttribute('data-tier-item') !== draggedKey)

    let index = tiles.length
    for (let i = 0; i < tiles.length; i += 1) {
      const r = tiles[i].getBoundingClientRect()
      const belowThisLine = y > r.bottom
      if (belowThisLine) continue
      const withinLine = y >= r.top
      if (withinLine && x > r.left + r.width / 2) continue
      index = i
      break
    }
    return { zone, index }
  }, [])

  const handlePointerMove = useCallback((e) => {
    const s = stateRef.current
    if (!s) return

    if (!s.armed) {
      const moved = Math.hypot(e.clientX - s.startX, e.clientY - s.startY)
      if (moved < DRAG_THRESHOLD_PX) return
      s.armed = true
      document.body.classList.add('tier-dragging')
    }

    s.pointerX = e.clientX
    s.pointerY = e.clientY
    e.preventDefault()

    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const cur = stateRef.current
      if (!cur) return
      autoScroll(cur.pointerX, cur.pointerY)
      const { zone, index } = hitTest(cur.pointerX, cur.pointerY, cur.itemKey)
      setDrag({
        itemKey: cur.itemKey,
        fromZone: cur.fromZone,
        overZone: zone,
        overIndex: index,
        width: cur.width,
        height: cur.height,
        x: cur.pointerX - cur.grabX,
        y: cur.pointerY - cur.grabY,
      })
    })
  }, [hitTest])

  const handlePointerUp = useCallback((e) => {
    const s = stateRef.current
    if (!s) return
    document.body.classList.remove('tier-dragging')

    if (s.armed) {
      dragEndRef.current = Date.now()
      const { zone, index } = hitTest(e.clientX, e.clientY, s.itemKey)
      if (zone) onMoveRef.current?.(s.itemKey, s.fromZone, zone, index)
    }
    clear()
  }, [clear, hitTest])

  /** Attach to a tile's onPointerDown. */
  const startDrag = useCallback((e, itemKey, fromZone) => {
    if (disabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const rect = e.currentTarget.getBoundingClientRect()
    stateRef.current = {
      itemKey,
      fromZone,
      armed: false,
      startX: e.clientX,
      startY: e.clientY,
      pointerX: e.clientX,
      pointerY: e.clientY,
      grabX: e.clientX - rect.left,
      grabY: e.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    }

    // Capturing on the tile keeps events coming even when the pointer outruns it.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not fatal */ }
  }, [disabled])

  useEffect(() => {
    const cancel = (e) => {
      if (!stateRef.current) return
      if (e && e.type === 'keydown' && e.key !== 'Escape') return
      document.body.classList.remove('tier-dragging')
      clear()
    }
    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', cancel)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', cancel)
      document.body.classList.remove('tier-dragging')
    }
  }, [handlePointerMove, handlePointerUp, clear])

  /** True for the click that a just-finished drag is about to emit. */
  const justDragged = useCallback(() => Date.now() - dragEndRef.current < 250, [])

  return {
    drag,
    startDrag,
    justDragged,
    isDragging: Boolean(drag),
    draggingKey: drag?.itemKey ?? null,
  }
}

export default useTierDrag
