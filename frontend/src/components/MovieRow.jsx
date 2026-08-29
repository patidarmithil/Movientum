import { useState, useEffect, useRef, useCallback } from 'react'
import { Link } from 'react-router-dom'
import MovieCard from './MovieCard'
import MovieCardSkeleton from './MovieCardSkeleton'
import ShinyText from './ShinyText'
import StaggerContainer, { StaggerItem } from './StaggerContainer'
import ScrollReveal from './ScrollReveal'
import { observeOnce } from '../utils/sharedObserver'
import './MovieRow.css'

const REVEAL_OBSERVER_OPTIONS = { threshold: 0.05, rootMargin: '0px 100px 0px 100px' }

function ViewportRevealCard({ movie, index, showFeedback, feedbackSource, renderCard }) {
  const [isVisible, setIsVisible] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    return observeOnce(el, () => setIsVisible(true), REVEAL_OBSERVER_OPTIONS)
  }, [])

  const delay = isVisible ? `${(index % 8) * 40}ms` : '0ms'

  return (
    <div
      ref={cardRef}
      className={`viewport-reveal-card ${isVisible ? 'visible' : ''}`}
      style={{ transitionDelay: delay }}
    >
      {renderCard ? renderCard(movie) : <MovieCard movie={movie} showFeedback={showFeedback} feedbackSource={feedbackSource} />}
    </div>
  )
}

