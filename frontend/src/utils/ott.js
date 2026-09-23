/**
 * OTT platforms shown as filter tiles (watchlist detail + explore rail).
 *
 * `ids` are TMDB watch-provider ids — several per platform because TMDB lists
 * add-on channels and regional variants separately. `match` is a name fallback
 * for when TMDB adds a new id for an existing platform.
 */
import { SiNetflix, SiCrunchyroll, SiAppletv, SiYoutube } from 'react-icons/si'

export const OTT = [
  { id: 'netflix',     label: 'Netflix',     ids: [8, 175, 1796],              match: /netflix/i,               bg: '#e50914', Icon: SiNetflix },
  { id: 'prime',       label: 'Prime Video', ids: [9, 119, 10, 613, 2100],     match: /prime video|amazon video/i, bg: '#1f8fff', glyph: 'P' },
  { id: 'hotstar',     label: 'JioHotstar',  ids: [2336, 122, 337, 970, 220],  match: /hotstar|jio ?cinema/i,   bg: 'linear-gradient(135deg,#2b5cff,#d4148f)', glyph: 'J' },
  { id: 'crunchyroll', label: 'Crunchyroll', ids: [283, 1968],                 match: /crunchyroll/i,           bg: '#f47521', Icon: SiCrunchyroll },
  { id: 'sonyliv',     label: 'SonyLIV',     ids: [237],                       match: /sony\s?liv/i,            bg: 'linear-gradient(135deg,#f7a21b,#7b2ff7)', glyph: 'S' },
  { id: 'zee5',        label: 'Zee5',        ids: [232],                       match: /zee\s?5/i,               bg: '#8230c6', glyph: 'Z' },
  { id: 'appletv',     label: 'Apple TV',    ids: [350, 2],                    match: /apple tv|itunes/i,       bg: '#2a2a2e', Icon: SiAppletv },
  { id: 'youtube',     label: 'YouTube',     ids: [192, 235, 188],             match: /youtube/i,               bg: '#ff0033', Icon: SiYoutube },
]

export function ottMatches(o, p) {
  if (typeof p === 'string') return o.match.test(p)
  // Name as a fallback too: TMDB occasionally adds a new id for an existing platform.
  return (p?.id != null && o.ids.includes(Number(p.id))) || (!!p?.name && o.match.test(p.name))
}

/** TMDB provider ids for a set of OTT tile ids, for the discover `providers` param. */
export function ottProviderIds(tileIds) {
  return OTT.filter((o) => tileIds.includes(o.id)).flatMap((o) => o.ids)
}
