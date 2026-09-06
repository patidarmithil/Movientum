/**
 * Locally uploaded tile images.
 *
 * A tier list is not always made of films. Somebody ranking their own screenshots,
 * album art or photos needs to bring the pictures with them, and there is no server
 * side to this: the app has no image host, and putting a base64 image in the board
 * payload would blow past the 300-character cap the save schema puts on `image`.
 *
 * So an upload is stored in IndexedDB on the device that made it, and the board only
 * ever carries the short reference `upload:<key>`. The consequence is worth stating
 * plainly in the UI: an uploaded picture travels with the browser, not with the
 * board, so a shared link shows the title text in its place.
 *
 * Pictures are downscaled to POSTER_MAX_W before they are stored — a phone photo is
 * several megabytes and a tile is under 100 pixels wide, so the full file would cost
 * the quota for nothing.
 */

const DB_NAME = 'movientum_tier'
const STORE = 'uploads'
const POSTER_MAX_W = 600
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Resolved data URLs, so a tile can look one up while it renders. */
const registry = new Map()

export const UPLOAD_PREFIX = 'upload:'

export function isUploadRef(path) {
  return typeof path === 'string' && path.startsWith(UPLOAD_PREFIX)
}

/** The data URL for an `upload:` reference, or null when this device has never seen it. */
export function uploadUrl(ref) {
  return registry.get(ref) || null
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE)
}

/** Store one image and make it available to the tiles immediately. */
export async function putUpload(ref, dataUrl) {
  registry.set(ref, dataUrl)
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const req = tx(db, 'readwrite').put(dataUrl, ref)
      req.onsuccess = resolve
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Private mode, or the quota is full. The picture still works for this session;
    // it simply will not be there next time.
  }
}

/**
 * Pull every reference a board uses into the registry.
 *
 * Called once while the board loads, so the first paint already has the pictures
 * and no tile has to re-render when they arrive.
 */
export async function hydrateUploads(refs) {
  const wanted = [...new Set(refs.filter(isUploadRef))].filter((r) => !registry.has(r))
  if (!wanted.length) return
  try {
    const db = await openDb()
    const store = tx(db, 'readonly')
    await Promise.all(
      wanted.map(
        (ref) =>
          new Promise((resolve) => {
            const req = store.get(ref)
            req.onsuccess = () => {
              if (req.result) registry.set(ref, req.result)
              resolve()
            }
            req.onerror = () => resolve()
          })
      )
    )
  } catch {
    /* nothing stored on this device — tiles fall back to their titles */
  }
}

/**
 * Read one file into a downscaled JPEG data URL.
 *
 * Same shape as the avatar upload: reject anything that is not an image or is over
 * five megabytes before doing any work on it.
 */
export function fileToTileImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`${file.name} is not an image`))
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error(`${file.name} is over 5MB`))
      return
    }

    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error(`Could not read ${file.name}`))
      img.onload = () => {
        const scale = Math.min(1, POSTER_MAX_W / img.naturalWidth)
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d').drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

/** Unique enough for a device-local key, and short enough for the 300-char cap. */
export function newUploadRef() {
  return `${UPLOAD_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}
