import React, { useState, useEffect } from 'react'
import { planToWatchService } from '../services/planToWatchService'
import MovieRow from './MovieRow'
import MovieCard from './MovieCard'

function shuffleArray(array) {
  const arr = [...array]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function formatDateBadge(dateStr) {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  } catch {
    return null
  }
}

export default function WatchlistSection() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [collectionId, setCollectionId] = useState(null)

  useEffect(() => {
    let mounted = true
    
    async function fetchWatchlist() {
      try {
        const listId = await planToWatchService.getOrCreate()
        if (mounted) {
          setCollectionId(listId)
        }
        const rawItems = await planToWatchService.getItemsWithDetails()
        if (!mounted) return
        
        const today = new Date()
        const nextWeek = new Date()
        nextWeek.setDate(today.getDate() + 7)
        
        const todayStr = today.toISOString().split('T')[0]
        const nextWeekStr = nextWeek.toISOString().split('T')[0]

        const filtered = []

        for (const item of rawItems) {
          const m = item.movie
          if (!m) continue
          
          const mediaType = m.media_type || 'movie'
          let shouldShow = false
          let dateBadge = null
          let hideRating = false

          if (mediaType === 'movie') {
            const releaseDate = m.release_date || ''
            if (releaseDate && releaseDate > todayStr) {
              // Case A: Movie not released yet
              if (releaseDate <= nextWeekStr) {
                shouldShow = true
                dateBadge = formatDateBadge(releaseDate)
                hideRating = true
              }
            } else {
              // Case B: Movie already released
              shouldShow = true
            }
          } else if (mediaType === 'tv') {
            const status = m.status || ''
            if (status === 'Ended' || status === 'Canceled') {
              // Case C: TV Ended
              shouldShow = true
            } else {
              // Case D: TV Returning / Ongoing
              const nextEp = m.next_episode_to_air?.air_date || ''
              const nextSeason = m.next_season_to_air?.air_date || ''
              
              if (nextEp && nextEp <= nextWeekStr) {
                shouldShow = true
                dateBadge = formatDateBadge(nextEp)
              } else if (nextSeason && nextSeason <= nextWeekStr) {
                shouldShow = true
                dateBadge = formatDateBadge(nextSeason)
              }
            }
          }

          if (shouldShow) {
            filtered.push({
              ...m,
              _dateBadge: dateBadge,
              _hideRating: hideRating
            })
          }
        }

        setItems(shuffleArray(filtered))
      } catch (err) {
        console.error("Watchlist fetch error:", err)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    fetchWatchlist()
    return () => { mounted = false }
  }, [])

  if (!loading && items.length === 0) return null

  return (
    <MovieRow
      title="Watchlist"
      icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>}
      movies={items}
      loading={loading}
      seeAllHref={collectionId ? `/watchlists/${collectionId}` : '/watchlists'}
      premiumScroll={true}
      renderCard={(movie) => (
        <MovieCard
          key={`${movie.id}-${movie.media_type}`}
          movie={movie}
          dateBadge={movie._dateBadge}
          hideRating={movie._hideRating}
        />
      )}
    />
  )
}
