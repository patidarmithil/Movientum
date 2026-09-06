import { useEffect } from 'react'
import { createPortal } from 'react-dom'

import './ImageLightbox.css'

/**
 * Full-bleed view of one image.
 *
 * The person page has had this gesture since it shipped — tap the artwork, get the
 * artwork at the size it was made. This is that behaviour lifted out so the tier
 * board and the detail pages can share it instead of each growing their own modal.
 *
 * `src` should already be the largest TMDB rendition; the caller decides which,
 * because only it knows whether the path is a poster, a still or a headshot.
 */
export default function ImageLightbox({ src, alt = '', caption, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (!src) return null

  return createPortal(
    <div className="img-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt || 'Image'}>
      <button type="button" className="img-lightbox__close" onClick={onClose} aria-label="Close">×</button>
      <img
        className="img-lightbox__img"
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
      />
      {caption && <p className="img-lightbox__caption">{caption}</p>}
    </div>,
    document.body
  )
}
