/**
 * NewsCard — displays a single news article.
 *
 * Opens article in new tab on click.
 * Calls newsService.recordView() to count trending.
 *
 * Props:
 *   article: { id, title, description, url, image_url, source_name, published_at, genre_tags }
 *   variant?: 'standard' | 'compact'   (default: 'standard')
 */
import { useState } from 'react'
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

export default function NewsCard({ article, variant = 'standard' }) {
  const [imgError, setImgError] = useState(false)

  const handleClick = () => {
    newsService.recordView(article.id) // fire and forget
    window.open(article.url, '_blank', 'noopener,noreferrer')
  }

  const ago = timeAgo(article.published_at)

  return (
    <BorderGlow
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
        {article.image_url && !imgError ? (
          <img
            src={article.image_url}
            alt=""
            className="news-card__thumb"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="news-card__thumb-fallback">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v2" />
              <path d="M2 12h10" />
              <path d="M2 17h10" />
              <path d="M2 7h4" />
            </svg>
          </div>
        )}
        {/* Hover overlay */}
        <div className="news-card__hover-overlay">
          <span className="news-card__read-label">Read Article ↗</span>
        </div>
      </div>

      {/* Content */}
      <div className="news-card__body">
        {/* Genre tags */}
        {article.genre_tags?.length > 0 && (
          <div className="news-card__tags">
            {article.genre_tags.slice(0, 2).map((t) => (
              <span key={t} className="news-card__tag">{t}</span>
            ))}
          </div>
        )}

        <h3 className="news-card__title">{article.title}</h3>

        {variant === 'standard' && article.description && (
          <p className="news-card__desc">{article.description}</p>
        )}

        <div className="news-card__meta">
          {article.source_name && (
            <span className="news-card__source">{article.source_name}</span>
          )}
          {ago && <span className="news-card__time">{ago}</span>}
        </div>
      </div>
      </div>
    </BorderGlow>
  )
}
