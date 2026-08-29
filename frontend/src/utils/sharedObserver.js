/**
 * sharedObserver — one pooled IntersectionObserver per distinct options
 * signature, instead of every card/list-item on the page constructing its
 * own. Home page rails alone can mount 100+ cards; each used to spin up an
 * individual `new IntersectionObserver(...)` for a one-shot "reveal once
 * visible" effect. Callers ask for the same {threshold, rootMargin} pair, so
 * they now share the single observer registered for that pair.
 *
 * Semantics match what every caller already did by hand: observe once, fire
 * the callback the first time the target intersects, then stop watching it.
 */

const pool = new Map() // "threshold|rootMargin" -> { observer, callbacks: WeakMap<Element, Function> }

function keyFor({ threshold, rootMargin }) {
  return `${threshold}|${rootMargin}`
}

function getPoolEntry(options) {
  const key = keyFor(options)
  let entry = pool.get(key)
  if (!entry) {
    const callbacks = new WeakMap()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const cb = callbacks.get(entry.target)
        observer.unobserve(entry.target)
        callbacks.delete(entry.target)
        if (cb) cb()
      }
    }, options)
    entry = { observer, callbacks }
    pool.set(key, entry)
  }
  return entry
}

/**
 * Observe `el` once against a pooled observer for the given options.
 * Calls `callback` the first time it intersects, then stops watching it.
 * Returns an unsubscribe function — call it on unmount, same as you would
 * `observer.disconnect()` for a per-instance observer.
 */
export function observeOnce(el, callback, options = { threshold: 0.1, rootMargin: '0px 0px 100px 0px' }) {
  if (!el) return () => {}
  const { observer, callbacks } = getPoolEntry(options)
  callbacks.set(el, callback)
  observer.observe(el)
  return () => {
    observer.unobserve(el)
    callbacks.delete(el)
  }
}
