/**
 * Poster URLs for tier tiles.
 *
 * Lives apart from the tile component so that file exports a component and nothing
 * else, which is what Vite's fast refresh needs to hot-swap it cleanly.
 */
import { isUploadRef, uploadUrl } from './tierUploads'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

/** Stills are 16:9 and need a wider source; posters and headshots are both 2:3. */
const SIZE_FOR_TILE = { poster: 'w185', profile: 'w185', still: 'w300' }

export function tileImageUrl(path, tile) {
  if (!path) return null
  // A locally uploaded picture is stored on the device, not at TMDB.
  if (isUploadRef(path)) return uploadUrl(path)
  return `${TMDB_IMAGE_BASE}/${SIZE_FOR_TILE[tile] || 'w185'}${path}`
}

/**
 * The largest rendition TMDB stores, for the tap-to-zoom view. `original` is the
 * source file, so it is only ever requested when somebody has actually asked to
 * look at the artwork — never in a grid.
 */
export function fullImageUrl(path) {
  if (!path) return null
  if (isUploadRef(path)) return uploadUrl(path)
  return `${TMDB_IMAGE_BASE}/original${path}`
}
