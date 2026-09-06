import { useRef, useState } from 'react'
import TierTile from './TierTile'
import RowSettings from './RowSettings'

/**
 * One tier: a label block, the drop zone, and the row controls.
 *
 * The label block carries a solid colour because that is the shape people already
 * know from every tier list they have seen. The colours themselves are muted and the
 * letter is set in near-black on top, so a full row of posters stays the loudest
 * thing on the board rather than competing with a fluorescent bar.
 */
export default function TierRow({
  row,
  index,
  rowCount,
  items,
  tile,
  readOnly,
  dropIndex,
  isOver,
  draggingKey,
  heldKey,
  onPointerDown,
  onTileKeyDown,
  onChange,
  onInsert,
  onClear,
  onRemove,
  onMoveRow,
  onZoom,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The popover is portalled out of the board (which clips its overflow), so it
  // needs the gear's screen position to place itself against.
  const [anchorRect, setAnchorRect] = useState(null)
  const gearRef = useRef(null)

  // The insertion marker is rendered as a real element in the flow, so tiles part
  // around it and you can see exactly where the drop will land.
  const withMarker = []
  items.forEach((entry, i) => {
    if (isOver && dropIndex === i) withMarker.push({ marker: true, key: `m${i}` })
    withMarker.push(entry)
  })
  if (isOver && dropIndex >= items.length) withMarker.push({ marker: true, key: 'm-end' })

  const labelLength = row.label.length

  return (
    <div className="tier-row">
      <div
        className="tier-row__label"
        style={{ background: row.color }}
        data-len={labelLength > 8 ? 'long' : labelLength > 2 ? 'mid' : 'short'}
      >
        <span>{row.label}</span>
      </div>

      <div
        className={'tier-row__zone' + (isOver ? ' is-over' : '')}
        data-tier-zone={row.id}
        role="list"
        aria-label={`Tier ${row.label}, ${items.length} items`}
      >
        {withMarker.map((entry) =>
          entry.marker ? (
            <span key={entry.key} className="tier-drop-marker" aria-hidden="true" />
          ) : (
            <TierTile
              key={entry.key}
              itemKey={entry.key}
              item={entry.item}
              zoneId={row.id}
              tile={tile}
              readOnly={readOnly}
              dragging={draggingKey === entry.key}
              held={heldKey === entry.key}
              onPointerDown={onPointerDown}
              onZoom={onZoom}
              onKeyDown={(e) => onTileKeyDown(e, entry.key, row.id)}
            />
          )
        )}
        {!items.length && !isOver && (
          <span className="tier-row__hint" aria-hidden="true">Drop titles here</span>
        )}
      </div>

      {!readOnly && (
        <div className="tier-row__controls">
          <button
            type="button"
            ref={gearRef}
            className="tier-row__btn"
            aria-label={`Settings for tier ${row.label}`}
            aria-expanded={settingsOpen}
            onClick={() => {
              setAnchorRect(gearRef.current?.getBoundingClientRect() ?? null)
              setSettingsOpen((v) => !v)
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button
            type="button"
            className="tier-row__btn"
            aria-label={`Move tier ${row.label} up`}
            disabled={index === 0}
            onClick={() => onMoveRow(index, index - 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m18 15-6-6-6 6" />
            </svg>
          </button>
          <button
            type="button"
            className="tier-row__btn"
            aria-label={`Move tier ${row.label} down`}
            disabled={index === rowCount - 1}
            onClick={() => onMoveRow(index, index + 1)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {settingsOpen && (
            <RowSettings
              row={row}
              index={index}
              rowCount={rowCount}
              anchorRect={anchorRect}
              onChange={onChange}
              onInsert={onInsert}
              onClear={onClear}
              onRemove={onRemove}
              onClose={() => setSettingsOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  )
}
