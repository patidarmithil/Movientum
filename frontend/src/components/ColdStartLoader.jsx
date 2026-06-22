import { useState, useEffect } from 'react'
import { motion } from 'motion/react'
import './ColdStartLoader.css'

const LOADING_PHRASES = [
  'Waking up backend database...',
  'Dimming the theater lights...',
  'Projecting the film reels...',
  'Waking up the projectionist...',
  'Warming up the cinematic engine...',
  'Popping the fresh popcorn...',
  'Retrieving recommendation signals...',
  'Initializing your cinematic space...'
]

export default function ColdStartLoader() {
  const [phraseIndex, setPhraseIndex] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length)
    }, 2800)
    
    // Lock scroll on mount
    document.body.style.overflow = 'hidden'
    
    return () => {
      clearInterval(timer)
      // Restore scroll on unmount
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <motion.div
      className="cold-start-loader"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── Background Aurora Blobs ── */}
      <div className="loader-aurora" aria-hidden="true">
        <div className="loader-blob loader-blob-1" />
        <div className="loader-blob loader-blob-2" />
        <div className="loader-blob loader-blob-3" />
      </div>

      <div className="loader-content">
        {/* Pulsing Brand Logo */}
        <div className="loader-logo">
          MOVI
          <span className="brand-name__e" aria-label="E">
            <span className="brand-name__e-bar brand-name__e-bar--top"></span>
            <span className="brand-name__e-bar brand-name__e-bar--mid"></span>
            <span className="brand-name__e-bar brand-name__e-bar--bot"></span>
          </span>
          NTUM
        </div>

        {/* High-tech scanning progress bar */}
        <div className="loader-progress-track">
          <div className="loader-progress-bar" />
        </div>

        {/* Staggered text cycling */}
        <div className="loader-text-container">
          <motion.p
            key={phraseIndex}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 0.8, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.5, ease: 'easeInOut' }}
            className="loader-text"
          >
            {LOADING_PHRASES[phraseIndex]}
          </motion.p>
        </div>
      </div>
    </motion.div>
  )
}
