/**
 * Explore facets — slugs and display labels.
 *
 * Slugs match backend/app/data/explore_taxonomy.py, which owns the TMDB genre and
 * keyword ids behind each one. Keep the two lists in step when adding a facet.
 */
import {
  LuShapes, LuDrama, LuGlobe, LuLanguages, LuUsers, LuAward, LuSwords, LuVideo,
} from 'react-icons/lu'

export const slugify = (label) =>
  label.toLowerCase().replace(/&/g, '').replace(/\//g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ── Menu facets ───────────────────────────────────────────────────
// `to` is where the tile goes; `param` is the /explore query key a hub item sets.
export const FACETS = [
  { id: 'category', label: 'Category',        Icon: LuShapes,    to: '/explore/category' },
  { id: 'genre',    label: 'Genre',           Icon: LuDrama,     to: '/explore/genre' },
  { id: 'country',  label: 'Country',         Icon: LuGlobe,     to: '/explore/country' },
  { id: 'language', label: 'Language',        Icon: LuLanguages, to: '/explore/language' },
  { id: 'family',   label: 'Family Friendly', Icon: LuUsers,     to: '/explore/family' },
  { id: 'awards',   label: 'Award Winners',   Icon: LuAward,     to: '/explore?award=1' },
  { id: 'anime',    label: 'Anime',           Icon: LuSwords,    to: '/explore/anime' },
  { id: 'franchise',label: 'Franchise',       Icon: LuVideo,     to: '/explore/franchise' },
]

// ── Genres (tone = card gradient hue, dot = rail swatch) ──────────
export const GENRES = [
  { slug: 'action',      label: 'Action',      tone: '#6b0f1a', dot: '#e11d2e' },
  { slug: 'comedy',      label: 'Comedy',      tone: '#6b5410', dot: '#f5c518' },
  { slug: 'drama',       label: 'Drama',       tone: '#4a3226', dot: '#9a6a52' },
  { slug: 'horror',      label: 'Horror',      tone: '#2a2a2a', dot: '#4b4b4b' },
  { slug: 'informative', label: 'Informative', tone: '#4a4a4a', dot: '#e5e5e5' },
  { slug: 'mystery',     label: 'Mystery',     tone: '#2e1a5c', dot: '#7c3aed' },
  { slug: 'romance',     label: 'Romance',     tone: '#6b1a24', dot: '#f43f5e' },
  { slug: 'sci-fi',      label: 'Sci-Fi',      tone: '#0f4a45', dot: '#14b8a6' },
  { slug: 'sports',      label: 'Sports',      tone: '#5c2a0f', dot: '#ea580c' },
  { slug: 'thriller',    label: 'Thriller',    tone: '#10245c', dot: '#2563eb' },
]
export const GENRE_BY_SLUG = Object.fromEntries(GENRES.map((g) => [g.slug, g]))

// ── Categories, A–Z ───────────────────────────────────────────────
const CATEGORY_LABELS = [
  'Action', 'Adaptation', 'Adult Comedy', 'Adventure', 'Animated', 'Anthology', 'Art House',
  'Based on Book', 'Based on Game', 'Based on True Story', 'Biopic', 'Blood & Gore', 'Body Horror',
  'Bottle Movies', 'Bromance', 'Buddy Movie', 'Business',
  'Campy', 'Christmas', 'Coming of Age', 'Concert Film', 'Crime', 'Cult Classic', 'Cyberpunk', 'Cyber Thriller',
  'Dance', 'Dark Comedy', 'Dark / Gritty', 'Date Night', 'Disaster', 'Disturbing', 'Documentary', 'Drama', 'Dystopia',
  'Empowering', 'Epic', 'Espionage',
  'Family Drama', 'Fantasy', 'Feel Good', 'Festive', 'Found Footage', 'Friendship', 'Futuristic',
  'Game Show', 'Gangster',
  'Harem', 'Heartbreaking', 'Heist', 'Highschool', 'Historical', 'Historical Fiction', 'Horror', 'Humour', 'Hyperlink',
  'Indie', 'Inspirational', 'Isekai',
  'Legal Drama', 'Lighthearted & Fun',
  'Mass Movie', 'Mecha', 'Mind-Bending', 'Mockumentary', 'Monster', 'Murder Mystery', 'Musical', 'Mystery',
  'Neo Noir', 'Noir',
  'Original Anime',
  'Parody', 'Patriotic', 'Period Drama', 'Political', 'Post-Apocalyptic', 'Psychological',
  'Reality TV', 'Relaxing', 'Remake', 'Revenge', 'Romance', 'Rom-Com',
  'Satire', 'Seinen', 'Shonen', 'Short', 'Shoujo', 'Sitcom', 'Slasher', 'Slice of Life', 'Slow Burn',
  'Social Drama', 'Spin-Off', 'Spiritual', 'Spoof', 'Sports', 'Spy', 'Stand-up', 'Steamy', 'Superhero',
  'Supernatural', 'Survival',
  'Talk Show', 'Teen', 'Time Travel', 'Tragedy', 'Travel',
  'War', 'Western', 'Witty',
  'Yaoi', 'Yuri',
  'Zombie Apocalypse',
]
export const CATEGORIES = CATEGORY_LABELS.map((label) => ({ slug: slugify(label), label }))
export const CATEGORY_BY_SLUG = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]))

