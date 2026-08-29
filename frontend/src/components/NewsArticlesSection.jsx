/**
 * NewsArticlesSection — reusable news rail for Movie and TV detail pages.
 *
 * Props:
 *   itemId:    number — TMDB id
 *   mediaType: 'movie' | 'tv'
 *
 * Backed by GET /api/v1/news/for-title/{media_type}/{tmdb_id}, which reads
 * articles the entity linker matched to this title at ingest time.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { newsService } from '../services/newsService'
import NewsCard from './NewsCard'
import './NewsArticlesSection.css'

const SCROLL_TOLERANCE = 4

function ChevronLeftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function NewsArticlesSection({ itemId, itemTitle, mediaType = 'movie' }) {
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)
  const [atStart, setAtStart]   = useState(true)
  const [atEnd, setAtEnd]       = useState(true)
  const railRef = useRef(null)

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
  }, [itemId, mediaType])

  const updateEdges = useCallback(() => {
    const el = railRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= SCROLL_TOLERANCE)
    setAtEnd(maxScroll <= SCROLL_TOLERANCE || el.scrollLeft >= maxScroll - SCROLL_TOLERANCE)
  }, [])

  useEffect(() => {
    const el = railRef.current
    if (!el || loading) return

    updateEdges()

    el.addEventListener('scroll', updateEdges, { passive: true })
    window.addEventListener('resize', updateEdges)

    return () => {
      el.removeEventListener('scroll', updateEdges)
      window.removeEventListener('resize', updateEdges)
    }
  }, [loading, articles, updateEdges])

  const scrollByAmount = (direction) => {
    const el = railRef.current
    if (!el) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({
      left: direction * el.clientWidth * 0.85,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }

  // A rail with a single item looks broken, and most titles have no news at all —
  // render nothing rather than a half-empty section.
  if (!loading && articles.length < 2) return null

  return (
    <section className="news-articles-section" aria-label="Related news articles">
      <div className="section-header">
        <h2>In the news</h2>

        <div className="news-rail__controls">
          <button
            type="button"
            className="news-rail__arrow"
            aria-label="Previous articles"
            onClick={() => scrollByAmount(-1)}
            disabled={atStart}
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="news-rail__arrow"
            aria-label="Next articles"
            onClick={() => scrollByAmount(1)}
            disabled={atEnd}
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="news-rail" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="news-rail__item">
              <div className="news-rail-skeleton">
                <div className="skeleton news-rail-skeleton__thumb" />
                <div className="news-rail-skeleton__body">
                  <div className="skeleton" style={{ height: 12, width: '90%', borderRadius: 4 }} />
                  <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 4 }} />
                  <div className="skeleton" style={{ height: 10, width: '45%', borderRadius: 4 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="news-rail"
          ref={railRef}
          role="region"
          tabIndex={0}
          aria-label="News articles, scrollable"
        >
          {articles.map((article) => (
            <div key={article.id} className="news-rail__item">
              <NewsCard article={article} variant="rail" />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
