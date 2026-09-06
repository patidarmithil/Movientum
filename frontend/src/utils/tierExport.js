import { isUploadRef, uploadUrl } from './tierUploads'

/**
 * Render a tier board to a PNG.
 *
 * Drawn onto a canvas by hand rather than with a DOM-screenshot library. TMDB's image
 * CDN sends `Access-Control-Allow-Origin: *`, so posters loaded with crossOrigin
 *="anonymous" leave the canvas untainted and toBlob works — which means no extra
 * dependency, and a layout that is laid out for sharing instead of for the screen.
 */

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

const TILE = {
  poster: { w: 92, h: 138, size: 'w185' },
  profile: { w: 92, h: 138, size: 'w185' },
  still: { w: 160, h: 90, size: 'w300' },
}

const LABEL_W = 108
const PAD = 8
const BOARD_COLS = 10
const BG = '#0C0C0E'
const ROW_BG = '#121216'
const RULE = 'rgba(255,255,255,0.08)'
const INK = '#0C0C0E'
const MUTED = '#8A8A96'
/** Lives in frontend/public, so it is same-origin and never taints the canvas. */
const LOGO_SRC = '/logo.png'

/**
 * Loads one poster in CORS mode, resolving to null instead of rejecting so a single
 * dead image cannot take down the whole export.
 *
 * The query string is not decoration. Every poster on the page is fetched plain, and
 * a browser will happily serve that cached copy — which carries no CORS headers — to
 * a crossOrigin request, which then fails and taints the canvas. Asking for a URL the
 * cache has never seen guarantees a fresh response with the headers on it. TMDB
 * ignores the parameter; the plain URL stays as a fallback for a cold cache.
 */
function loadImage(path, size) {
  if (!path) return Promise.resolve(null)
  // An uploaded tile is already a data URL on this device: same-origin, no CORS
  // dance, and nothing to fetch.
  if (isUploadRef(path)) {
    const stored = uploadUrl(path)
    return stored ? loadLocalImage(stored) : Promise.resolve(null)
  }
  const url = `${TMDB_IMAGE_BASE}/${size}${path}`

  const attempt = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })

  return attempt(`${url}?cors=1`).catch(() => attempt(url)).catch(() => null)
}

/**
 * Loads a same-origin asset (the logo). Kept separate from loadImage because it
 * takes a whole URL rather than a TMDB path, and needs no CORS dance — but it
 * resolves to null on failure just the same, so a missing file cannot stop the
 * export from finishing.
 */
function loadLocalImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Cover-fit: fill the tile, crop the overflow, never letterbox. */
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height)
  const dw = img.width * scale
  const dh = img.height * scale
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
  ctx.restore()
}

function fitLabel(ctx, text, maxWidth, startPx) {
  let px = startPx
  ctx.font = `800 ${px}px Outfit, system-ui, sans-serif`
  while (px > 11 && ctx.measureText(text).width > maxWidth) {
    px -= 1
    ctx.font = `800 ${px}px Outfit, system-ui, sans-serif`
  }
  return px
}

/**
 * @param {{title:string, tile:string, rows:Array, binItems:Array}} board
 *   rows: [{ label, color, items: [{name, image}] }]
 * @returns {Promise<Blob>}
 */
export async function renderBoardToBlob(board) {
  const spec = TILE[board.tile] || TILE.poster
  const cols = board.tile === 'still' ? 7 : BOARD_COLS
  const boardW = cols * (spec.w + PAD) + PAD

  // Fonts have to be resolved before measuring, or the first export gets the
  // fallback metrics and the labels sit wrong.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready } catch { /* non-fatal */ }
  }

  const rows = board.rows.map((row) => {
    const lines = Math.max(1, Math.ceil(row.items.length / cols))
    return { ...row, lines, height: lines * (spec.h + PAD) + PAD }
  })

  const headerH = 64
  const footerH = 64
  const bodyH = rows.reduce((sum, r) => sum + r.height, 0)
  const width = LABEL_W + boardW
  const height = headerH + bodyH + footerH

  const dpr = Math.min(2, window.devicePixelRatio || 1) * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'middle'

  ctx.fillStyle = BG
  ctx.fillRect(0, 0, width, height)

  // Header
  ctx.fillStyle = '#FFFFFF'
  const titlePx = fitLabel(ctx, board.title, width - 32, 26)
  ctx.font = `800 ${titlePx}px Outfit, system-ui, sans-serif`
  ctx.textAlign = 'left'
  ctx.fillText(board.title, 16, headerH / 2 + 2)

  // Preload every image in one pass so the draw loop is synchronous.
  const allItems = rows.flatMap((r) => r.items)
  const images = await Promise.all(allItems.map((it) => loadImage(it.image, spec.size)))
  const imageFor = new Map()
  allItems.forEach((it, i) => imageFor.set(it, images[i]))

  let y = headerH
  for (const row of rows) {
    ctx.fillStyle = ROW_BG
    ctx.fillRect(LABEL_W, y, boardW, row.height)

    ctx.fillStyle = row.color
    ctx.fillRect(0, y, LABEL_W, row.height)

    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    const px = fitLabel(ctx, row.label, LABEL_W - 16, 34)
    ctx.font = `800 ${px}px Outfit, system-ui, sans-serif`
    ctx.fillText(row.label, LABEL_W / 2, y + row.height / 2)

    row.items.forEach((item, i) => {
      const cx = LABEL_W + PAD + (i % cols) * (spec.w + PAD)
      const cy = y + PAD + Math.floor(i / cols) * (spec.h + PAD)
      const img = imageFor.get(item)
      if (img) {
        drawCover(ctx, img, cx, cy, spec.w, spec.h)
      } else {
        ctx.fillStyle = '#22222A'
        ctx.fillRect(cx, cy, spec.w, spec.h)
        ctx.fillStyle = MUTED
        ctx.textAlign = 'center'
        ctx.font = '600 10px Inter, system-ui, sans-serif'
        ctx.fillText(item.name.slice(0, 18), cx + spec.w / 2, cy + spec.h / 2)
      }
    })

    ctx.strokeStyle = RULE
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y + row.height - 0.5)
    ctx.lineTo(width, y + row.height - 0.5)
    ctx.stroke()

    y += row.height
  }

  // Footer: the mark sits bottom-right so it reads as a signature on the board
  // rather than a caption under it. The licence line covers the ranking itself —
  // the poster art stays TMDB's.
  const logo = await loadLocalImage(LOGO_SRC)
  const footerMid = y + footerH / 2

  ctx.textAlign = 'right'
  ctx.fillStyle = '#FFFFFF'
  ctx.font = '700 13px Outfit, system-ui, sans-serif'
  ctx.fillText('movientum.vercel.app', width - 16, footerMid - 9)

  ctx.fillStyle = MUTED
  ctx.font = '500 11px Inter, system-ui, sans-serif'
  ctx.fillText('CC BY 4.0 · rankings by Movientum · art by TMDB', width - 16, footerMid + 9)

  if (logo) {
    const lh = 30
    const lw = Math.round((logo.width / logo.height) * lh) || lh
    const textW = Math.max(
      ctx.measureText('CC BY 4.0 · rankings by Movientum · art by TMDB').width,
      140
    )
    ctx.drawImage(logo, width - 16 - textW - 10 - lw, footerMid - lh / 2, lw, lh)
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not render the image'))),
      'image/png'
    )
  })
}

/** Renders and hands the file to the browser. Returns nothing; throws on failure. */
export async function downloadBoard(board) {
  const blob = await renderBoardToBlob(board)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${board.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'tier-list'}.png`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
