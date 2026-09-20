/**
 * convert-assets.mjs — one-off image conversion for the static assets.
 *
 * The intro page's stills and poster wall shipped as full-resolution JPEGs
 * (~40 MB total) and the help page's screenshots as PNGs (~6 MB). Both are
 * rendered far smaller than their source resolution, so every visitor was
 * downloading several megabytes to fill a card that is at most ~1600 px wide.
 *
 * This writes a `.webp` sibling next to each source file at a sensible display
 * size. Originals are never deleted or modified — if a conversion looks wrong,
 * point the import back at the .jpg/.png and re-run with different settings.
 *
 * Usage (from frontend/):
 *   npm i -D sharp
 *   node scripts/convert-assets.mjs
 *
 * Re-running is safe: existing .webp files are overwritten.
 */
import { readdir, stat, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sharp = (await import('sharp').catch(() => null))?.default
if (!sharp) {
  console.error('sharp is not installed. Run:  npm i -D sharp')
  process.exit(1)
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Each job is a directory (or single file) plus the widest size it is ever
 * displayed at. Quality 82 is the point where WebP stops being visibly
 * distinguishable from the JPEG source on photographic content.
 */
const JOBS = [
  { input: 'src/assets/intro', maxWidth: 1600, quality: 82, recursive: false },
  { input: 'src/assets/intro/posters', maxWidth: 500, quality: 80, recursive: false },
  { input: 'public/help_images', maxWidth: 1600, quality: 82, recursive: false },
  // src/assets/profile.jpeg is deliberately NOT converted: it is rendered as a
  // large portrait on the Intro page, and a downscaled copy was visibly soft.
  // Intro.jsx imports the original .jpeg.
]

const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png'])

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

async function filesFor(job) {
  const abs = path.join(root, job.input)
  if (!existsSync(abs)) {
    console.warn(`skip (missing): ${job.input}`)
    return []
  }
  const info = await stat(abs)
  if (info.isFile()) return [abs]

  const entries = await readdir(abs, { withFileTypes: true })
  return entries
    .filter((e) => e.isFile() && SOURCE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(abs, e.name))
}

let totalBefore = 0
let totalAfter = 0
const rows = []

for (const job of JOBS) {
  for (const file of await filesFor(job)) {
    const out = file.replace(/\.(jpe?g|png)$/i, '.webp')
    await mkdir(path.dirname(out), { recursive: true })

    const before = (await stat(file)).size
    await sharp(file)
      // `withoutEnlargement` keeps an already-small source at its own size
      // instead of upscaling it into a bigger file.
      .resize({ width: job.maxWidth, withoutEnlargement: true })
      .webp({ quality: job.quality })
      .toFile(out)
    const after = (await stat(out)).size

    totalBefore += before
    totalAfter += after
    rows.push({
      file: path.relative(root, file).replace(/\\/g, '/'),
      before,
      after,
    })
  }
}

const width = Math.max(...rows.map((r) => r.file.length), 10)
for (const r of rows) {
  const saved = Math.round((1 - r.after / r.before) * 100)
  console.log(
    `${r.file.padEnd(width)}  ${fmt(r.before).padStart(9)} -> ${fmt(r.after).padStart(9)}  (-${saved}%)`
  )
}
console.log('-'.repeat(width + 34))
console.log(
  `${'TOTAL'.padEnd(width)}  ${fmt(totalBefore).padStart(9)} -> ${fmt(totalAfter).padStart(9)}  ` +
    `(-${Math.round((1 - totalAfter / totalBefore) * 100)}%)`
)
