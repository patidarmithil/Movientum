// One-off script: fetch textless hero/card/poster art for the Intro page from TMDB.
// Run manually: node scripts/download-intro-assets.mjs
// Reads TMDB_API_KEY from ../backend/.env. Never invoked at build or runtime.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '../../backend/.env')
const envText = fs.readFileSync(envPath, 'utf-8')
const apiKeyMatch = envText.match(/^TMDB_API_KEY=(.+)$/m)
if (!apiKeyMatch) throw new Error('TMDB_API_KEY not found in backend/.env')
const API_KEY = apiKeyMatch[1].trim()
const BASE = 'https://api.themoviedb.org/3'
const IMG_BASE = 'https://image.tmdb.org/t/p/original'

const OUT_DIR = path.resolve(__dirname, '../src/assets/intro')
const POSTER_DIR = path.join(OUT_DIR, 'posters')
fs.mkdirSync(POSTER_DIR, { recursive: true })

const HERO = [
  { file: 'hero-far.jpg', type: 'movie', id: 157336, kind: 'backdrops' },   // Interstellar
  { file: 'hero-mid.jpg', type: 'movie', id: 335984, kind: 'backdrops' },   // Blade Runner 2049
  { file: 'hero-near.jpg', type: 'movie', id: 693134, kind: 'backdrops' },  // Dune: Part Two
]

// Card stills are chosen for palette, not just fame: each one has to sit inside a
// #080808 page without punching a white hole in it. Endgame (299534) and Inception
// (27205) were dropped for exactly that reason — both read as near-white plates.
// A `season` field narrows the lookup to /tv/{id}/season/{n}/images, which is the
// only place season-specific key art lives. A `pick` field names an exact
// file_path, for the cases where "widest textless" picks the wrong image.
const CARDS = [
  // Into the Spider-Verse — the leap-of-faith poster. Every Spider-Verse poster
  // carries the title, so there is no textless option to prefer here.
  { file: 'card-discover-spiderverse.jpg', type: 'movie', id: 324857, kind: 'posters', pick: '/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg' },
  { file: 'card-rate.jpg', type: 'movie', id: 872585, kind: 'backdrops' },     // Oppenheimer — warm dark
  { file: 'card-lists.jpg', type: 'movie', id: 129, kind: 'backdrops' },       // Spirited Away
  // The Recommendations card uses hand-supplied art checked into
  // src/assets/intro/rec.jpg. It is intentionally absent here — this script must
  // never overwrite it.
]

const POSTERS = [
  { type: 'movie', id: 155 }, { type: 'movie', id: 496243 }, { type: 'movie', id: 157336 },
  { type: 'movie', id: 244786 }, { type: 'movie', id: 569094 }, { type: 'movie', id: 545611 },
  { type: 'movie', id: 76341 }, { type: 'movie', id: 329865 }, { type: 'movie', id: 372058 },
  { type: 'movie', id: 120467 }, { type: 'movie', id: 475557 }, { type: 'movie', id: 438631 },
  { type: 'movie', id: 872585 }, { type: 'movie', id: 313369 }, { type: 'movie', id: 335984 },
  { type: 'movie', id: 299534 },
  { type: 'tv', id: 1396 }, { type: 'tv', id: 1399 }, { type: 'tv', id: 87108 },
  { type: 'tv', id: 70523 }, { type: 'tv', id: 100088 }, { type: 'tv', id: 94605 },
  { type: 'tv', id: 95396 }, { type: 'tv', id: 66732 },
]

async function fetchWithRetry(url, opts = {}, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, opts)
    } catch (err) {
      if (i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 400 * (i + 1)))
    }
  }
}

async function fetchImages(type, id, season) {
  // Season art is not returned by the show-level endpoint, and it is only
  // available in localized form, so ask for every language rather than the
  // default (which filters to the account language and can come back empty).
  const path = season == null
    ? `${BASE}/${type}/${id}/images?api_key=${API_KEY}`
    : `${BASE}/${type}/${id}/season/${season}/images?api_key=${API_KEY}&include_image_language=en,ja,null`
  const res = await fetchWithRetry(path)
  if (!res.ok) throw new Error(`TMDB images failed for ${type}/${id}: ${res.status}`)
  return res.json()
}

function pickBest(list) {
  const textless = list.filter((i) => i.iso_639_1 === null)
  const pool = textless.length ? textless : list
  return pool.sort((a, b) => b.width - a.width)[0]
}

// Re-running the script should be cheap: only fetch what is missing. Delete a file
// (or pass --force) when you want it replaced.
const FORCE = process.argv.includes('--force')

async function downloadFile(url, destPath) {
  if (!FORCE && fs.existsSync(destPath)) {
    console.log(`  skip ${path.basename(destPath)} (exists)`)
    return
  }
  const res = await fetchWithRetry(url)
  if (!res.ok) throw new Error(`download failed ${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(destPath, buf)
  console.log(`  saved ${destPath} (${(buf.length / 1024).toFixed(0)} KB)`)
}

// Skipping the metadata call too, not just the byte download — otherwise a re-run
// still costs 31 TMDB round trips to decide it has nothing to do.
function done(destPath) {
  if (FORCE || !fs.existsSync(destPath)) return false
  console.log(`  skip ${path.basename(destPath)} (exists)`)
  return true
}

async function run() {
  console.log('Fetching hero layers...')
  for (const h of HERO) {
    if (done(path.join(OUT_DIR, h.file))) continue
    const data = await fetchImages(h.type, h.id)
    const best = pickBest(data[h.kind] || [])
    if (!best) { console.warn(`  no ${h.kind} for ${h.type}/${h.id}`); continue }
    await downloadFile(`${IMG_BASE}${best.file_path}`, path.join(OUT_DIR, h.file))
  }

  console.log('Fetching card images...')
  for (const c of CARDS) {
    if (done(path.join(OUT_DIR, c.file))) continue
    const data = await fetchImages(c.type, c.id, c.season)
    const list = data[c.kind] || []
    const best = c.pick ? list.find((i) => i.file_path === c.pick) : pickBest(list)
    if (!best) { console.warn(`  no ${c.kind} for ${c.type}/${c.id}`); continue }
    await downloadFile(`${IMG_BASE}${best.file_path}`, path.join(OUT_DIR, c.file))
  }

  console.log('Fetching posters...')
  let i = 1
  for (const p of POSTERS) {
    const name = `p${String(i).padStart(2, '0')}.jpg`
    if (done(path.join(POSTER_DIR, name))) { i++; continue }
    const data = await fetchImages(p.type, p.id)
    const best = pickBest(data.posters || [])
    if (!best) { console.warn(`  no poster for ${p.type}/${p.id}`); i++; continue }
    await downloadFile(`${IMG_BASE}${best.file_path}`, path.join(POSTER_DIR, name))
    i++
  }

  console.log('Done. Convert to AVIF with a JPEG fallback as a follow-up pass if desired.')
}

run().catch((err) => { console.error(err); process.exit(1) })
