/**
 * LazyMount — render children only once they are near the viewport.
 *
 * Purpose is request deferral, not layout: several detail-page sections fetch
 * their own data the moment they mount (news for this title, AI picks), and
 * those requests were competing with the page bundle for the browser's
 * connection budget while sitting well below the fold. Wrapping them here means
 * nothing is requested until the reader is actually scrolling toward them.
 *
 * `rootMargin` defaults to 400px so the section has started loading by the time
 * it is on screen — the reader should not see the deferral.
 *
 * Renders a `placeholder` (a plain spacer by default) until then, so the page
 * does not jump when the real section appears.
 */
import { useState, useEffect, useRef } from 'react'

export default function LazyMount({
  children,
  rootMargin = '400px',
  minHeight = 0,
  placeholder = null,
}) {
  // Browsers without IntersectionObserver (very old ones) render the section
  // straight away rather than hiding it forever — decided in the initializer so
  // the effect never has to set state synchronously.
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined')
  const ref = useRef(null)

  useEffect(() => {
    if (shown) return
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown, rootMargin])

  if (shown) return children

  return (
    <div ref={ref} style={minHeight ? { minHeight } : undefined} aria-hidden="true">
      {placeholder}
    </div>
  )
}