// ── Countries (ISO 3166-1 alpha-2 is the query value) ─────────────
export const COUNTRIES = [
  ['AR', 'Argentina'], ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'],
  ['CA', 'Canada'], ['CN', 'China'], ['CO', 'Colombia'], ['DK', 'Denmark'], ['FI', 'Finland'],
  ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HK', 'Hong Kong'], ['HU', 'Hungary'],
  ['IS', 'Iceland'], ['IN', 'India'], ['ID', 'Indonesia'], ['IR', 'Iran'], ['IE', 'Ireland'],
  ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['LB', 'Lebanon'], ['MY', 'Malaysia'],
  ['MX', 'Mexico'], ['NL', 'Netherlands'], ['NZ', 'New Zealand'], ['NO', 'Norway'], ['PH', 'Philippines'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['RU', 'Russia'], ['KR', 'South Korea'], ['ES', 'Spain'],
  ['SE', 'Sweden'], ['TW', 'Taiwan'], ['TH', 'Thailand'], ['TR', 'Turkey'], ['AE', 'UAE'],
  ['GB', 'UK'], ['UA', 'Ukraine'], ['US', 'USA'],
].map(([code, label]) => ({ code, label }))
export const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]))

/** Flag image — emoji flags render as two letters on Windows. */
export const flagUrl = (code, w = 80) => `https://flagcdn.com/w${w}/${code.toLowerCase()}.png`

// ── Languages, A–Z ────────────────────────────────────────────────
const LANGUAGE_LABELS = [
  'Albanian', 'Arabic', 'Assamese', 'Bengali', 'Cantonese', 'Danish', 'Dutch', 'English',
  'Filipino', 'Finnish', 'Flemish', 'French', 'German', 'Greek', 'Gujarati', 'Hebrew', 'Hindi',
  'Hungarian', 'Icelandic', 'Indonesian', 'Irish', 'Italian', 'Japanese', 'Kannada', 'Korean',
  'Malay', 'Malayalam', 'Mandarin', 'Marathi', 'Norwegian', 'Odia', 'Persian', 'Polish',
  'Portuguese', 'Punjabi', 'Russian', 'Silent', 'Spanish', 'Swedish', 'Taiwanese', 'Tamil',
  'Telugu', 'Thai', 'Turkish', 'Ukrainian',
]
export const LANGUAGES = LANGUAGE_LABELS.map((label) => ({ slug: slugify(label), label }))
export const LANGUAGE_BY_SLUG = Object.fromEntries(LANGUAGES.map((l) => [l.slug, l]))

// ── Family friendly ───────────────────────────────────────────────
export const FAMILY = [
  { slug: 'kids',    label: 'Kids Safe', short: 'Kids',     tone: '#14532d', dot: '#22c55e', hint: 'G · TV-Y7' },
  { slug: 'under10', label: 'Under 10',  short: 'Under 10', tone: '#0c4a6e', dot: '#38bdf8', hint: 'PG · TV-PG' },
  { slug: 'under16', label: 'Under 16',  short: 'Under 16', tone: '#6b4a0a', dot: '#f59e0b', hint: 'PG-13 · TV-14' },
  { slug: 'under18', label: 'Under 18',  short: 'Under 18', tone: '#5c1a1a', dot: '#ef4444', hint: 'Up to R' },
]
export const FAMILY_BY_SLUG = Object.fromEntries(FAMILY.map((f) => [f.slug, f]))

