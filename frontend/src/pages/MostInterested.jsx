import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { movieService } from '../services/movieService'
import './MostInterested.css'
import ScrollReveal from '../components/ScrollReveal'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import ShinyText from '../components/ShinyText'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

const FILTERS = [
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'year', label: 'This Year' },
  { id: 'all_time', label: 'All Time' },
]

const COUNTRIES = [
  { id: 'all', label: 'All Countries' },
  { id: 'IN', label: 'India' },
  { id: 'US', label: 'USA' },
  { id: 'JP', label: 'Japan' },
  { id: 'KR', label: 'South Korea' },
  { id: 'GB', label: 'UK' },
  { id: 'FR', label: 'France' },
  { id: 'ES', label: 'Spain' },
  { id: 'DE', label: 'Germany' },
  { id: 'CA', label: 'Canada' },
]

export default function MostInterested() {
  const [activeFilter, setActiveFilter] = useState('month')
  const [activeCountry, setActiveCountry] = useState('all')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    let isMounted = true
    
    async function fetchData() {
      setLoading(true)
      try {
        // Fetch up to 100 items for the dedicated page
        const data = await movieService.getUpcoming(activeFilter, 100, activeCountry)
        if (isMounted) {
          setItems(data.movies || [])
        }
      } catch (err) {
        console.error("Failed to fetch most interested items:", err)
      } finally {
        if (isMounted) setLoading(false)
      }
    }
    
    fetchData()
    return () => { isMounted = false }
  }, [activeFilter, activeCountry])

  const handleItemClick = (item) => {
    const route = item.media_type === 'tv' ? `/tv/${item.id}` : `/movies/${item.id}`
    navigate(route)
  }

  const handleShare = (e, item) => {
    e.stopPropagation()
    const url = window.location.origin + (item.media_type === 'tv' ? `/tv/${item.id}` : `/movies/${item.id}`)
    if (navigator.share) {
      navigator.share({
        title: item.title,
        url: url
      }).catch(console.error)
    } else {
      navigator.clipboard.writeText(url)
      alert("Link copied to clipboard!")
    }
  }

  const formatDate = (isoString) => {
    if (!isoString) return ''
    const d = new Date(isoString)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  return (
    <main className="most-interested-page">
      <div className="mi-container">
        
        {/* Sidebar Filters */}
        <aside className="mi-sidebar">
          <div className="mi-sidebar-group">
            <div className="mi-sidebar-title">Timeframe</div>
            <div className="mi-sidebar-options">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  className={`mi-filter-btn ${activeFilter === f.id ? 'active' : ''}`}
                  onClick={() => setActiveFilter(f.id)}
                >
                  <div className="mi-radio"></div>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mi-sidebar-group">
            <div className="mi-sidebar-title">Country</div>
            <div className="mi-sidebar-options">
              {COUNTRIES.map((c) => (
                <button
                  key={c.id}
                  className={`mi-filter-btn ${activeCountry === c.id ? 'active' : ''}`}
                  onClick={() => setActiveCountry(c.id)}
                >
                  <div className="mi-radio"></div>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main List Area */}
        <section className="mi-main">
          <header className="mi-main-header">
            <ScrollReveal>
              <div className="mi-header-content">
                <h1><ShinyText text="Most Interested" /></h1>
                <div className="mi-mobile-filters">
                  <select
                    value={activeFilter}
                    onChange={(e) => setActiveFilter(e.target.value)}
                    className="mi-mobile-select"
                  >
                    {FILTERS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                  <select
                    value={activeCountry}
                    onChange={(e) => setActiveCountry(e.target.value)}
                    className="mi-mobile-select"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c.id} value={c.id}>{c.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </ScrollReveal>
          </header>

          {loading ? (
            <div className="mi-loading">Loading...</div>
          ) : items.length === 0 ? (
            <div className="mi-empty">No content found for this selection.</div>
          ) : (
            <StaggerContainer className="mi-list" instant={true}>
              {items.map((item, index) => {
                const posterUrl = item.poster_path
                  ? `${TMDB_IMAGE_BASE}/w342${item.poster_path}`
                  : null
                
                // Popularity formula used in Home.jsx
                const interestedCount = Math.round(item.popularity * 12 + 100)
                const interestedStr = interestedCount > 1000 
                  ? (interestedCount / 1000).toFixed(1) + 'K' 
                  : interestedCount

                const isTV = item.media_type === 'tv'
                const dateText = item.release_date ? formatDate(item.release_date) : 'To Be Confirmed'
                const categoryText = isTV ? 'New Season' : 'In Theatre'

                return (
                  <StaggerItem key={`${item.id}-${item.media_type}`} index={index}>
                    <div 
                      className="mi-item" 
                      onClick={() => handleItemClick(item)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && handleItemClick(item)}
                    >
                      
                      <div className="mi-rank">{index + 1}</div>
                      
                      <div className="mi-poster-wrap">
                        {posterUrl ? (
                          <img 
                            src={posterUrl} 
                            alt={item.title} 
                            className="mi-poster" 
                            loading="lazy" 
                            onError={(e) => {
                              e.target.style.display = 'none';
                              // If image fails to load, create the fallback div dynamically
                              const fallback = document.createElement('div');
                              fallback.className = 'mi-poster-fallback';
                              fallback.innerText = '🎬';
                              e.target.parentNode.appendChild(fallback);
                            }}
                          />
                        ) : (
                          <div className="mi-poster-fallback">🎬</div>
                        )}
                      </div>

                      <div className="mi-info">
                        <h2 className="mi-title">{item.title}</h2>
                        <p className="mi-meta">{dateText} • {categoryText}</p>
                      </div>

                      <div className="mi-stats">
                        <div className="mi-interested">
                          🔥 {interestedStr}
                        </div>
                        <button className="mi-share" onClick={(e) => handleShare(e, item)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path>
                            <polyline points="16 6 12 2 8 6"></polyline>
                            <line x1="12" y1="2" x2="12" y2="15"></line>
                          </svg>
                          Share
                        </button>
                      </div>
                      
                    </div>
                  </StaggerItem>
                )
              })}
            </StaggerContainer>
          )}
        </section>
        
      </div>
    </main>
  )
}
