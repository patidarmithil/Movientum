import { memo } from 'react'
import { tileImageUrl } from '../../utils/tierImages'

/**
 * One rankable item.
 *
 * A real <button> rather than a div, so the board is operable from the keyboard:
 * Enter picks a tile up, the arrow keys move it, Enter drops it. The pointer drag
 * runs on top of that and only arms past a few pixels of movement, which keeps a
 * plain tap working as a tap.
 */
function TierTile({
  item,
  itemKey,
  zoneId,
  tile = 'poster',
  onPointerDown,
  dragging = false,
  held = false,
  readOnly = false,
  onKeyDown,
  onZoom,
}) {
  const src = tileImageUrl(item.image, tile)

  return (
    <button
      type="button"
      className={
        'tier-tile' +
        (dragging ? ' tier-tile--dragging' : '') +
        (held ? ' tier-tile--held' : '')
      }
      data-tier-item={itemKey}
      data-tile={tile}
      title={item.name}
      aria-label={item.name + (item.year ? `, ${item.year}` : '')}
      aria-grabbed={held || undefined}
      disabled={readOnly && !onZoom}
      onPointerDown={readOnly ? undefined : (e) => onPointerDown(e, itemKey, zoneId)}
      onKeyDown={onKeyDown}
      // A tap that never became a drag means "let me see it" — the caller decides
      // whether the gesture that just ended was a drag.
      onClick={onZoom ? () => onZoom(item) : undefined}
      onContextMenu={(e) => e.preventDefault()}
    >
      {src ? (
        // Deliberately NOT crossOrigin. Every other poster in the app is fetched
        // plain, so requesting these in CORS mode would miss those cache entries
        // and, worse, fail outright against the ones already stored without CORS
        // headers. The PNG export carries that cost instead — see tierExport.js.
        <img src={src} alt="" draggable="false" loading="lazy" decoding="async" />
      ) : (
        <span className="tier-tile__fallback">{item.name}</span>
      )}
      <span className="tier-tile__name">{item.name}</span>
    </button>
  )
}

export default memo(TierTile)
