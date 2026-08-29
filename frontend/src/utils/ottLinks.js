/**
 * ottLinks.js — turn a TMDB watch-provider into a link to that provider.
 *
 * The problem
 * -----------
 * TMDB's `watch/providers` payload gives one `link` per region, pointing at
 * TMDB's own JustWatch redirect page. Every provider row on a detail page
 * therefore sent the reader to the same TMDB page, no matter which logo they
 * clicked — two extra hops before anyone reaches Netflix.
 *
 * TMDB does not return per-provider deep links, and JustWatch has no free public
 * API, so an exact "play this title on Netflix" URL is not obtainable. What *is*
 * obtainable, and is what this module builds, is the provider's own search URL
 * with the title pre-filled: one click from the card to the platform, with the
 * title already found. Anything unmapped keeps the TMDB link, so no row is ever
 * worse off than before.
 *
 * Resolution order (first hit wins)
 * ---------------------------------
 *   1. TMDB `provider_id`            — stable, survives provider renames
 *   2. exact normalised provider name
 *   3. reseller suffix               — "<X> Amazon Channel" is watched inside
 *                                      Prime Video, "<X> Apple TV Channel"
 *                                      inside Apple TV, "<X> Roku Premium
 *                                      Channel" inside the Roku Channel
 *   4. tier-stripped name            — "Netflix Standard with Ads" -> "netflix",
 *                                      "YouTube Premium" -> "youtube"
 *   5. the TMDB link (fallback)
 *
 * Every URL template below was probed live before being added. Providers whose
 * search path could not be confirmed (Zee5, SonyLIV, aha, Hoichoi, BookMyShow —
 * their domains refuse requests from outside their apps) are deliberately absent
 * rather than guessed: a wrong path is a dead end, while the fallback still
 * works. Add them here once a path is verified.
 */

const encode = (s) => encodeURIComponent(s)

/**
 * Providers, keyed by a stable internal name.
 *
 * `ids`   — TMDB provider_ids, taken from `/watch/providers/{movie,tv}` for the
 *           IN and US regions. Several ids map to one platform because TMDB
 *           lists ad-supported and kids tiers separately.
 * `names` — normalised provider names, used when an id is not in the list above
 *           (TMDB adds ids over time; names change far less often).
 * `build` — receives ({ query, year, region, mediaType }) and returns the URL.
 */
const PROVIDERS = {
  netflix: {
    ids: [8, 175, 1796],
    names: ['netflix', 'netflix kids', 'netflix standard with ads', 'netflix basic with ads'],
    build: ({ query }) => `https://www.netflix.com/search?q=${encode(query)}`,
  },
  primeVideo: {
    // 10 "Amazon Video" is the rent/buy storefront, which lives inside Prime
    // Video, so it resolves to the same search.
    ids: [9, 119, 10, 613, 2100],
    names: [
      'amazon prime video',
      'amazon video',
      'amazon prime video with ads',
      'amazon prime video free with ads',
    ],
    build: ({ query }) => `https://www.primevideo.com/search?phrase=${encode(query)}`,
  },
  appleTv: {
    // 350 is Apple TV+ (subscription), 2 is the Apple TV store (rent/buy). Both
    // are the same web app and the same search.
    ids: [350, 2],
    names: ['apple tv', 'apple tv+', 'apple tv plus', 'apple tv store', 'itunes'],
    build: ({ query, region }) =>
      `https://tv.apple.com/${(region || 'us').toLowerCase()}/search?term=${encode(query)}`,
  },
  disneyPlus: {
    ids: [337],
    names: ['disney plus', 'disney+'],
    build: ({ query }) => `https://www.disneyplus.com/search?q=${encode(query)}`,
  },
  jioHotstar: {
    // Hotstar (122) became JioHotstar (2336); both land on hotstar.com, which is
    // India-only, so the /in/ path is correct for every region TMDB reports it in.
    ids: [2336, 122],
    names: ['jiohotstar', 'hotstar', 'disney+ hotstar', 'disney plus hotstar'],
    build: ({ query }) => `https://www.hotstar.com/in/explore?search_query=${encode(query)}`,
  },
  jioCinema: {
    ids: [970, 220],
    names: ['jiocinema', 'jio cinema'],
    build: ({ query }) => `https://www.jiocinema.com/search/${encode(query)}`,
  },
  youtube: {
    ids: [192, 235, 188],
    names: ['youtube', 'youtube free', 'youtube premium'],
    // The one place a year earns its keep: YouTube indexes the whole web's
    // video, so the bare title pulls in clips and reviews.
    build: ({ query, year }) =>
      `https://www.youtube.com/results?search_query=${encode(year ? `${query} ${year}` : query)}`,
  },
  googlePlay: {
    ids: [3],
    names: ['google play movies', 'google play movies & tv'],
    build: ({ query, year }) =>
      `https://play.google.com/store/search?q=${encode(year ? `${query} ${year}` : query)}&c=movies`,
  },
  crunchyroll: {
    ids: [283],
    names: ['crunchyroll'],
    build: ({ query }) => `https://www.crunchyroll.com/search?q=${encode(query)}`,
  },
  mubi: {
    ids: [11],
    names: ['mubi'],
    build: ({ query }) => `https://mubi.com/search?query=${encode(query)}`,
  },
  mxPlayer: {
    ids: [515],
    names: ['mx player'],
    build: ({ query }) => `https://www.mxplayer.in/search/${encode(query)}`,
  },
  sunNxt: {
    ids: [309],
    names: ['sun nxt', 'sunnxt'],
    build: ({ query }) => `https://www.sunnxt.com/search?q=${encode(query)}`,
  },
  lionsgatePlay: {
    ids: [561],
    names: ['lionsgate play'],
    build: ({ query }) => `https://www.lionsgateplay.com/search?q=${encode(query)}`,
  },
  manoramaMax: {
    ids: [482],
    names: ['manoramamax'],
    build: ({ query }) => `https://www.manoramamax.com/search?q=${encode(query)}`,
  },
  shemarooMe: {
    ids: [474],
    names: ['shemaroome'],
    build: ({ query }) => `https://www.shemaroome.com/search?q=${encode(query)}`,
  },
  hboMax: {
    ids: [1899],
    names: ['hbo max', 'max'],
    build: ({ query }) => `https://play.max.com/search?q=${encode(query)}`,
  },
  hulu: {
    ids: [15],
    names: ['hulu'],
    build: ({ query }) => `https://www.hulu.com/search?q=${encode(query)}`,
  },
  peacock: {
    ids: [386, 387],
    names: ['peacock', 'peacock premium', 'peacock premium plus'],
    build: ({ query }) => `https://www.peacocktv.com/search?q=${encode(query)}`,
  },
  paramountPlus: {
    // No confirmed id from the live provider list, so this one is name-only.
    ids: [],
    names: ['paramount plus', 'paramount+'],
    build: ({ query }) => `https://www.paramountplus.com/search/?q=${encode(query)}`,
  },
  tubi: {
    ids: [73],
    names: ['tubi tv', 'tubi'],
    build: ({ query }) => `https://tubitv.com/search/${encode(query)}`,
  },
  plex: {
    ids: [538, 2077],
    names: ['plex', 'plex channel'],
    build: ({ query }) => `https://watch.plex.tv/search?q=${encode(query)}`,
  },
  rokuChannel: {
    ids: [207],
    names: ['the roku channel', 'roku channel'],
    build: ({ query }) => `https://therokuchannel.roku.com/search/${encode(query)}`,
  },
  discoveryPlus: {
    ids: [510, 520],
    names: ['discovery+', 'discovery plus'],
    build: ({ query, region }) =>
      region === 'IN'
        ? `https://www.discoveryplus.in/search?q=${encode(query)}`
        : `https://www.discoveryplus.com/search?q=${encode(query)}`,
  },
  starz: {
    ids: [43],
    names: ['starz'],
    build: ({ query }) => `https://www.starz.com/us/en/search?q=${encode(query)}`,
  },
}

