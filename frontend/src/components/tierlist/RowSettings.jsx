import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ROW_COLORS } from '../../utils/tierPresets'

/**
 * Row controls: rename, recolour, add a row above or below, clear it, remove it.
 *
 * A popover anchored beside the row rather than a modal — you are usually adjusting
 * one row while looking at the ones around it, and a full-screen dialog would hide
 * the comparison you are making.
 *
 * It renders through a portal because the board clips its own overflow to keep the
 * row corners rounded, which would otherwise cut the top off a popover on row one.
 */
export default function RowSettings({
  row, index, rowCount, anchorRect,
  onChange, onInsert, onClear, onRemove, onClose,
}) {
  const [label, setLabel] = useState(row.label)
  const [pos, setPos] = useState(null)
  const ref = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Placed to the left of the gear and vertically centred on the row, then clamped
  // so it never hangs off the top or bottom of the window.
  useLayoutEffect(() => {
    if (!anchorRect || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, anchorRect.left - width - margin)
    const wanted = anchorRect.top + anchorRect.height / 2 - height / 2
    const top = Math.min(Math.max(margin, wanted), window.innerHeight - height - margin)
    setPos({ top, left })
  }, [anchorRect])

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    // Deferred so the click that opened the popover does not immediately close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', onDown), 0)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onClose, true)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [onClose])

  const commitLabel = () => {
    const next = label.trim().slice(0, 24)
    if (next && next !== row.label) onChange({ label: next })
    else setLabel(row.label)
  }

  return createPortal(
    <div
      className="tier-rowset"
      ref={ref}
      role="dialog"
      aria-label={`Settings for row ${row.label}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      <label className="tier-rowset__field">
        <span>Name</span>
        <input
          ref={inputRef}
          value={label}
          maxLength={24}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commitLabel(); onClose() }
          }}
        />
      </label>

      <div className="tier-rowset__swatches" role="group" aria-label="Row colour">
        {ROW_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={'tier-rowset__swatch' + (c === row.color ? ' is-active' : '')}
            style={{ background: c }}
            aria-label={`Colour ${c}`}
            aria-pressed={c === row.color}
            onClick={() => onChange({ color: c })}
          />
        ))}
      </div>

      <div className="tier-rowset__actions">
        <button type="button" onClick={() => { onInsert(index); onClose() }}>Add row above</button>
        <button type="button" onClick={() => { onInsert(index + 1); onClose() }}>Add row below</button>
        <button type="button" onClick={() => { onClear(); onClose() }} disabled={!row.items.length}>
          Empty this row
        </button>
        <button
          type="button"
          className="tier-rowset__danger"
          onClick={() => { onRemove(); onClose() }}
          disabled={rowCount <= 1}
        >
          Delete row
        </button>
      </div>
    </div>,
    document.body
  )
}
