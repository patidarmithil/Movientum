import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { FUN_FACTS } from '../data/funFacts'
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
  const [factIndex, setFactIndex] = useState(() => Math.floor(Math.random() * FUN_FACTS.length))

  useEffect(() => {
    const phraseTimer = setInterval(() => {
      setPhraseIndex((prev) => (prev + 1) % LOADING_PHRASES.length)
    }, 2800)

    const factTimer = setInterval(() => {
      setFactIndex((prevIndex) => {
        let newIndex = prevIndex
        while (newIndex === prevIndex) {
          newIndex = Math.floor(Math.random() * FUN_FACTS.length)
        }
        return newIndex
      })
    }, 4500)
    
    return () => {
      clearInterval(phraseTimer)
      clearInterval(factTimer)
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
          <AnimatePresence mode="wait">
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
          </AnimatePresence>
        </div>

        {/* Cinema Trivia Fun Fact Box */}
        <div className="loader-fun-fact-container">
          <div className="loader-fun-fact-header">
            <svg className="loader-fun-fact-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span className="loader-fun-fact-label">Cinema Trivia</span>
          </div>
          <div className="loader-fun-fact-text-wrapper">
            <AnimatePresence mode="wait">
              <motion.p
                key={factIndex}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 0.9, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.6, ease: 'easeInOut' }}
                className="loader-fun-fact-text"
              >
                {FUN_FACTS[factIndex]}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

