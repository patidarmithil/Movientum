import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import './TrailerModal.css'

import api from '../utils/api'

export default function TrailerModal({ isOpen, onClose, data, seasons, tvId, directVideoKey, contentId, mediaType, initialSeason }) {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState("trailer") // "trailer" | "teaser"
  const [selectedSeason, setSelectedSeason] = useState(initialSeason || "all")
  const [seasonVideos, setSeasonVideos] = useState(null)
  const [loadingSeason, setLoadingSeason] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      if (initialSeason) {
        setSelectedSeason(initialSeason)
      }
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isOpen, initialSeason])

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return
    const handleOutsideClick = () => {
      setIsDropdownOpen(false)
    }
    document.addEventListener("click", handleOutsideClick)
    return () => {
      document.removeEventListener("click", handleOutsideClick)
    }
  }, [isDropdownOpen])

  // Fetch season videos when selectedSeason changes
  useEffect(() => {
    if (selectedSeason === "all" || !tvId) {
      setSeasonVideos(null)
      return
    }
    let cancelled = false
    setLoadingSeason(true)
    api.get(`/api/v1/tv/${tvId}/season/${selectedSeason}/videos`)
      .then((r) => { if (!cancelled) setSeasonVideos(r.data) })
      .catch(() => { if (!cancelled) setSeasonVideos(null) })
      .finally(() => { if (!cancelled) setLoadingSeason(false) })

    return () => { cancelled = true }
  }, [selectedSeason, tvId])

  if (!isOpen) return null;

  // When a specific season is selected, use its videos; fall back to show-level data if no season trailer
  const seasonData = selectedSeason === "all" ? null : seasonVideos
  const trailerKey = activeTab === "trailer"
    ? (seasonData?.trailer_key || data?.trailer_key)
    : (seasonData?.teaser_key || data?.teaser_key)

  // If directVideoKey is passed, override everything
  const currentKey = directVideoKey ? directVideoKey : trailerKey

  // For fallback query: prefer season-specific, then show-level
  const seasonQuery = activeTab === "trailer"
    ? (seasonData?.fallback_queries?.trailer || data?.fallback_queries?.trailer)
    : (seasonData?.fallback_queries?.teaser || data?.fallback_queries?.teaser)
  const currentQuery = directVideoKey ? null : seasonQuery

  // Determine iframe src URL
  const embedUrl = currentKey ? `https://www.youtube-nocookie.com/embed/${currentKey}?autoplay=0&rel=0&origin=${window.location.origin}` : "";

  // Figure out which season label to show in the dropdown button
  const getSeasonLabel = () => {
    if (!seasons || seasons.length === 0) return null
    if (selectedSeason === "all") return `Season 1`
    return `Season ${selectedSeason}`
  }

  const handleViewClick = (e) => {
    e.stopPropagation();
    onClose();
    if (mediaType === 'tv') {
      navigate(`/tv/${contentId}`);
    } else {
      navigate(`/movies/${contentId}`);
    }
  };

  return createPortal(
    <div className="trailer-modal-overlay" onClick={onClose}>
      <button className="trailer-modal-close" onClick={onClose} aria-label="Close modal">✕</button>
      <div className="trailer-modal" onClick={e => e.stopPropagation()}>
        <div className="trailer-modal-content">
          {loadingSeason ? (
            <div className="fallback-search-card">
              <span className="searchbar__spinner" style={{ width: '40px', height: '40px' }} />
              <p>Loading season videos...</p>
            </div>
          ) : currentKey ? (
            <iframe
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              frameBorder="0"
              title="YouTube video player"
              className="trailer-iframe"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="fallback-search-card">
              <div className="fallback-icon">🎥</div>
              <p>Video not found in our database.</p>
              {currentQuery && (
                <a
                  href={`https://www.youtube.com/results?search_query=${encodeURIComponent(currentQuery)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="youtube-search-btn"
                >
                  Search "{currentQuery}" on YouTube ↗
                </a>
              )}
            </div>
          )}
        </div>

        <div className="trailer-controls-row">
          {seasons && seasons.length > 0 && (
            <div 
              className="custom-dropdown"
              onClick={e => e.stopPropagation()}
            >
              <button 
                className="season-select-trigger"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsDropdownOpen(!isDropdownOpen);
                }}
              >
                {getSeasonLabel()}
                <svg className="dropdown-arrow-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              {isDropdownOpen && (
                <div className="custom-dropdown-menu">
                  {seasons.map((s) => (
                    <div 
                      key={s.season_number} 
                      className={`custom-dropdown-item ${String(selectedSeason) === String(s.season_number) || (selectedSeason === "all" && s.season_number === 1) ? "active" : ""}`}
                      onClick={() => {
                        setSelectedSeason(s.season_number)
                        setIsDropdownOpen(false)
                      }}
                    >
                      Season {s.season_number}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!directVideoKey && (
            <div className="trailer-tab-bar">
              <button 
                className={activeTab === "trailer" ? "active" : ""} 
                onClick={() => setActiveTab("trailer")}
              >
                Trailer
              </button>
              <button 
                className={activeTab === "teaser" ? "active" : ""} 
                onClick={() => setActiveTab("teaser")}
              >
                Teaser
              </button>
            </div>
          )}
          {directVideoKey && contentId && (
            <button className="trailer-view-btn" onClick={handleViewClick}>
              View Details ↗
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
