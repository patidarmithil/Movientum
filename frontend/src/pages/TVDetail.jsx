/**
 * TVDetail.jsx — Improvement 1.7
 *
 * Route: /tv/:id
 * Endpoint: GET /api/v1/tv/{id}  +  GET /api/v1/tv/{id}/credits
 *
 * Layout identical to MovieDetail but adapted for TV data:
 *  - Seasons / Episodes counts instead of runtime
 *  - Created by instead of Directed by
 *  - Network badge
 *  - No similar-movies row (TV similarity out of scope for 1.7)
 */
import { useParams, Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../utils/api'
import { watchService } from '../services/watchService'
import { ratingService } from '../services/ratingService'
import { watchingTrackerService } from '../services/watchingTrackerService'
import { useAuth } from '../context/AuthContext'
import CastCrew from '../components/CastCrew'
import MovieCard from '../components/MovieCard'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import RatingMeter from '../components/RatingMeter'
import TrailerModal from '../components/TrailerModal'
import ShinyText from '../components/ShinyText'
import SaveToCollectionModal from '../components/SaveToCollectionModal'
import ProductionTags from '../components/ProductionTags'
import { pageCache } from '../utils/pageCache'
import { watchlistService } from '../services/watchlistService'
import { planToWatchService } from '../services/planToWatchService'
import { tempTrackerService } from '../services/tempTrackerService'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import MovieRow from '../components/MovieRow'
import './MovieDetail.css'   // reuse same layout CSS

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export default function TVDetail() {
  const { id } = useParams()
  const tvId = Number(id)
  const { isLoggedIn } = useAuth()
  const location = useLocation()
  const passedShow = location.state?.movie

  const cacheKey = `tv-detail-${tvId}`
  const cachedData = pageCache.get(cacheKey)

  const [show,       setShow]       = useState(() => {
    if (cachedData?.show) return cachedData.show
    if (passedShow) {
      return {
        id: passedShow.id,
        title: passedShow.title || passedShow.name,
        name: passedShow.name || passedShow.title,
        poster_path: passedShow.poster_path,
        backdrop_path: passedShow.backdrop_path,
        release_year: passedShow.release_year,
        first_air_date: passedShow.first_air_date || passedShow.release_date,
        vote_average: passedShow.vote_average,
        media_type: passedShow.media_type || 'tv'
      }
    }
    return null
  })
  const [loading,    setLoading]    = useState(!cachedData?.show)
  const [error,      setError]      = useState(null)
  const [hasImgError, setHasImgError] = useState(false)
  const [similar,       setSimilar]       = useState(cachedData?.similar || [])

  const [showRatingMeter, setShowRatingMeter] = useState(false)
  const [posterLoaded, setPosterLoaded] = useState(false)
  const posterRef = useRef(null)

  const [videoReady, setVideoReady] = useState(false)
  const [showVideo, setShowVideo] = useState(false)
  const [isPlaying, setIsPlaying] = useState(true)
  const isPlayingRef = useRef(true)
  const [isMuted, setIsMuted] = useState(true)
  const playerRef = useRef(null)
  const backdropContainerRef = useRef(null)

  const [videosData, setVideosData] = useState(cachedData?.videosData || null)
  const [isTrailerModalOpen, setIsTrailerModalOpen] = useState(false)

  const trailerKey = videosData?.trailer_key || null

  useEffect(() => {
    setPosterLoaded(false)
    setShowRatingMeter(false)
    setVideoReady(false)
  }, [tvId])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (navigator.connection && (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === 'slow-2g')) return
    setShowVideo(true)
  }, [])

  useEffect(() => {
    if (!showVideo || !trailerKey || !backdropContainerRef.current) return;

    let isApiReady = !!window.YT && !!window.YT.Player;

    const initPlayer = () => {
      if (playerRef.current) return; // already init
      playerRef.current = new window.YT.Player(`yt-player-${tvId}`, {
        videoId: trailerKey,
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 1,
          modestbranding: 1,
          showinfo: 0,
          rel: 0,
          disablekb: 0,
          playsinline: 1,
          fs: window.innerWidth < 768 ? 0 : 1
        },
        events: {
          onReady: (event) => {
            event.target.mute();
            event.target.playVideo();
          },
          onStateChange: (event) => {
            if (event.data === window.YT.PlayerState.PLAYING) {
              setVideoReady(true);
              setIsPlaying(true);
              isPlayingRef.current = true;
            } else if (event.data === window.YT.PlayerState.PAUSED || event.data === window.YT.PlayerState.UNSTARTED) {
              setVideoReady(true); // make sure it's visible so user can click it
              setIsPlaying(false);
              isPlayingRef.current = false;
            } else if (event.data === window.YT.PlayerState.ENDED) {
              event.target.playVideo();
            }
          }
        }
      });
    };

    const loadYoutubeApi = () => {
      if (isApiReady) {
        initPlayer();
      } else {
        if (!document.getElementById('youtube-iframe-api')) {
          const tag = document.createElement('script');
          tag.id = 'youtube-iframe-api';
          tag.src = 'https://www.youtube.com/iframe_api';
          const firstScriptTag = document.getElementsByTagName('script')[0];
          firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }
        const oldCallback = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
          if (oldCallback) oldCallback();
          isApiReady = true;
          initPlayer();
        };
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadYoutubeApi();
          if (playerRef.current && typeof playerRef.current.playVideo === 'function' && isPlayingRef.current) {
            playerRef.current.mute();
            playerRef.current.playVideo();
          }
        } else {
          if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
            playerRef.current.pauseVideo();
          }
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(backdropContainerRef.current);

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (playerRef.current && typeof playerRef.current.pauseVideo === 'function') {
          playerRef.current.pauseVideo();
        }
      } else {
        if (playerRef.current && typeof playerRef.current.playVideo === 'function' && isPlayingRef.current) {
          if (backdropContainerRef.current && backdropContainerRef.current.getBoundingClientRect().top < window.innerHeight) {
             playerRef.current.playVideo();
          }
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      setVideoReady(false);
    };
  }, [showVideo, trailerKey, tvId]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const iframe = document.getElementById(`yt-player-${tvId}`);
      if (!iframe) return;
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        iframe.style.pointerEvents = 'none';
      } else {
        iframe.style.pointerEvents = 'auto';
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [tvId]);

  const togglePlay = () => {
    if (!playerRef.current || typeof playerRef.current.getPlayerState !== 'function') return;
    if (isPlayingRef.current) {
      playerRef.current.pauseVideo();
      setIsPlaying(false);
      isPlayingRef.current = false;
    } else {
      playerRef.current.playVideo();
      setIsPlaying(true);
      isPlayingRef.current = true;
    }
  };

  const toggleMute = () => {
    if (!playerRef.current || typeof playerRef.current.isMuted !== 'function') return;
    if (isMuted) {
      playerRef.current.unMute();
      setIsMuted(false);
    } else {
      playerRef.current.mute();
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    const iframe = document.getElementById(`yt-player-${tvId}`);
    if (!iframe) return;

    if (!iframe.requestFullscreen && !iframe.webkitRequestFullscreen && !iframe.msRequestFullscreen) {
      // Fallback for iOS Safari which doesn't support element fullscreen
      setIsTrailerModalOpen(true);
      if (playerRef.current && isPlayingRef.current) {
        playerRef.current.pauseVideo();
        isPlayingRef.current = false;
        setIsPlaying(false);
      }
      return;
    }

    if (!document.fullscreenElement) {
      if (iframe.requestFullscreen) {
        iframe.requestFullscreen();
      } else if (iframe.webkitRequestFullscreen) {
        iframe.webkitRequestFullscreen();
      } else if (iframe.msRequestFullscreen) {
        iframe.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  };

  const handleBackdropClick = (e) => {
    // Ignore clicks on buttons, links, posters, or the controls overlay
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.clickable-poster') || e.target.closest('.backdrop-controls')) {
      return;
    }
    togglePlay();
  };

  useEffect(() => {
    if (posterRef.current && posterRef.current.complete) {
      setPosterLoaded(true)
    }
  }, [show])

  useEffect(() => {
    if (!loading) {
      const timer = setTimeout(() => {
        setShowRatingMeter(true)
      }, 200)
      return () => clearTimeout(timer)
    } else {
      setShowRatingMeter(false)
    }
  }, [loading])
  const [similarLoading, setSimilarLoading] = useState(!cachedData?.similar)

  const [watchStatus,   setWatchStatus]   = useState(cachedData?.watchStatus || { watched: false, watchlisted: false })
  const [trackingStatus, setTrackingStatus] = useState(cachedData?.trackingStatus || false)
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [watchBusy,     setWatchBusy]     = useState(false)
  const [watchMsg,      setWatchMsg]      = useState(null)
  const [isModalOpen,   setIsModalOpen]   = useState(false)
  const [reqNeededState, setReqNeededState] = useState({ loading: false, success: false })

  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [isInAnyCollection, setIsInAnyCollection] = useState(false)

  const [planToWatch, setPlanToWatch] = useState(false)
  const [planToWatchId, setPlanToWatchId] = useState(null)
  const [planBusy, setPlanBusy] = useState(false)

  const handleRequestRating = async () => {
    if (!show || reqNeededState.loading || reqNeededState.success) return
    setReqNeededState({ loading: true, success: false })
    try {
      await ratingService.requestRatingNeeded(
        tvId,
        show.title,
        'show',
        show.release_year
      )
      setReqNeededState({ loading: false, success: true })
    } catch (err) {
      setReqNeededState({ loading: false, success: false })
    }
  }

  // ── Fetch TV detail ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!cachedData?.show) {
      setLoading(true)
    }
    setError(null)
    setHasImgError(false)

    api.get(`/api/v1/tv/${tvId}`)
      .then((r) => {
        if (!cancelled) {
          setShow(r.data)
          const curr = pageCache.get(cacheKey) || {}
          pageCache.set(cacheKey, { ...curr, show: r.data })
        }
      })
      .catch(() => { if (!cancelled && (!show || !show.overview)) setError('Failed to load TV show') })
      .finally(() => { if (!cancelled) setLoading(false) })
      
    api.get(`/api/v1/tv/${tvId}/videos`)
      .then((r) => {
        if (!cancelled) {
          setVideosData(r.data)
          const curr = pageCache.get(cacheKey) || {}
          pageCache.set(cacheKey, { ...curr, videosData: r.data })
        }
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [tvId])

  // ── Fetch similar TV shows ───────────────────────────
  useEffect(() => {
    // Wait for the main TV show detail to load before fetching recommendations
    if (!show) return

    let cancelled = false
    if (similar.length === 0) {
      setSimilarLoading(true)
    }

    api.get(`/api/v1/recommendations/similar/${tvId}?media_type=tv`)
      .then((r) => {
        const sim = r.data.movies || []
        if (!cancelled) {
          setSimilar(sim)
          const curr = pageCache.get(cacheKey) || {}
          pageCache.set(cacheKey, { ...curr, similar: sim })
        }
      })
      .catch(() => {
        if (!cancelled) setSimilar([])
      })
      .finally(() => {
        if (!cancelled) setSimilarLoading(false)
      })

    return () => { cancelled = true }
  }, [tvId, show])

  // ── Fetch watch status (auth-gated) ─────────────────
  const fetchStatus = useCallback(() => {
    if (!isLoggedIn) return
    watchService.getStatus(tvId, 'tv')
      .then((status) => {
        setWatchStatus(status)
        const curr = pageCache.get(cacheKey) || {}
        pageCache.set(cacheKey, { ...curr, watchStatus: status })
      })
      .catch(() => {})
    watchingTrackerService.getStatus(tvId)
      .then(res => {
        if (res.tracked) {
          setTrackingStatus(true)
          const curr = pageCache.get(cacheKey) || {}
          pageCache.set(cacheKey, { ...curr, trackingStatus: true })
        } else {
          tempTrackerService.getAll().then((data) => {
            const inTemp = data.temp_trackers?.some(t => t.tv_id === tvId)
            setTrackingStatus(inTemp)
            const curr = pageCache.get(cacheKey) || {}
            pageCache.set(cacheKey, { ...curr, trackingStatus: inTemp })
          }).catch(() => {})
        }
      })
      .catch(() => {})

    watchlistService.getMovieStatus(tvId, 'tv')
      .then(res => {
        const inAny = res.collections?.some(c => c.has_movie)
        setIsInAnyCollection(inAny)
      })
      .catch(() => {})

    planToWatchService.checkStatus(tvId, 'tv')
      .then(({ inList, listId }) => {
        setPlanToWatch(inList)
        setPlanToWatchId(listId)
      })
      .catch(() => {})
  }, [tvId, isLoggedIn])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ── Toggle Plan to Watch ─────────────────────────────
  const handlePlanToWatch = async () => {
    if (!isLoggedIn || planBusy) return
    setPlanBusy(true)
    try {
      if (planToWatch) {
        await planToWatchService.remove(planToWatchId, tvId, 'tv')
        setPlanToWatch(false)
        setWatchMsg('Removed from Plan to Watch')
      } else {
        const { listId } = await planToWatchService.add(tvId, 'tv')
        setPlanToWatchId(listId)
        setPlanToWatch(true)
        setWatchMsg('Added to Plan to Watch!')
      }
      setTimeout(() => setWatchMsg(null), 2500)
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setPlanBusy(false)
    }
  }

  const isReturningSeries = show?.status === "Returning Series"
  const daysBetween = (dateStr) => {
    const diff = new Date(dateStr) - new Date()
    return diff / (1000 * 60 * 60 * 24)
  }

  // ── Toggle watched (Ended series) ───────────────────────────────────
  const handleMarkWatched = async () => {
    if (!isLoggedIn || watchBusy) return
    setWatchBusy(true)
    try {
      if (watchStatus.watched) {
        if (watchStatus.rating_id) {
          await ratingService.deleteRating(watchStatus.rating_id)
        }
        await watchService.removeFromHistory(tvId, 'tv')
        setWatchStatus((s) => ({ ...s, watched: false, user_rating: null, rating_id: null }))
        setWatchMsg('Removed from watch history')
        setTimeout(() => setWatchMsg(null), 2500)
      } else {
        await watchService.markWatched(tvId, 'tv')
        setWatchStatus((s) => ({ ...s, watched: true }))
        setWatchMsg('Added to watch history!')
        if (planToWatch) {
          try {
            await planToWatchService.remove(planToWatchId, tvId, 'tv')
            setPlanToWatch(false)
            setPlanToWatchId(null)
          } catch (err) {
            console.error("Failed to automatically remove from Plan to Watch:", err)
          }
        }
        setTimeout(() => setWatchMsg(null), 2500)
      }
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setWatchBusy(false)
    }
  }

  // ── Toggle tracking (Returning Series) ───────────────────────────────────
  const handleTrackingToggle = async () => {
    if (!isLoggedIn || trackingBusy) return
    setTrackingBusy(true)
    try {
      if (trackingStatus) {
        await watchingTrackerService.untrack(tvId)
        await tempTrackerService.remove(tvId).catch(() => {})
        setTrackingStatus(false)
        setWatchMsg('Stopped tracking')
        setTimeout(() => setWatchMsg(null), 2500)
      } else {
        const nextDate = show?.next_episode_to_air?.air_date
        const within7 = nextDate && daysBetween(nextDate) <= 7

        if (within7) {
          const listId = await planToWatchService.getOrCreate()
          await watchlistService.addToCollection(listId, tvId, 'tv')
          await watchingTrackerService.track(tvId, nextDate)
          setPlanToWatch(true)
        } else {
          await tempTrackerService.add(tvId)
        }
        setTrackingStatus(true)
        setWatchMsg('Tracking new episodes!')
        setTimeout(() => setWatchMsg(null), 2500)
      }
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setTrackingBusy(false)
    }
  }



  // ── Loading without metadata ───────────────────────────────
  if (loading && !show) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="movie-detail__top animate-fade-lift">
            <div className="movie-detail__poster-col">
              <div className="skeleton" style={{ width: 240, height: 360, borderRadius: 16 }} />
            </div>
            <div className="movie-detail__info-col" style={{ gap: 16, paddingLeft: 24 }}>
              <div className="skeleton" style={{ height: 40, width: '60%', borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 20, width: '40%', borderRadius: 8 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
                <div className="skeleton" style={{ height: 16, width: '100%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '95%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '60%', borderRadius: 4 }} />
              </div>
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ── Error ────────────────────────────────────────────────────
  if (error || !show) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="empty-state">
            <h2>TV show not found</h2>
            <Link to="/" className="btn btn--secondary btn--md" style={{ marginTop: 16 }}>← Home</Link>
          </div>
        </div>
      </main>
    )
  }

  const posterUrl  = show.poster_path   ? `${TMDB_IMAGE_BASE}/w300${show.poster_path}`   : null
  const backdropUrl = show.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${show.backdrop_path}` : null
  const genres     = show.genres || []
  const createdBy  = show.created_by || []
  const networks   = show.networks || []
  const productionCompanies = show.production_companies || []
  const productionCountries = show.production_countries || []

  return (
    <main className="movie-detail page-content" onClick={handleBackdropClick}>
      {/* ── Backdrop ── */}
      {backdropUrl && (
        <div ref={backdropContainerRef} className="movie-detail__backdrop-container">
          <div
            className="movie-detail__backdrop movie-detail__backdrop-img"
            style={{ backgroundImage: `url(${backdropUrl})` }}
            aria-hidden="true"
          />
          {trailerKey && showVideo && (
            <div className={`movie-detail__backdrop-video ${videoReady ? 'ready' : ''}`}>
              <div id={`yt-player-${tvId}`} />
            </div>
          )}
        </div>
      )}
      <div className="movie-detail__backdrop-overlay" aria-hidden="true" />

      {/* Controls Overlay */}
      {trailerKey && showVideo && videoReady && (
        <div className="backdrop-controls">
          <button className="backdrop-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
            {isPlaying ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button className="backdrop-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
            </svg>
          </button>
          <button className="backdrop-btn" onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
            {isMuted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            )}
          </button>
        </div>
      )}

      <div className="container">
        {/* ── Top: poster + info ── */}
        <div className="movie-detail__top">
          {/* Poster */}
          <div className="movie-detail__poster-col">
            {posterUrl && !hasImgError ? (
              <img
                ref={posterRef}
                src={posterUrl}
                alt={`${show.title} poster`}
                className={`movie-detail__poster clickable-poster poster-progressive ${posterLoaded ? 'poster-progressive--loaded' : ''}`}
                onClick={() => setIsModalOpen(true)}
                onLoad={() => setPosterLoaded(true)}
                onError={() => setHasImgError(true)}
              />
            ) : (
              <div className="movie-detail__poster-placeholder">
                <span>📺</span>
              </div>
            )}
          </div>

          {/* Info column */}
          <div className="movie-detail__info animate-fade-lift">
            {/* Title */}
            <h1 className="movie-detail__title">{show.title}</h1>

            {/* Meta row */}
            <div className="movie-detail__meta">
              {show.release_year && <span>{show.release_year}</span>}
              {loading ? (
                <>
                  <span className="dot">·</span>
                  <span className="skeleton" style={{ display: 'inline-block', width: 140, height: 16, borderRadius: 4 }} />
                </>
              ) : (
                <>
                  {show.number_of_seasons != null && (
                    <>
                      <span className="dot">·</span>
                      <span>{show.number_of_seasons} Season{show.number_of_seasons !== 1 ? 's' : ''}</span>
                    </>
                  )}
                  {show.number_of_episodes != null && (
                    <>
                      <span className="dot">·</span>
                      <span>{show.number_of_episodes} Episodes</span>
                    </>
                  )}
                </>
              )}
              {show.vote_average > 0 && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating">★ {show.vote_average.toFixed(1)}</span>
                </>
              )}
              {!loading && show.status && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating" style={{ color: show.status === 'Ended' ? 'var(--text-muted)' : 'var(--success)' }}>
                    {show.status}
                  </span>
                </>
              )}
            </div>

            {/* TV badge */}
            <div style={{ marginBottom: 8 }}>
              <span className="genre-tag" style={{ color: 'var(--warning)', borderColor: 'var(--warning)' }}>📺 TV Series</span>
              {!loading && networks.slice(0, 2).map((n) => (
                <span key={n} className="genre-tag" style={{ marginLeft: 6 }}>{n}</span>
              ))}
            </div>

            {/* Genres */}
            {loading ? (
              <div className="movie-detail__genres" style={{ display: 'flex', gap: 6, margin: '8px 0' }}>
                <span className="skeleton" style={{ width: 60, height: 24, borderRadius: 12 }} />
                <span className="skeleton" style={{ width: 80, height: 24, borderRadius: 12 }} />
                <span className="skeleton" style={{ width: 70, height: 24, borderRadius: 12 }} />
              </div>
            ) : genres.length > 0 && (
              <div className="movie-detail__genres">
                {genres.map((g) => (
                  <Link
                    key={g}
                    to={`/search?genre=${encodeURIComponent(g)}`}
                    className="genre-tag genre-tag--link"
                  >
                    {g}
                  </Link>
                ))}
              </div>
            )}

            {/* Created by */}
            {loading ? (
              <div className="skeleton" style={{ height: 20, width: '30%', borderRadius: 6, margin: '8px 0' }} />
            ) : createdBy.length > 0 && (
              <p className="movie-detail__director">
                <span className="label">Created by</span>{' '}
                {createdBy.map((c, idx) => (
                  <span key={c.id}>
                    <Link to={`/person/${c.id}`} className="director-link">{c.name}</Link>
                    {idx < createdBy.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            )}

            {/* Overview */}
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0 24px 0' }}>
                <div className="skeleton" style={{ height: 16, width: '100%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '95%', borderRadius: 4 }} />
                <div className="skeleton" style={{ height: 16, width: '60%', borderRadius: 4 }} />
              </div>
            ) : show.overview && (
              <p className="movie-detail__overview">{show.overview}</p>
            )}

            {/* Actions */}
            <div className="movie-detail__actions animate-fade-lift">
              {isLoggedIn ? (
                <>
                  {isReturningSeries ? (
                    <button
                      id={`btn-watched-${tvId}`}
                      className={`btn btn--md ${trackingStatus ? 'btn--success' : 'btn--secondary'}`}
                      onClick={handleTrackingToggle}
                      disabled={trackingBusy}
                      aria-label={trackingStatus ? 'Untrack show' : 'Track show'}
                    >
                      {trackingStatus ? '✓ Watching' : '▶ Watching'}
                    </button>
                  ) : (
                    <button
                      id={`btn-watched-${tvId}`}
                      className={`btn btn--md ${watchStatus.watched ? 'btn--success' : 'btn--secondary'}`}
                      onClick={handleMarkWatched}
                      disabled={watchBusy}
                      aria-label={watchStatus.watched ? 'Remove from watched' : 'Mark as watched'}
                    >
                      {watchStatus.watched ? '✓ Watched' : '○ Mark Watched'}
                    </button>
                  )}
                  {(!watchStatus.watched && !watchStatus.user_rating) && (
                    <button
                      id={`btn-plantowatch-${tvId}`}
                      className={`btn btn--md ${planToWatch ? 'btn--accent' : 'btn--secondary'}`}
                      onClick={handlePlanToWatch}
                      disabled={planBusy}
                      aria-label={planToWatch ? 'Remove from Plan to Watch' : 'Plan to Watch'}
                    >
                      {planToWatch ? '✓ Plan to Watch' : '+ Plan to Watch'}
                    </button>
                  )}
                  <button
                    id={`btn-watchlist-${tvId}`}
                    className={`btn btn--md ${isInAnyCollection ? 'btn--accent' : 'btn--secondary'}`}
                    onClick={() => setShowCollectionModal(true)}
                    aria-label={isInAnyCollection ? 'Manage in watchlists' : 'Add to watchlist'}
                  >
                    {isInAnyCollection ? '★ Watchlist' : '+ Watchlist'}
                  </button>
                  <button
                    className="btn btn--secondary btn--md btn--trailer"
                    onClick={() => setIsTrailerModalOpen(true)}
                    aria-label="Play Trailer"
                  >
                    ▶ Trailer
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="btn btn--secondary btn--md">
                    + Watchlist
                  </Link>
                  <Link to="/login" className="btn btn--secondary btn--md">
                    {isReturningSeries ? '▶ Watching' : '○ Mark Watched'}
                  </Link>
                  <button
                    className="btn btn--secondary btn--md btn--trailer"
                    onClick={() => setIsTrailerModalOpen(true)}
                    aria-label="Play Trailer"
                  >
                    ▶ Trailer
                  </button>
                </>
              )}
            </div>

            {/* Toast */}
            {watchMsg && (
              <p className="movie-detail__toast" aria-live="polite">{watchMsg}</p>
            )}

            {/* Seasons Details Card */}
            {show.seasons && show.seasons.length > 0 && (
              <div className="tv-detail__seasons">
                <h4 className="tv-detail__seasons-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: '6px', opacity: 0.8, verticalAlign: 'middle' }}>
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect>
                    <polyline points="17 2 12 7 7 2"></polyline>
                  </svg>
                  Season Details
                </h4>
                <div className="tv-detail__seasons-list">
                  {show.seasons.map((s, idx) => (
                    <div key={s.id} className="tv-season-item">
                      <span className="tv-season-name">{idx + 1}) {s.name}</span>
                      <span className="tv-season-info">
                        <span className="tv-season-episodes">{s.episode_count} Episodes</span>
                        {s.air_date && (
                          <>
                            <span className="dot">·</span>
                            <span className="tv-season-date">Aired: {new Date(s.air_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}</span>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                {show.next_episode_to_air && (
                  <div className="tv-detail__upcoming">
                    <span className="tv-upcoming-badge">Upcoming</span>
                    <span className="tv-upcoming-info">
                      S{show.next_episode_to_air.season_number}E{show.next_episode_to_air.episode_number} - {show.next_episode_to_air.name || 'TBA'}
                      {show.next_episode_to_air.air_date && (
                        <span className="tv-upcoming-date"> ({new Date(show.next_episode_to_air.air_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })})</span>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Rating Sidebar */}
          <div className="movie-detail__rating-sidebar">
            {showRatingMeter ? (
              <div className="animate-rating-reveal">
                <RatingMeter
                  movieId={tvId}
                  mediaType="tv"
                  onRated={fetchStatus}
                  onRatingRemoved={async () => {
                    await watchService.removeFromHistory(tvId, 'tv')
                    setWatchStatus((s) => ({ ...s, watched: false, user_rating: null, rating_id: null }))
                  }}
                  userRating={watchStatus.user_rating}
                  userRatingId={watchStatus.rating_id}
                  {...(show.moctale_rating || {})}
                />
              </div>
            ) : (
              <div className="skeleton rating-meter-skeleton" style={{ height: 280, borderRadius: 16 }} />
            )}
            {showRatingMeter && (!show.moctale_rating || !show.moctale_rating.total_votes) && (
              <div className="rating-needed-box animate-fade-lift">
                <p className="rating-needed-box__msg">Want to know rating?</p>
                <button
                  className={`rating-needed-box__btn ${reqNeededState.success ? 'rating-needed-box__btn--success' : ''}`}
                  onClick={handleRequestRating}
                  disabled={reqNeededState.loading || reqNeededState.success}
                >
                  {reqNeededState.success ? '✓ Requested' : reqNeededState.loading ? 'Requesting...' : 'Request Rating'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Cast & Crew (reuse CastCrew with tvId flag) ── */}
        <CastCrew movieId={tvId} isTV />

        {/* ── Production Companies & Countries ── */}
        <ProductionTags
          productionCompanies={productionCompanies}
          productionCountries={productionCountries}
        />
        {/* ── Similar Items ── */}
        <div className="movie-detail__similar">
          <MovieRow
            title="More Like This"
            movies={similar}
            loading={similarLoading}
            seeAllHref="/explore"
            premiumScroll={true}
            showFeedback={true}
            emptyText="No similar titles found."
          />
        </div>
      </div>

      {/* Full screen modal */}
      {isModalOpen && posterUrl && (
        <div 
          className="person-page-image-modal" 
          onClick={() => setIsModalOpen(false)}
        >
          <button className="person-page-image-modal-close" onClick={() => setIsModalOpen(false)}>✕</button>
          <img 
            src={show.poster_path ? `${TMDB_IMAGE_BASE}/w780${show.poster_path}` : posterUrl} 
            alt={show.title} 
            className="person-page-image-modal-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Trailer Modal */}
      {videosData && (
        <TrailerModal
          isOpen={isTrailerModalOpen}
          onClose={() => setIsTrailerModalOpen(false)}
          data={videosData}
          seasons={show?.seasons}
          tvId={tvId}
        />
      )}

      {/* Save to Collection Modal */}
      <SaveToCollectionModal
        movieId={tvId}
        mediaType="tv"
        isOpen={showCollectionModal}
        onClose={() => {
          setShowCollectionModal(false)
          fetchStatus()
        }}
      />
    </main>
  )
}
