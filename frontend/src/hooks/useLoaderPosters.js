import { useEffect, useMemo, useState } from 'react'
import { FALLBACK_POSTERS } from '../data/loaderPosters'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MIN_POOL_SIZE = 12
const REVEAL_DEADLINE_MS = 1200

function mulberry32(seed) {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seededShuffle(arr, seed) {
  const rand = mulberry32(seed)
  const result = [...arr]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function readCachedPosters() {
  try {
    const raw = localStorage.getItem('mv_loader_posters')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (
      parsed?.v === 1 &&
      Array.isArray(parsed.paths) &&
      parsed.paths.length >= MIN_POOL_SIZE &&
      Date.now() - parsed.t < MAX_AGE_MS
    ) {
      return parsed.paths
    }
  } catch {
    /* corrupt value — fall through to next tier */
  }
  return null
}

function buildColumnData(posters, columns) {
  const pool = [...new Set(posters)]
  if (pool.length < MIN_POOL_SIZE) return null

  const seed = Math.floor(Date.now() / 86400000)
  const shuffled = seededShuffle(pool, seed)

  const cols = Array.from({ length: columns }, () => [])
  shuffled.forEach((p, i) => cols[i % columns].push(p))

  const target = Math.max(...cols.map((c) => c.length))
  cols.forEach((col) => {
    while (col.length < target) col.push(col[col.length % target])
  })

  return cols.map((col) => [...col, ...col])
}

/**
 * useLoaderPosters(columns)
 *
 * Resolves the poster list for ColdStartLoader's poster wall and preloads a quorum
 * of images before signalling that it is safe to reveal.
 *
 * Returns: { columnData: string[][] | null, ready: boolean }
 *   columnData — already dealt into columns AND duplicated for the seamless loop
 *   ready      — true once the quorum decoded OR the 1200ms deadline elapsed
 */
export function useLoaderPosters(columns) {
  const [ready, setReady] = useState(false)

  const columnData = useMemo(() => {
    const cached = readCachedPosters()
    const posters = cached || FALLBACK_POSTERS
    return buildColumnData(posters, columns)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns])

  useEffect(() => {
    if (!columnData) {
      setReady(true)
      return
    }

    let cancelled = false
    const flat = columnData.flat()
    const quorum = Math.min(8, Math.ceil(flat.length / 3))
    const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

    const decodes = flat.slice(0, quorum).map((path) => {
      const img = new Image()
      img.src = `${TMDB_IMAGE_BASE}/w185${path}`
      return img.decode ? img.decode().catch(() => {}) : Promise.resolve()
    })

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    Promise.race([Promise.allSettled(decodes), sleep(REVEAL_DEADLINE_MS)]).then(() => {
      if (!cancelled) setReady(true)
    })

    return () => { cancelled = true }
  }, [columnData])

  return { columnData, ready }
}
