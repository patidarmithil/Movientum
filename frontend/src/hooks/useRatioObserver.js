import { useEffect, useRef } from 'react'

const THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100)

export function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// Observes one or more elements with a 101-step threshold array and calls
// onRatio(entry, ratio) on every intersection change. No-ops the callback
// under prefers-reduced-motion unless `always` is passed (needed for things
// like the rail indicator, which must keep working with motion off).
export function useRatioObserver(onRatio, { always = false } = {}) {
  const observerRef = useRef(null)
  const callbackRef = useRef(onRatio)
  callbackRef.current = onRatio

  useEffect(() => {
    const reduced = prefersReducedMotion()
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (reduced && !always) return
        callbackRef.current(entry, entry.intersectionRatio)
      })
    }, { threshold: THRESHOLDS })

    return () => observerRef.current?.disconnect()
  }, [always])

  return observerRef
}
