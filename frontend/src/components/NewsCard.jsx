/**
 * NewsCard — displays a single news article.
 *
 * Opens article in new tab on click.
 * Calls newsService.recordView() to count trending.
 *
 * Props:
 *   article: { id, title, description, url, image_url, source_name, published_at, genre_tags }
 *   variant?: 'standard' | 'compact' | 'rail'   (default: 'standard')
 *   showFeedback?: boolean — render the thumbs control. News feedback is
 *                  news-scoped: it moves this user's source / category / entity
 *                  weights for the For-You news ranking and never touches the
 *                  movie/TV taste profile.
 *   feedbackSource?: 'news_grid' | 'home_news' | 'news_for_title'
 *   onDismiss?: () => void — called after a thumbs-down so the list can animate
 *                  the card out.
 *   isExiting?: boolean
 */
import { useEffect, useRef, useState } from 'react'
import { newsService } from '../services/newsService'
import BorderGlow from './BorderGlow'
import FeedbackControl from './FeedbackControl'
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

// Fallback art hues, taken from the category pill palette so a card without a
// picture still reads as part of the page rather than a grey hole.
const FALLBACK_HUES = ['#B048FF', '#00E5A0', '#FF4D6D', '#4CC9F0', '#FF9F1C', '#F9C74F']

function hueFor(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return FALLBACK_HUES[h % FALLBACK_HUES.length]
}

// Category ids as people read them ("sci-fi" -> "Sci-Fi").
const TAG_LABELS = { 'k-drama': 'K-Drama', 'sci-fi': 'Sci-Fi', 'web-series': 'Web series' }
const tagLabel = (t) => TAG_LABELS[t] || t.charAt(0).toUpperCase() + t.slice(1)

// Images narrower than this are tracking pixels or broken placeholders.
const MIN_IMAGE_WIDTH = 40

function recordViewOnce(articleId) {
  if (recordedViews.has(articleId)) return
  recordedViews.add(articleId)
  newsService.recordView(articleId)
}

export default function NewsCard({
  article,
  variant = 'standard',
  showFeedback = false,
  feedbackSource = 'news_grid',
  onDismiss,
  isExiting = false,
}) {
  const [imgError, setImgError] = useState(false)
  // Same progressive reveal the poster art uses on movie cards: the thumbnail
  // starts blurred and dimmed and sharpens once it has decoded, so a row of
  // cards fills in smoothly instead of popping in one image at a time.
  const [imgLoaded, setImgLoaded] = useState(false)
  const cardRef = useRef(null)
  const imgRef = useRef(null)

  // A cached image can finish decoding before React attaches onLoad; check once
  // after mount so such a thumbnail doesn't stay blurred.
  useEffect(() => {
    const img = imgRef.current
    if (!img || !img.complete) return
    if (img.naturalWidth >= MIN_IMAGE_WIDTH) setImgLoaded(true)
    else setImgError(true)
  }, [])

  const handleImgLoad = (e) => {
    if (e.currentTarget.naturalWidth < MIN_IMAGE_WIDTH) setImgError(true)
    else setImgLoaded(true)
  }

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

  // Never drop the card when its picture fails: an empty grid cell is worse than a
  // card with fallback art, and hiding it broke the row maths on the /news grid.
  const showImage = Boolean(article.image_url) && !imgError
  const source = article.source_name || ''

  return (
    <BorderGlow
      ref={cardRef}
      className={`news-card news-card--${variant}${isExiting ? ' is-exiting' : ''}`}
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
          {showImage ? (
            <img
              ref={imgRef}
              src={article.image_url}
              alt=""
              className={`news-card__thumb poster-progressive ${imgLoaded ? 'poster-progressive--loaded' : ''}`}
              loading="lazy"
              decoding="async"
              // Many news CDNs refuse hotlinked images that carry a foreign Referer.
              referrerPolicy="no-referrer"
              onLoad={handleImgLoad}
              onError={() => setImgError(true)}
            />
          ) : (
            <div
              className="news-card__thumb-fallback"
              style={{ '--fallback-hue': hueFor(source || article.title || '') }}
              aria-hidden="true"
            >
              <span className="news-card__fallback-source">{source || 'Movientum News'}</span>
            </div>
          )}
        {/* Hover overlay */}
        <div className="news-card__hover-overlay">
          <span className="news-card__read-label">Read Article ↗</span>
        </div>

        {showFeedback && article.id && (
          <FeedbackControl
            kind="news"
            articleId={article.id}
            source={feedbackSource}
            onDismiss={onDismiss}
          />
        )}
      </div>

      {/* Content */}
      <div className="news-card__body">
        {/* Genre tags */}
        {variant === 'rail' ? (
          article.genre_tags?.length > 0 && (
            <div className="news-card__tags">
              <span className="news-card__tag">{tagLabel(article.genre_tags[0])}</span>
            </div>
          )
        ) : (
          article.genre_tags?.length > 0 && (
            <div className="news-card__tags">
              {article.genre_tags.slice(0, 2).map((t) => (
                <span key={t} className="news-card__tag">{tagLabel(t)}</span>
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
