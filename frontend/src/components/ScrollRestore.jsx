import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

// Routes that opt out of scroll restoration entirely.
//
// The landing page is a scroll narrative, not a list you come back to, so there
// is no position worth remembering. Restoration is also actively harmful there:
// the page sets `scroll-behavior: smooth`, so every window.scrollTo() below
// animates, and the restore loop below re-issues that call for up to 300 frames.
// Each call restarts the animation and fights whatever the reader is doing with
// the wheel, which reads as the page sticking on one section.
const NO_SCROLL_RESTORE = new Set(['/intro', '/about'])

// Restoration used to log on every debounced save and on every element it
// recovered. Those calls run while the reader is scrolling, and serialising a
// state object into the console on each one is real work in a production build.
// Kept for debugging, silent in production.
const log = (...args) => {
  if (import.meta.env.DEV) console.log('[ScrollRestore]', ...args)
}

// Events a script cannot synthesise, so any of them means the reader has taken
// over and every pending scroll correction must be abandoned. Deliberately not
// 'scroll': the restore loop's own `window.scrollTo` fires that, which would
// make the loop cancel itself on its first frame.
const USER_INPUT_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown']

export default function ScrollRestore() {
  const location = useLocation()
  const navigationType = useNavigationType() // 'PUSH', 'POP', or 'REPLACE'
  const scrollRegistry = useRef({}) // In-memory fallback if sessionStorage is slow
  const prevPathname = useRef(location.pathname)
  const skip = NO_SCROLL_RESTORE.has(location.pathname)

  // Use pathname + search to uniquely identify every URL state including parameters
  const getCacheKey = (loc) => `scroll_cache_${loc.pathname}${loc.search}`

  // 1. Capture-based scroll listener to continuously save the scroll position of window AND sub-elements
  useEffect(() => {
    if (skip) return
    let timeoutId
    const cacheKey = getCacheKey(location)
    
    // Initialize or retrieve current scroll state
    let scrollState = {
      window: window.scrollY,
      elements: {}
    }

    try {
      const saved = sessionStorage.getItem(cacheKey)
      if (saved) {
        const parsed = JSON.parse(saved)
        scrollState.window = parsed.window ?? 0
        scrollState.elements = parsed.elements ?? {}
      }
    } catch (e) {}

    // Cache element -> identifier so a dragged/auto-scrolled element (many
    // 'scroll' events per second) is never re-scanned via getElementsByClassName.
    const identifierCache = new WeakMap()

    const getIdentifier = (element) => {
      if (identifierCache.has(element)) return identifierCache.get(element)

      let identifier = element.id ? `#${element.id}` : ''
      if (!identifier && element.className) {
        const firstClass = element.className.split(' ').filter(Boolean)[0]
        if (firstClass) {
          const elements = Array.from(document.getElementsByClassName(firstClass))
          const index = elements.indexOf(element)
          if (index !== -1) {
            identifier = `.${firstClass}[${index}]`
          }
        }
      }
      if (!identifier) {
        const tagName = element.tagName.toLowerCase()
        const elements = Array.from(document.getElementsByTagName(tagName))
        const index = elements.indexOf(element)
        if (index !== -1) {
          identifier = `${tagName}[${index}]`
        }
      }

      identifierCache.set(element, identifier)
      return identifier
    }

    // rAF-throttle: a dragged/auto-scrolled row can fire dozens of 'scroll'
    // events per second, and running the full handler on each one is what
    // caused the visible stutter/lag while scrolling. One update per frame
    // is plenty for a position save.
    let rafId = null
    let pendingTargets = new Set()

    const flush = () => {
      rafId = null
      pendingTargets.forEach((target) => {
        const isWindow =
          target === document ||
          target === window ||
          target === document.documentElement ||
          target === document.body

        if (isWindow) {
          scrollState.window = window.scrollY
        } else {
          const identifier = getIdentifier(target)
          if (identifier) {
            scrollState.elements[identifier] = {
              scrollLeft: target.scrollLeft,
              scrollTop: target.scrollTop
            }
          }
        }
      })
      pendingTargets.clear()

      // Debounce writing to sessionStorage to avoid performance overhead
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(scrollState))
          scrollRegistry.current[cacheKey] = scrollState
          log(`saved ${location.pathname}${location.search}`, scrollState)
        } catch (err) {}
      }, 100)
    }

    const handleScroll = (e) => {
      pendingTargets.add(e.target)
      if (rafId === null) {
        rafId = requestAnimationFrame(flush)
      }
    }

    // Use capture phase to catch scroll events from individual sub-elements (scroll does not bubble)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true })
      clearTimeout(timeoutId)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [location, skip])

  // 2. Perform scroll restoration on location change (POP navigation only)
  useEffect(() => {
    if (skip) {
      // Still land at the top on arrival — just once, with no retry loop and no
      // saved position to chase.
      prevPathname.current = location.pathname
      window.scrollTo(0, 0)
      return
    }

    const cacheKey = getCacheKey(location)
    let savedData = null

    try {
      const saved = sessionStorage.getItem(cacheKey) || JSON.stringify(scrollRegistry.current[cacheKey])
      if (saved) {
        savedData = JSON.parse(saved)
      }
    } catch (e) {}

    const pathChanged = location.pathname !== prevPathname.current
    prevPathname.current = location.pathname

    if (navigationType === 'POP' && savedData) {
      const targetWindowScroll = savedData.window ?? 0
      const targetElementScrolls = savedData.elements ?? {}
      
      log(`POP to ${location.pathname}${location.search}: window -> ${targetWindowScroll}`, targetElementScrolls)

      let active = true
      let attempts = 0
      const maxAttempts = 300 // Try for ~5 seconds (300 frames at 60fps) to let async data fetch and render
      const restoredElements = new Set()
      // ~1.3 s at 60fps. Long enough for a row to mount and lay out, short
      // enough that a selector which will never resolve stops costing frames.
      const ELEMENT_CHASE_FRAMES = 80
      let windowDone = targetWindowScroll <= 20

      // The reader always outranks the restore loop.
      //
      // These are input events a script cannot produce, so seeing one means the
      // person has taken over — at which point continuing to call
      // `window.scrollTo(0, target)` every frame yanks them back and reads as the
      // page refusing to scroll. That was the bug: when the saved position could
      // not be reached (content still loading, or a saved sub-element no longer
      // in the DOM) the loop never satisfied its exit condition and kept
      // re-scrolling for the full five seconds while the reader fought it.
      const stop = () => {
        if (!active) return
        active = false
        for (const evt of USER_INPUT_EVENTS) {
          window.removeEventListener(evt, stop, { capture: true })
        }
      }
      for (const evt of USER_INPUT_EVENTS) {
        window.addEventListener(evt, stop, { capture: true, passive: true })
      }

      const restore = () => {
        if (!active) return

        // A. Restore window scroll position — but only until it lands. Re-issuing
        // the call after that is what fought the reader.
        if (!windowDone) {
          window.scrollTo(0, targetWindowScroll)
        }

        // B. Restore individual scrollable elements
        let allElementsRestored = true
        Object.entries(targetElementScrolls).forEach(([selector, coords]) => {
          if (restoredElements.has(selector)) return

          let element = null
          if (selector.startsWith('#')) {
            element = document.getElementById(selector.slice(1))
          } else if (selector.startsWith('.')) {
            // Selector format: .className[index]
            const match = selector.match(/^\.([^\[]+)\[(\d+)\]$/)
            if (match) {
              const className = match[1]
              const index = parseInt(match[2], 10)
              const elements = document.getElementsByClassName(className)
              element = elements[index]
            }
          } else {
            // Selector format: tagName[index]
            const match = selector.match(/^([^\[]+)\[(\d+)\]$/)
            if (match) {
              const tagName = match[1]
              const index = parseInt(match[2], 10)
              const elements = document.getElementsByTagName(tagName)
              element = elements[index]
            }
          }

          if (element) {
            if (coords.scrollLeft !== undefined) {
              element.scrollLeft = coords.scrollLeft
            }
            if (coords.scrollTop !== undefined) {
              element.scrollTop = coords.scrollTop
            }

            // Verify if scroll position has successfully been set (clamped boundaries check)
            const checkLeft = coords.scrollLeft === 0 || Math.abs(element.scrollLeft - coords.scrollLeft) < 5
            const checkTop = coords.scrollTop === 0 || Math.abs(element.scrollTop - coords.scrollTop) < 5

            if (checkLeft && checkTop) {
              restoredElements.add(selector)
              log(`restored ${selector} -> left=${element.scrollLeft} top=${element.scrollTop}`)
            } else {
              allElementsRestored = false
            }
          } else {
            allElementsRestored = false
          }
        })

        // Check if both window scroll and element scrolls are complete
        const isAtBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5
        if (!windowDone &&
            (Math.abs(window.scrollY - targetWindowScroll) < 10 || isAtBottom)) {
          windowDone = true
        }
        const allRestored = windowDone && allElementsRestored

        if (allRestored) {
          log(`complete on attempt ${attempts + 1}`)
          stop()
          return
        }

        // A saved sub-element that no longer exists — a row that was removed, or
        // an index that now points at a different node — can never be restored,
        // so element chasing gets its own short budget. Without it the loop ran
        // the full five seconds on every such page.
        if (windowDone && attempts >= ELEMENT_CHASE_FRAMES) {
          log(`giving up on unrestored elements after ${attempts} frames`)
          stop()
          return
        }

        if (attempts < maxAttempts) {
          attempts++
          requestAnimationFrame(restore)
        } else {
          log(`loop finished after ${maxAttempts} attempts`, Array.from(restoredElements))
          stop()
        }
      }

      // Start the restoration loop after a small delay to let React components mount
      const startTimeout = setTimeout(() => {
        requestAnimationFrame(restore)
      }, 50)

      return () => {
        stop()
        clearTimeout(startTimeout)
      }
    } else {
      // PUSH/REPLACE navigation or no saved data -> reset to top ONLY if push or path changed
      if (navigationType === 'PUSH' || pathChanged) {
        log(`${navigationType} to ${location.pathname}${location.search}: scrolling to top`)
        window.scrollTo(0, 0)
        // Two follow-ups, because content mounting after the first frame can
        // shift the document. Both are cancelled if the reader scrolls first —
        // otherwise a fast scroll right after landing gets snapped back to top.
        let cancelled = false
        const cancel = () => {
          cancelled = true
          for (const evt of USER_INPUT_EVENTS) {
            window.removeEventListener(evt, cancel, { capture: true })
          }
        }
        for (const evt of USER_INPUT_EVENTS) {
          window.addEventListener(evt, cancel, { capture: true, passive: true })
        }
        const raf = requestAnimationFrame(() => {
          if (cancelled) return
          window.scrollTo(0, 0)
        })
        const t = setTimeout(() => {
          if (!cancelled) window.scrollTo(0, 0)
          cancel()
        }, 50)

        return () => {
          cancel()
          cancelAnimationFrame(raf)
          clearTimeout(t)
        }
      } else {
        log(`${navigationType} to ${location.pathname}${location.search}: keeping position`)
      }
    }
  }, [location, navigationType, skip])

  return null
}
