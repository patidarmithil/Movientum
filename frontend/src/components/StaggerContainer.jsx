import React, { useState, useEffect, useRef } from 'react'

export default function StaggerContainer({ children, className = '', instant = false, ...rest }) {
  const [hasIntersected, setHasIntersected] = useState(instant)
  const containerRef = useRef(null)

  useEffect(() => {
    if (instant) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHasIntersected(true)
          observer.disconnect()
        }
      },
      { threshold: 0.05, rootMargin: '60px' }
    )

    const el = containerRef.current
    if (el) {
      observer.observe(el)
    }

    return () => {
      observer.disconnect()
    }
  }, [instant])

  return (
    <div
      ref={containerRef}
      className={`stagger-container ${hasIntersected ? 'stagger-container--visible' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export function StaggerItem({ children, index = 0, className = '', style = {}, ...rest }) {
  // Cap stagger delay at 12 items to ensure loading transitions remain fast
  const delay = `${(index % 12) * 50}ms`
  
  return (
    <div
      className={`stagger-item-wrap ${className}`}
      style={{
        animationDelay: delay,
        width: '100%',
        ...style
      }}
      {...rest}
    >
      {children}
    </div>
  )
}
