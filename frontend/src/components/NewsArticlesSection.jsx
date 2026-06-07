/**
 * NewsArticlesSection — reusable news strip for Movie and TV detail pages.
 *
 * Props:
 *   itemId:    number — TMDB id (movie or TV show)
 *   itemTitle: string — title for empty-state message
 *
 * Works for both movie and TV since backend uses same
 * /api/v1/news/movie/{id} endpoint (TV stored in movies table).
 */
import { useState, useEffect } from 'react'
import { newsService } from '../services/newsService'
import NewsCard from './NewsCard'
import './NewsArticlesSection.css'

export default function NewsArticlesSection({ itemId, itemTitle, mediaType = 'movie' }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    if (!itemId) return
    let cancelled = false
    setLoading(true)

    newsService.getForItem(itemId, mediaType)
      .then((data) => {
        if (!cancelled) setArticles(data.articles || [])
      })
      .catch(() => {
        if (!cancelled) setArticles([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [itemId])

  // Don't render section if no data and done loading
  if (!loading && articles.length === 0) return null

  return (
    <section className="news-articles-section" aria-label="Related news articles">
      <div className="section-header">
        <h2>
          <span className="news-section__icon">📰</span> In The News
        </h2>
      </div>

      {loading ? (
        <div className="news-articles-list">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="news-card-compact-skeleton">
              <div className="skeleton news-card-compact-skeleton__thumb" />
              <div className="news-card-compact-skeleton__body">
                <div className="skeleton" style={{ height: 12, width: '80%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 12, width: '60%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 10, width: '40%', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="news-articles-list">
          {articles.map((article) => (
            <NewsCard key={article.id} article={article} variant="compact" />
          ))}
        </div>
      )}
    </section>
  )
}