export default function MovieRow({
  title,
  movies = [],
  loading = false,
  seeAllHref = '/movies',
  premiumScroll = false,
  showFeedback = false,
  feedbackSource = 'other',
  emptyText = 'No titles found.',
  renderCard,
  children,
  icon
}) {
  const scrollRowRef = useRef(null)
  const containerRef = useRef(null)

  // Dragging state refs
  const isDown = useRef(false)
  const startX = useRef(0)
  const scrollLeftStart = useRef(0)
  const velocity = useRef(0)
  const lastClientX = useRef(0)
  const lastTimestamp = useRef(0)
  const isDragging = useRef(false)
  const animationFrameId = useRef(null)

  // Auto-scrolling state refs
  const autoScrollSpeed = useRef(0)
  const autoScrollFrameId = useRef(null)

  // UI state for edge fades
  const [leftFadeOpacity, setLeftFadeOpacity] = useState(0)
  const [rightFadeOpacity, setRightFadeOpacity] = useState(1)

  const [highlightForYou, setHighlightForYou] = useState(false)

  useEffect(() => {
    if (title === "For You 🎯") {
      const handleHighlight = (e) => {
        setHighlightForYou(e.detail)
      }
      window.addEventListener('mv:highlightForYouSeeAll', handleHighlight)
      return () => window.removeEventListener('mv:highlightForYouSeeAll', handleHighlight)
    }
  }, [title])

  // Track progress and fades
  const updateScrollStats = useCallback(() => {
    const el = scrollRowRef.current
    if (!el) return
    const scrollLeft = el.scrollLeft
    const maxScroll = el.scrollWidth - el.clientWidth

    // Dynamic edge fades
    const fadeDistance = 60
    setLeftFadeOpacity(Math.min(scrollLeft / fadeDistance, 1))
    setRightFadeOpacity(maxScroll <= 0 ? 0 : Math.min((maxScroll - scrollLeft) / fadeDistance, 1))
  }, [])

  // Listen to scroll to update fades
  useEffect(() => {
    if (!premiumScroll) return

    const el = scrollRowRef.current
    if (!el) return

    const onScroll = () => {
      updateScrollStats()
    }

    el.addEventListener('scroll', onScroll)
    updateScrollStats() // Initial check

    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [premiumScroll, movies, updateScrollStats])

  // Drag block click capturing
  useEffect(() => {
    if (!premiumScroll) return

    const el = scrollRowRef.current
    if (!el) return

    const handleCaptureClick = (e) => {
      if (isDragging.current) {
        e.preventDefault()
        e.stopPropagation()
        // Reset dragging in next event loop cycle so clicks can function normally
        setTimeout(() => {
          isDragging.current = false
        }, 0)
      }
    }

    el.addEventListener('click', handleCaptureClick, true)
    return () => {
      el.removeEventListener('click', handleCaptureClick, true)
    }
  }, [premiumScroll])

  // Inertia and snapping scroll check
  const checkSnap = () => {
    const el = scrollRowRef.current
    if (!el) return

    const childrenList = Array.from(el.children)
    if (childrenList.length === 0) return

    const viewportWidth = el.offsetWidth
    const viewportCenter = el.scrollLeft + viewportWidth / 2

    let nearestChild = null
    let minDistance = Infinity

    childrenList.forEach((child) => {
      const childCenter = child.offsetLeft + child.offsetWidth / 2
      const distance = Math.abs(viewportCenter - childCenter)
      if (distance < minDistance) {
        minDistance = distance
        nearestChild = child
      }
    })

    if (nearestChild) {
      const targetScrollLeft = nearestChild.offsetLeft + nearestChild.offsetWidth / 2 - viewportWidth / 2
      el.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth'
      })
    }
  }

  const applyInertia = () => {
    const el = scrollRowRef.current
    if (!el) return

    const friction = 0.965
    let currentVelocity = velocity.current * 30 // Scale velocity factor

    const step = () => {
      if (Math.abs(currentVelocity) < 0.2 || isDown.current) {
        checkSnap()
        return
      }
      el.scrollLeft -= currentVelocity
      currentVelocity *= friction
      animationFrameId.current = requestAnimationFrame(step)
    }
    animationFrameId.current = requestAnimationFrame(step)
  }

  // Drag handlers
  const handleMouseDown = (e) => {
    if (!premiumScroll || !scrollRowRef.current) return
    isDown.current = true
    isDragging.current = false
    startX.current = e.pageX - scrollRowRef.current.offsetLeft
    scrollLeftStart.current = scrollRowRef.current.scrollLeft
    lastClientX.current = e.clientX
    lastTimestamp.current = Date.now()
    velocity.current = 0
    cancelAnimationFrame(animationFrameId.current)
  }

  const handleMouseMove = (e) => {
    if (!premiumScroll || !isDown.current || !scrollRowRef.current) return
    const currentTimestamp = Date.now()
    const timeDelta = currentTimestamp - lastTimestamp.current
    const clientX = e.clientX
    const xDelta = clientX - lastClientX.current

    if (timeDelta > 0) {
      velocity.current = xDelta / timeDelta
    }

    lastClientX.current = clientX
    lastTimestamp.current = currentTimestamp

    const x = e.pageX - scrollRowRef.current.offsetLeft
    const walk = (x - startX.current) * 2.2

    if (Math.abs(walk) > 5) {
      isDragging.current = true
    }

    scrollRowRef.current.scrollLeft = scrollLeftStart.current - walk
  }

  const handleMouseUpOrLeave = () => {
    if (!premiumScroll || !isDown.current) return
    isDown.current = false
    if (isDragging.current && Math.abs(velocity.current) > 0.05) {
      applyInertia()
    } else {
      checkSnap()
    }
  }

  // Edge auto-scroll loop handlers
  const handleContainerMouseMove = (e) => {
    if (!premiumScroll || isDown.current) {
      autoScrollSpeed.current = 0
      return
    }
    const container = containerRef.current
    const scrollRow = scrollRowRef.current
    if (!container || !scrollRow) return

    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const width = rect.width
    const threshold = 80 // px from edge

    if (mouseX < threshold) {
      const intensity = (threshold - mouseX) / threshold
      autoScrollSpeed.current = -3.5 * intensity
    } else if (mouseX > width - threshold) {
      const intensity = (mouseX - (width - threshold)) / threshold
      autoScrollSpeed.current = 3.5 * intensity
    } else {
      autoScrollSpeed.current = 0
    }

    if (autoScrollSpeed.current !== 0 && !autoScrollFrameId.current) {
      startAutoScrollLoop()
    }
  }

  const handleContainerMouseLeave = () => {
    autoScrollSpeed.current = 0
  }

  const startAutoScrollLoop = () => {
    const scrollRow = scrollRowRef.current
    if (!scrollRow) return

    const step = () => {
      if (autoScrollSpeed.current === 0 || isDown.current) {
        autoScrollFrameId.current = null
        return
      }
      scrollRow.scrollLeft += autoScrollSpeed.current
      autoScrollFrameId.current = requestAnimationFrame(step)
    }
    autoScrollFrameId.current = requestAnimationFrame(step)
  }

  // Cleanup loops on unmount
  useEffect(() => {
    return () => {
      cancelAnimationFrame(animationFrameId.current)
      cancelAnimationFrame(autoScrollFrameId.current)
    }
  }, [])

  return (
    <ScrollReveal className={`movie-row section-sm ${premiumScroll ? 'trending-premium-row' : ''}`}>
      <div className="section-header">
        <div className="section-header-left">
          <h2 style={{ display: 'flex', alignItems: 'center' }}>
            {icon && <span style={{ display: 'flex', alignItems: 'center', marginRight: '8px' }}>{icon}</span>}
            <ShinyText text={title} />
          </h2>
        </div>
        <Link to={seeAllHref} className={`see-all-link${highlightForYou ? ' see-all-link--highlighted' : ''}`}>See all →</Link>
      </div>

      {children && <div className="movie-row__pills-container">{children}</div>}

      <div
        ref={containerRef}
        className="scroll-row-container"
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={handleContainerMouseLeave}
      >
        <div
          className="scroll-row-fade left-fade"
          style={premiumScroll ? { opacity: leftFadeOpacity } : undefined}
        ></div>

        {premiumScroll ? (
          <div
            ref={scrollRowRef}
            className="scroll-row"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUpOrLeave}
            onMouseLeave={handleMouseUpOrLeave}
            style={{ cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none' }}
          >
            {loading ? (
              <MovieCardSkeleton count={6} />
            ) : movies.length === 0 ? (
              <p className="no-movies-text">{emptyText}</p>
            ) : (
              movies.map((m, index) => (
                <ViewportRevealCard
                  key={`${m.id}-${m.media_type || 'movie'}`}
                  index={index}
                  movie={m}
                  showFeedback={showFeedback}
                  feedbackSource={feedbackSource}
                  renderCard={renderCard}
                />
              ))
            )}
          </div>
        ) : (
          <StaggerContainer key={`${title}-${loading}-${movies.length}`} className="scroll-row">
            {loading ? (
              <MovieCardSkeleton count={6} />
            ) : movies.length === 0 ? (
              <p className="no-movies-text">{emptyText}</p>
            ) : (
              movies.map((m, index) => (
                <StaggerItem key={`${m.id}-${m.media_type || 'movie'}`} index={index}>
                  {renderCard ? renderCard(m) : <MovieCard movie={m} showFeedback={showFeedback} feedbackSource={feedbackSource} />}
                </StaggerItem>
              ))
            )}
          </StaggerContainer>
        )}

        <div
          className="scroll-row-fade right-fade"
          style={premiumScroll ? { opacity: rightFadeOpacity } : undefined}
        ></div>
      </div>
    </ScrollReveal>
  )
}
