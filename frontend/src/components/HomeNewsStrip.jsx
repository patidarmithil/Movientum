/**
 * HomeNewsStrip — compact horizontal news strip for the Home page.
 * Shows 4–5 cards from latest feed.
 * Reuses existing scroll-row pattern from Home page.
 */
import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { newsService } from '../services/newsService'
import { useAuth } from '../context/AuthContext'
import NewsCard from './NewsCard'
import ShinyText from './ShinyText'
import { observeOnce } from '../utils/sharedObserver'
import './HomeNewsStrip.css'

const REVEAL_OBSERVER_OPTIONS = { threshold: 0.05, rootMargin: '0px 100px 0px 100px' }

function ViewportRevealNewsItem({ article, index }) {
  const [isVisible, setIsVisible] = useState(false)
  const itemRef = useRef(null)

  useEffect(() => {
    const el = itemRef.current
    if (!el) return
    return observeOnce(el, () => setIsVisible(true), REVEAL_OBSERVER_OPTIONS)
  }, [])

  const delay = isVisible ? `${(index % 8) * 40}ms` : '0ms'

  return (
    <div
      ref={itemRef}
      className={`viewport-reveal-card home-news-strip__item ${isVisible ? 'visible' : ''}`}
      style={{ transitionDelay: delay }}
    >
      <NewsCard article={article} variant="standard" />
    </div>
  )
}

export default function HomeNewsStrip() {
  const { isLoggedIn } = useAuth()
  const [articles, setArticles] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    setLoading(true)
    const fetchNews = isLoggedIn 
      ? newsService.getForYou(1, 6) 
      : newsService.getLatest(1, 6)

    fetchNews
      .then((data) => setArticles(data.articles || []))
      .catch(() => setArticles([]))
      .finally(() => setLoading(false))
  }, [isLoggedIn])

  // Don't render if no articles and loaded (or logged out)
  if (!loading && articles.length === 0) return null

  return (
    <div className="home-news-strip section-sm">
      <div className="section-header">
        <div className="section-header-left">
          <h2>
            <ShinyText text="📰 In The News" />
          </h2>
        </div>
        <Link to="/news" className="see-all-link">All News →</Link>
      </div>

      {loading ? (
        <div className="home-news-strip__scroll scroll-row">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="home-news-strip__skeleton">
              <div className="skeleton home-news-strip__skeleton-thumb" />
              <div className="home-news-strip__skeleton-body">
                <div className="skeleton" style={{ height: 12, width: '90%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 12, width: '70%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 10, width: '50%', borderRadius: 4 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="scroll-row-container">
          <div className="scroll-row-fade left-fade" />
          <div key={`news-strip-${articles.length}`} className="scroll-row home-news-strip__scroll">
            {articles.map((article, index) => (
              <ViewportRevealNewsItem key={article.id} index={index} article={article} />
            ))}
          </div>
          <div className="scroll-row-fade right-fade" />
        </div>
      )}
    </div>
  )
}