// ── Lookup tables, built once ────────────────────────────────────
const BY_ID = new Map()
const BY_NAME = new Map()
for (const entry of Object.values(PROVIDERS)) {
  for (const id of entry.ids) BY_ID.set(id, entry)
  for (const name of entry.names) BY_NAME.set(name, entry)
}

// Resellers: watching a channel subscription happens inside the host app, so the
// host's search is the right destination.
const RESELLERS = [
  { suffix: 'amazon channel', host: PROVIDERS.primeVideo },
  { suffix: 'amazon channels', host: PROVIDERS.primeVideo },
  { suffix: 'apple tv channel', host: PROVIDERS.appleTv },
  { suffix: 'roku premium channel', host: PROVIDERS.rokuChannel },
]

// Tier qualifiers TMDB appends to a plain platform name.
const TIER_SUFFIXES = [
  'standard with ads',
  'basic with ads',
  'free with ads',
  'with ads',
  'premium plus',
  'premium',
  'free',
  'kids',
]

/** Lowercase, strip accents, drop punctuation, collapse whitespace. */
function normalise(value) {
  return (value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+& ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The text handed to the provider's search box.
 *
 * Provider search engines are far less forgiving than TMDB's: a trailing year in
 * parentheses or a stray subtitle marker usually returns nothing, so the title
 * is reduced to its plain form. Accents are kept here (unlike provider-name
 * matching) because they are part of the actual title.
 */
function searchQuery(title) {
  return (title || '')
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resolve one provider row to the best available link.
 *
 * @param {object}  provider   one entry of `providers.providers` ({ id, name })
 * @param {object}  ctx
 * @param {string}  ctx.title     the title being viewed
 * @param {number}  [ctx.year]    release year, used only where search needs it
 * @param {string}  [ctx.region]  region TMDB resolved the offers for ("IN")
 * @param {string}  [ctx.mediaType]
 * @param {string}  [ctx.fallback] TMDB's own link, used when nothing matches
 * @returns {{ url: string, direct: boolean }}
 */
export function resolveOttLink(provider, { title, year, region, mediaType, fallback } = {}) {
  const query = searchQuery(title)
  const safeFallback = { url: fallback || '', direct: false }
  if (!provider || !query) return safeFallback

  const name = normalise(provider.name)

  let entry = BY_ID.get(provider.id) || BY_NAME.get(name)

  if (!entry) {
    const reseller = RESELLERS.find((r) => name.endsWith(r.suffix))
    if (reseller) entry = reseller.host
  }

  if (!entry) {
    // "netflix standard with ads" -> "netflix". Longest suffix first so
    // "premium plus" is not shortened to "premium" by the earlier pass.
    for (const suffix of TIER_SUFFIXES) {
      if (name.endsWith(` ${suffix}`)) {
        const base = name.slice(0, -(suffix.length + 1)).trim()
        entry = BY_NAME.get(base)
        if (entry) break
      }
    }
  }

  if (!entry) return safeFallback

  try {
    const url = entry.build({ query, year, region, mediaType })
    return url ? { url, direct: true } : safeFallback
  } catch {
    return safeFallback
  }
}

export default resolveOttLink
