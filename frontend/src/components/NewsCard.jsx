/**
 * NewsCard — displays a single news article.
 *
 * Opens article in new tab on click.
 * Calls newsService.recordView() to count trending.
 *
 * Props:
 *   article: { id, title, description, url, image_url, source_name, published_at, genre_tags }
 *   variant?: 'standard' | 'compact' | 'rail'   (default: 'standard')
 */
import { useEffect, useRef, useState } from 'react'
import { newsService } from '../services/newsService'
import BorderGlow from './BorderGlow'
import './NewsCard.css'

function timeAgo(iso) {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  if (diff < 3600)  return `${Math.round(diff / 60)}m ago`
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`
  return `${Math.round(diff / 86400)}d ago`
}

// Per-article debounce so the same card mounted twice (e.g. a Home strip + the
// News page) doesn't double-count a view within one session.
const recordedViews = new Set()

function recordViewOnce(articleId) {
  if (recordedViews.has(articleId)) return
  recordedViews.add(articleId)
  newsService.recordView(articleId)
}

export default function NewsCard({ article, variant = 'standard' }) {
  const [imgError, setImgError] = useState(false)
  // Same progressive reveal the poster art uses on movie cards: the thumbnail
  // starts blurred and dimmed and sharpens once it has decoded, so a row of
  // cards fills in smoothly instead of popping in one image at a time.
  const [imgLoaded, setImgLoaded] = useState(false)
  const cardRef = useRef(null)

  // Fire a view once the card has been >=50% visible for >=2s.
  useEffect(() => {
    if (!cardRef.current) return
    let timer = null
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => recordViewOnce(article.id), 2000)
        } else if (timer) {
          clearTimeout(timer)
          timer = null
        }
      },
      { threshold: 0.5 }
    )
    observer.observe(cardRef.current)
    return () => {
      if (timer) clearTimeout(timer)
      observer.disconnect()
    }
  }, [article.id])

  const handleClick = () => {
    recordViewOnce(article.id)
    window.open(article.url, '_blank', 'noopener,noreferrer')
  }

  const ago = timeAgo(article.published_at)

  if (imgError || !article.image_url) return null

  return (
    <BorderGlow
      ref={cardRef}
      className={`news-card news-card--${variant}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
      aria-label={article.title}
      borderRadius={12}
      glowRadius={30}
      glowIntensity={0.85}
      colors={['#B048FF', '#00E5A0', '#FF4D6D']}
      backgroundColor="#1B1B1B"
    >
      <div className="news-card__content">
        {/* Thumbnail */}
        <div className="news-card__thumb-wrap">
          <img
            src={article.image_url}
            alt=""
            className={`news-card__thumb poster-progressive ${imgLoaded ? 'poster-progressive--loaded' : ''}`}
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        {/* Hover overlay */}
        <div className="news-card__hover-overlay">
          <span className="news-card__read-label">Read Article ↗</span>
        </div>
      </div>

      {/* Content */}
      <div className="news-card__body">
        {/* Genre tags */}
        {variant === 'rail' ? (
          article.genre_tags?.length > 0 && (
            <div className="news-card__tags">
              <span className="news-card__tag">{article.genre_tags[0]}</span>
            </div>
          )
        ) : (
          article.genre_tags?.length > 0 && (
            <div className="news-card__tags">
              {article.genre_tags.slice(0, 2).map((t) => (
                <span key={t} className="news-card__tag">{t}</span>
              ))}
            </div>
          )
        )}

        {/* The rail's "…more" cue sits outside the clamped heading on purpose:
            -webkit-line-clamp drops any content past the third line, so a span
            inside the <h3> would be hidden on exactly the cards that truncate. */}
        <h3 className="news-card__title">{article.title}</h3>
        {variant === 'rail' && (
          <span className="news-card__more" aria-hidden="true">&hellip;more</span>
        )}

        {variant === 'standard' && article.description && (
          <p className="news-card__desc">{article.description}</p>
        )}

        {variant === 'rail' ? (
          <div className="news-card__meta">
            <span className="news-card__source">
              {article.source_name && `By ${article.source_name}`}
              {article.source_name && ago && ' • '}
              {ago}
            </span>
          </div>
        ) : (
          <div className="news-card__meta">
            {article.source_name && (
              <span className="news-card__source">{article.source_name}</span>
            )}
            {ago && <span className="news-card__time">{ago}</span>}
          </div>
        )}
      </div>
      </div>
    </BorderGlow>
  )
}
