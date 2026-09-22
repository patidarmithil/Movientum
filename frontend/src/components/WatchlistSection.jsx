import React, { useState, useEffect, useRef } from 'react'
import { planToWatchService } from '../services/planToWatchService'
import { useSessionState } from '../hooks/useSessionState'
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

export default function WatchlistSection() {
  // Session-cached (stale-while-revalidate): a returning visit paints the
  // last-known rail instantly from sessionStorage, then this effect refetches
  // in the background and silently swaps in the fresh, re-shuffled result —
  // no skeleton flash on repeat visits. Filtering (which titles are "coming
  // up") now happens server-side in one cached call instead of a client-side
  // loop over N per-item detail fetches.
  const [items, setItems] = useSessionState('home_watchlist', [])
  const [loading, setLoading] = useState(items.length === 0)
  const fetchedRef = useRef(false)
  // "Still mounted?" has to survive across effect runs, so it is a ref rather
  // than a per-run local. Under StrictMode the effect runs, is cleaned up, then
  // runs again: with a local flag the first run's cleanup set it false, the
  // second run skipped the fetch on fetchedRef, and the in-flight response then
  // bailed out before setLoading(false) — the rail sat on skeletons forever in
  // dev. The ref is set true at the top of every run, so the response resolves
  // against the live mount.
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true

    async function fetchWatchlist() {
      try {
        const data = await planToWatchService.getHomeStrip()
        if (!aliveRef.current) return
        setItems(shuffleArray(data.items || []))
      } catch (err) {
        console.error("Watchlist fetch error:", err)
      } finally {
        if (aliveRef.current) setLoading(false)
      }
    }

    if (!fetchedRef.current) {
      fetchedRef.current = true
      fetchWatchlist()
    }

    return () => { aliveRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!loading && items.length === 0) return null

  return (
    <MovieRow
      title="Watchlist"
      icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" className="flame-icon-svg" xmlns="http://www.w3.org/2000/svg"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"></path></svg>}
      movies={items}
      loading={loading && items.length === 0}
      seeAllHref="/dashboard"
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
