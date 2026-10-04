import { motion, useReducedMotion } from 'motion/react'
import { useMediaQuery } from '../hooks/useMediaQuery'

const WRAPPER_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  width: '100%',
  minHeight: '100%',
  position: 'relative'
}

// Desktop: short fade + rise. Phones: AnimatePresence runs in mode="wait", so any
// exit animation is dead time before the next page can mount — on a phone that
// read as lag. There the old page leaves instantly and the new one only fades.
const DESKTOP = {
  initial: { opacity: 0, y: 15 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -15 },
  transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] },
}
const MOBILE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 1, transition: { duration: 0 } },
  transition: { duration: 0.15, ease: 'easeOut' },
}
const STATIC = {
  initial: false,
  animate: { opacity: 1 },
  exit: { opacity: 1, transition: { duration: 0 } },
  transition: { duration: 0 },
}

export default function PageTransition({ children }) {
  const isMobile = useMediaQuery('(max-width: 768px)')
  const reduced = useReducedMotion()
  const motionProps = reduced ? STATIC : isMobile ? MOBILE : DESKTOP

  return (
    <motion.div
      {...motionProps}
      className="page-transition-wrapper"
      style={WRAPPER_STYLE}
    >
      {children}
    </motion.div>
  )
}
