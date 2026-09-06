/**
 * Row presets for the tier board.
 *
 * The colours are deliberately muted (~55% saturation, mid lightness) rather than
 * the pastel ramp tier-list tools usually ship. A finished board is a wall of movie
 * posters, and posters are already the loudest thing on screen — the row colour only
 * has to make S distinguishable from A at a glance, not compete with the artwork.
 *
 * Row labels are user-editable, so every preset here is a starting point.
 */

/** Classic S–F, the layout most people already have muscle memory for. */
const CLASSIC = [
  { label: 'S', color: '#E0596E' },
  { label: 'A', color: '#E08A4C' },
  { label: 'B', color: '#CDB050' },
  { label: 'C', color: '#93B95E' },
  { label: 'D', color: '#56B08B' },
  { label: 'E', color: '#4C89B5' },
  { label: 'F', color: '#7A6FA8' },
]

/**
 * Movientum's own rating vocabulary — the same four categories the rating meter uses
 * on every detail page, with the exact colours from index.css. Ranking a board in the
 * language the rest of the app already speaks.
 */
const MOVIENTUM = [
  { label: 'Perfection', color: '#9B59FF' },
  { label: 'Go For It', color: '#00E5A0' },
  { label: 'Timepass', color: '#FFC300' },
  { label: 'Skip', color: '#FF4D6D' },
]

/** Three buckets, for people who do not want to agonise. */
const SIMPLE = [
  { label: 'Loved', color: '#E0596E' },
  { label: 'Liked', color: '#CDB050' },
  { label: 'Meh', color: '#4C89B5' },
]

/** Numeric, for boards that are really a ranked shortlist. */
const NUMERIC = [
  { label: '1', color: '#E0596E' },
  { label: '2', color: '#E08A4C' },
  { label: '3', color: '#CDB050' },
  { label: '4', color: '#93B95E' },
  { label: '5', color: '#4C89B5' },
]

export const PRESETS = [
  { id: 'classic', name: 'Classic', rows: CLASSIC },
  { id: 'movientum', name: 'Movientum', rows: MOVIENTUM },
  { id: 'simple', name: 'Three buckets', rows: SIMPLE },
  { id: 'numeric', name: 'Top five', rows: NUMERIC },
]

/** Swatches offered in the row settings popover — the classic ramp plus neutrals. */
export const ROW_COLORS = [
  '#E0596E', '#E08A4C', '#CDB050', '#93B95E', '#56B08B',
  '#4C89B5', '#7A6FA8', '#B048FF', '#9CA3AF', '#3A3A42',
]

let rowSeq = 0

/** Row ids only need to be unique inside one board, and they are persisted with it. */
export function makeRowId() {
  rowSeq += 1
  return `r${Date.now().toString(36)}${rowSeq.toString(36)}`
}

/** Builds fresh, empty rows from a preset id. Falls back to Classic. */
export function rowsFromPreset(presetId) {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0]
  return preset.rows.map((r) => ({ id: makeRowId(), label: r.label, color: r.color, items: [] }))
}

/**
 * Stable key for an item across rows, the bin, and the saved payload.
 * Movies and TV shows share an id space in TMDB only by accident, so the media type
 * has to be part of the key — the same number can be a movie and a series.
 */
export function itemKey(item) {
  return `${item.media}:${item.id}`
}

export function parseItemKey(key) {
  const idx = key.indexOf(':')
  return { media: key.slice(0, idx), id: Number(key.slice(idx + 1)) }
}
