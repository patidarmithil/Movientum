// Shared helpers for the /analysis page sections.

export const TMDB_IMG = 'https://image.tmdb.org/t/p'

/** Detail-page route for an item; TV lives at /tv/:id, movies at /movies/:id. */
export const detailPath = (item) =>
  item?.media_type === 'tv' ? `/tv/${item.id}` : `/movies/${item.id}`

export const posterUrl = (path, size = 'w185') => (path ? `${TMDB_IMG}/${size}${path}` : null)

export const pct = (v, digits = 0) => `${((Number(v) || 0) * 100).toFixed(digits)}%`

let languageNames = null
try {
  languageNames = new Intl.DisplayNames(['en'], { type: 'language' })
} catch {
  languageNames = null
}

/** "ja" -> "Japanese". Falls back to the upper-cased code. */
export const languageName = (code) => {
  if (!code) return 'Unknown'
  try {
    return languageNames?.of(code) || code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}

const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat
  ? new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  : null

/** "3 days ago", "yesterday", "in 2 months". */
export const relativeTime = (iso) => {
  if (!iso) return ''
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs = Math.abs(diff)
  const units = [
    ['year', 31536000], ['month', 2592000], ['week', 604800],
    ['day', 86400], ['hour', 3600], ['minute', 60],
  ]
  for (const [unit, secs] of units) {
    if (abs >= secs) {
      const n = Math.round(diff / secs)
      return rtf ? rtf.format(n, unit) : `${Math.abs(n)} ${unit}s`
    }
  }
  return 'just now'
}

export const shortDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''

/**
 * One plain sentence describing the user's taste, built from the analysis
 * payload. Returns null when there is nothing to say yet.
 */
export function tasteHeadline(analysis) {
  const top = analysis?.summary?.top_genre
  if (!top || top === 'N/A') return null
  const rising = (analysis.evolution || [])
    .filter((e) => e.shift > 0.05 && e.genre !== top)
    .sort((a, b) => b.shift - a.shift)[0]
  if (rising) return `Mostly ${top.toLowerCase()}, lately drifting into ${rising.genre.toLowerCase()}.`
  const second = (analysis.genre_distribution || []).find((g) => g.genre !== top)
  if (second) return `Mostly ${top.toLowerCase()}, with a steady side of ${second.genre.toLowerCase()}.`
  return `Mostly ${top.toLowerCase()}.`
}

export const SIGNAL_META = {
  thumbs_up:   { label: 'Liked',        verb: 'You liked',          color: '#00E5A0' },
  thumbs_down: { label: 'Disliked',     verb: 'You disliked',       color: '#FF4D6D' },
  watched:     { label: 'Watched',      verb: 'You watched',        color: '#9B59FF' },
  watchlist:   { label: 'Watchlisted',  verb: 'You saved',          color: '#7AA7FF' },
  click:       { label: 'Opened',       verb: 'You opened',         color: '#FFC300' },
}

export const POOL_META = {
  established: { label: 'Established taste', hint: 'Titles that match your long-term profile' },
  diverse:     { label: 'Older interests',   hint: 'Genres you have drifted away from' },
  recent:      { label: 'Current mood',      hint: 'Something you watched or saved lately' },
  fresh:       { label: 'Popular right now', hint: 'Not personalised — pure discovery' },
}
