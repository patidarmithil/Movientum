/**
 * fireBurst — small particle-burst micro-interaction for confirmed actions
 * (mark watched, plan to watch, add to watchlist). Purely visual, no
 * network/state side effects. Skipped entirely under prefers-reduced-motion.
 */

const COLORS = ['#a855f7', '#22d3ee', '#f43f5e', '#facc15']
const PARTICLE_COUNT = 14
const LIFETIME_MS = 640

export function fireBurst(target) {
  if (!target || typeof window === 'undefined' || typeof document === 'undefined') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

  const rect = target.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  const layer = document.createElement('div')
  layer.className = 'burst-layer'
  layer.style.left = `${cx}px`
  layer.style.top = `${cy}px`

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const dot = document.createElement('span')
    dot.className = 'burst-dot'
    const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() * 0.5 - 0.25)
    const distance = 42 + Math.random() * 32
    const dx = Math.cos(angle) * distance
    const dy = Math.sin(angle) * distance
    const size = 4 + Math.random() * 4
    dot.style.setProperty('--dx', `${dx}px`)
    dot.style.setProperty('--dy', `${dy}px`)
    dot.style.setProperty('--size', `${size}px`)
    dot.style.setProperty('--delay', `${Math.random() * 50}ms`)
    dot.style.background = COLORS[i % COLORS.length]
    layer.appendChild(dot)
  }

  document.body.appendChild(layer)
  window.setTimeout(() => layer.remove(), LIFETIME_MS)

  target.classList.add('btn--burst-pop')
  window.setTimeout(() => target.classList.remove('btn--burst-pop'), 260)
}
