import TierTile from './TierTile'

/**
 * The unranked tray.
 *
 * Called the Bin after the editing-room term for where unsorted footage lives — the
 * one bit of film vocabulary the page spends, and it describes the thing better than
 * "unranked items" does.
 */
export default function TierBin({
  items,
  tile,
  readOnly,
  isOver,
  dropIndex,
  draggingKey,
  heldKey,
  onPointerDown,
  onTileKeyDown,
  onAddTitles,
  onShuffleBack,
  rankedCount,
  onZoom,
}) {
  const withMarker = []
  items.forEach((entry, i) => {
    if (isOver && dropIndex === i) withMarker.push({ marker: true, key: `m${i}` })
    withMarker.push(entry)
  })
  if (isOver && dropIndex >= items.length) withMarker.push({ marker: true, key: 'm-end' })

  return (
    <section className="tier-bin" aria-label="Unranked titles">
      <header className="tier-bin__head">
        <h2 className="tier-bin__title">
          Bin
          <span className="tier-bin__count">
            {items.length === 0
              ? 'everything ranked'
              : `${items.length} left`}
          </span>
        </h2>
        {!readOnly && (
          <div className="tier-bin__actions">
            {rankedCount > 0 && (
              <button type="button" className="tier-btn tier-btn--quiet" onClick={onShuffleBack}>
                Send all back
              </button>
            )}
            <button type="button" className="tier-btn" onClick={onAddTitles}>
              Add titles
            </button>
          </div>
        )}
      </header>

      <div
        className={'tier-bin__zone' + (isOver ? ' is-over' : '')}
        data-tier-zone="bin"
        role="list"
        aria-label={`Bin, ${items.length} unranked items`}
      >
        {withMarker.map((entry) =>
          entry.marker ? (
            <span key={entry.key} className="tier-drop-marker" aria-hidden="true" />
          ) : (
            <TierTile
              key={entry.key}
              itemKey={entry.key}
              item={entry.item}
              zoneId="bin"
              tile={tile}
              readOnly={readOnly}
              dragging={draggingKey === entry.key}
              held={heldKey === entry.key}
              onPointerDown={onPointerDown}
              onZoom={onZoom}
              onKeyDown={(e) => onTileKeyDown(e, entry.key, 'bin')}
            />
          )
        )}
        {!items.length && !isOver && (
          <p className="tier-bin__empty">
            {readOnly
              ? 'Every title on this board was ranked.'
              : 'Nothing left down here. Drag a tile back to change your mind.'}
          </p>
        )}
      </div>
    </section>
  )
}