// ── Anime genres: each tile sets either `genres` or `category` ────
export const ANIME_GENRES = [
  { slug: 'action',        label: 'Action',        tone: '#6b0f1a', genres: 'action' },
  { slug: 'adventure',     label: 'Adventure',     tone: '#5c3a0f', category: 'adventure' },
  { slug: 'comedy',        label: 'Comedy',        tone: '#6b5410', genres: 'comedy' },
  { slug: 'drama',         label: 'Drama',         tone: '#4a3226', genres: 'drama' },
  { slug: 'fantasy',       label: 'Fantasy',       tone: '#3b1a5c', category: 'fantasy' },
  { slug: 'romance',       label: 'Romance',       tone: '#6b1a24', genres: 'romance' },
  { slug: 'sci-fi',        label: 'Sci-Fi',        tone: '#0f4a45', genres: 'sci-fi' },
  { slug: 'mystery',       label: 'Mystery',       tone: '#2e1a5c', genres: 'mystery' },
  { slug: 'horror',        label: 'Horror',        tone: '#2a2a2a', genres: 'horror' },
  { slug: 'sports',        label: 'Sports',        tone: '#5c2a0f', genres: 'sports' },
  { slug: 'slice-of-life', label: 'Slice of Life', tone: '#1f4a2a', category: 'slice-of-life' },
  { slug: 'isekai',        label: 'Isekai',        tone: '#1a3a6b', category: 'isekai' },
  { slug: 'mecha',         label: 'Mecha',         tone: '#3a3f4a', category: 'mecha' },
  { slug: 'shonen',        label: 'Shonen',        tone: '#6b2a0f', category: 'shonen' },
  { slug: 'seinen',        label: 'Seinen',        tone: '#1a1a3a', category: 'seinen' },
  { slug: 'shoujo',        label: 'Shoujo',        tone: '#6b1a4a', category: 'shoujo' },
]

// ── Rail options ──────────────────────────────────────────────────
export const SORTS = [
  { value: 'popularity',   label: 'Most popular' },
  { value: 'release_date', label: 'Newest releases' },
  { value: 'rating',       label: 'Highest rated' },
  { value: 'moctale',      label: 'Moctale score' },
  { value: 'title',        label: 'Title A–Z' },
]

export const DURATIONS = [
  { value: 'u30',     label: 'Under 30 mins' },
  { value: '30-60',   label: '30–60 mins' },
  { value: '1-2h',    label: '1–2 hrs' },
  { value: '2-3h',    label: '2–3 hrs' },
  { value: '3h-plus', label: '3 hrs+' },
]

export const CURRENT_YEAR = new Date().getFullYear()
export const DECADES = [
  { value: 'pre1980', label: 'Pre 1980', from: 1900, to: 1979 },
  { value: '1980s',   label: '1980s',    from: 1980, to: 1989 },
  { value: '1990s',   label: '1990s',    from: 1990, to: 1999 },
  { value: '2000s',   label: '2000s',    from: 2000, to: 2009 },
  { value: '2010s',   label: '2010s',    from: 2010, to: 2019 },
  { value: '2020s',   label: '2020s',    from: 2020, to: CURRENT_YEAR },
]

export const CINEMAS = [
  { value: 'hollywood',  label: 'Hollywood' },
  { value: 'bollywood',  label: 'Bollywood' },
  { value: 'tollywood',  label: 'Tollywood' },
  { value: 'kollywood',  label: 'Kollywood' },
  { value: 'mollywood',  label: 'Mollywood' },
  { value: 'sandalwood', label: 'Sandalwood' },
  { value: 'kdrama',     label: 'K-Drama' },
]

export const COMPANIES = [
  { id: '420', label: 'Marvel Studios' },
  { id: '2', label: 'Walt Disney' },
  { id: '174', label: 'Warner Bros.' },
  { id: '33', label: 'Universal' },
  { id: '4', label: 'Paramount' },
  { id: '34', label: 'Sony Pictures' },
  { id: '178464', label: 'Netflix Studios' },
  { id: '41077', label: 'A24' },
  { id: '3172', label: 'Blumhouse' },
  { id: '4439', label: 'Yash Raj Films' },
  { id: '7293', label: 'Dharma Productions' },
  { id: '194232', label: 'Apple Studios' },
  { id: '20580', label: 'Amazon Studios' },
  { id: '3268', label: 'HBO' },
  { id: '14439', label: 'Lionsgate' },
  { id: '25', label: '20th Century Studios' },
  { id: '10146', label: 'Focus Features' },
  { id: '1088', label: 'Illumination' },
  { id: '3', label: 'Pixar' },
  { id: '56', label: 'Amblin Entertainment' },
]

/** Group a label list into [{ letter, items }] for the A–Z hub layout. */
export function groupByLetter(items) {
  const groups = new Map()
  for (const it of items) {
    const letter = it.label[0].toUpperCase()
    if (!groups.has(letter)) groups.set(letter, [])
    groups.get(letter).push(it)
  }
  return [...groups].map(([letter, list]) => ({ letter, items: list }))
}
