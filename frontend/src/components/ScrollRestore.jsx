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

    const handleScroll = (e) => {
      const isWindow = 
        e.target === document || 
        e.target === window || 
        e.target === document.documentElement || 
        e.target === document.body

      if (isWindow) {
        scrollState.window = window.scrollY
      } else {
        const element = e.target
        
        // Generate a unique selector/identifier for the scrolled element
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

        if (identifier) {
          scrollState.elements[identifier] = {
            scrollLeft: element.scrollLeft,
            scrollTop: element.scrollTop
          }
        }
      }

      // Debounce writing to sessionStorage to avoid performance overhead
      clearTimeout(timeoutId)
      timeoutId = setTimeout(() => {
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify(scrollState))
          scrollRegistry.current[cacheKey] = scrollState
          console.log(`[ScrollRestore] Saved scroll state for ${location.pathname}${location.search}:`, scrollState)
        } catch (err) {}
      }, 100)
    }

    // Use capture phase to catch scroll events from individual sub-elements (scroll does not bubble)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll, { capture: true })
      clearTimeout(timeoutId)
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
      
      console.log(`[ScrollRestore] POP navigation to ${location.pathname}${location.search}. Restoring window to ${targetWindowScroll} and sub-elements:`, targetElementScrolls)

      let active = true
      let attempts = 0
      const maxAttempts = 300 // Try for ~5 seconds (300 frames at 60fps) to let async data fetch and render
      const restoredElements = new Set()

      const restore = () => {
        if (!active) return

        // A. Restore window scroll position
        if (targetWindowScroll > 20) {
          const currentHeight = document.documentElement.scrollHeight
          const maxScrollable = currentHeight - window.innerHeight
          
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
              console.log(`[ScrollRestore] Successfully restored element ${selector} to left=${element.scrollLeft}, top=${element.scrollTop}`)
            } else {
              allElementsRestored = false
            }
          } else {
            allElementsRestored = false
          }
        })

        // Check if both window scroll and element scrolls are complete
        const isAtBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 5
        const windowRestored = targetWindowScroll <= 20 || Math.abs(window.scrollY - targetWindowScroll) < 10 || isAtBottom
        const allRestored = windowRestored && allElementsRestored

        if (allRestored) {
          console.log(`[ScrollRestore] Full restoration complete for window and elements on attempt ${attempts + 1}`)
          return
        }

        if (attempts < maxAttempts) {
          attempts++
          requestAnimationFrame(restore)
        } else {
          console.warn(`[ScrollRestore] Restoration loop finished after ${maxAttempts} attempts. Restored elements:`, Array.from(restoredElements))
        }
      }

      // Start the restoration loop after a small delay to let React components mount
      const startTimeout = setTimeout(() => {
        requestAnimationFrame(restore)
      }, 50)

      return () => {
        active = false
        clearTimeout(startTimeout)
      }
    } else {
      // PUSH/REPLACE navigation or no saved data -> reset to top ONLY if push or path changed
      if (navigationType === 'PUSH' || pathChanged) {
        console.log(`[ScrollRestore] ${navigationType} navigation to ${location.pathname}${location.search} (path changed: ${pathChanged}). Scrolling to top.`)
        window.scrollTo(0, 0)
        requestAnimationFrame(() => {
          window.scrollTo(0, 0)
          setTimeout(() => window.scrollTo(0, 0), 50)
        })
      } else {
        console.log(`[ScrollRestore] ${navigationType} navigation to ${location.pathname}${location.search} (path changed: ${pathChanged}). Keeping scroll position.`)
      }
    }
  }, [location, navigationType, skip])

  return null
}
