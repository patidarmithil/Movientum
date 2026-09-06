/**
 * MovieDetail Page — Phase 3.5C
 *
 * Replaces dummy data with live API calls.
 * Adds:
 *  - RatingMeter with category distribution
 *  - "Mark Watched" button → POST /api/v1/watch
 *  - "Add/Remove Watchlist" button → POST/DELETE /api/v1/watch/watchlist
 *  - Similar Movies row → GET /api/v1/recommendations/similar/{id}
 */
import { useParams, Link, useLocation } from 'react-router-dom'
import { useState, useEffect, useCallback, useRef } from 'react'
import { pageService } from '../services/pageService'
import { movieService } from '../services/movieService'
import { watchService } from '../services/watchService'
import { ratingService } from '../services/ratingService'
import { useAuth } from '../context/AuthContext'
import MovieCard from '../components/MovieCard'
import RatingMeter from '../components/RatingMeter'
import MovieCardSkeleton from '../components/MovieCardSkeleton'
import CastCrew from '../components/CastCrew'
import NewsArticlesSection from '../components/NewsArticlesSection'
import TrailerModal from '../components/TrailerModal'
import ImageLightbox from '../components/ImageLightbox'
import ProductionTags from '../components/ProductionTags'
import ShinyText from '../components/ShinyText'
import SaveToCollectionModal from '../components/SaveToCollectionModal'
import { pageCache } from '../utils/pageCache'
import { resolveOttLink } from '../utils/ottLinks'
import { fireBurst } from '../utils/burstEffect'
import { watchlistService } from '../services/watchlistService'
import { planToWatchService } from '../services/planToWatchService'
import StaggerContainer, { StaggerItem } from '../components/StaggerContainer'
import LazyMount from '../components/LazyMount'
import MovieRow from '../components/MovieRow'
import AIRecommendations from '../components/AIRecommendations'
import './MovieDetail.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

const formatUSD = (val) => {
  if (!val) return 'N/A';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
};

const formatINR = (val) => {
  if (!val) return 'N/A';
  const inrVal = val * 83.5;
  if (inrVal >= 10000000) {
    return `Rs. ${(inrVal / 10000000).toFixed(2).replace(/\.00$/, '')} Cr.`;
  } else if (inrVal >= 100000) {
    return `Rs. ${(inrVal / 100000).toFixed(2).replace(/\.00$/, '')} Lakh`;
  }
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(inrVal);
};

// ── Collection Box (Sequel/Prequel) ──────────────────────────────
function CollectionBox({ name, parts }) {
  const scrollRef = useRef(null)
  
  // Dragging state refs
  const isDragging = useRef(false)
  const startX = useRef(0)
  const scrollLeftStart = useRef(0)

  const handleMouseDown = (e) => {
    isDragging.current = true
    const el = scrollRef.current
    if (!el) return
    startX.current = e.pageX - el.offsetLeft
    scrollLeftStart.current = el.scrollLeft
    el.style.scrollBehavior = 'auto'
    el.style.cursor = 'grabbing'
  }

  const handleMouseMove = (e) => {
    if (!isDragging.current) return
    e.preventDefault()
    const el = scrollRef.current
    if (!el) return
    const x = e.pageX - el.offsetLeft
    const walk = (x - startX.current) * 2 // Scroll fast multiplier
    el.scrollLeft = scrollLeftStart.current - walk
  }

  const handleMouseUpOrLeave = () => {
    isDragging.current = false
    const el = scrollRef.current
    if (el) {
      el.style.scrollBehavior = 'smooth'
      el.style.cursor = 'grab'
    }
  }

  return (
    <div className="movie-detail__collection-box">
      <h4 className="collection-box__title">{name}</h4>
      <div className="scroll-row-container collection-box__scroll-wrap">
        <div 
          className="scroll-row collection-box__row" 
          ref={scrollRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUpOrLeave}
          onMouseLeave={handleMouseUpOrLeave}
          style={{ cursor: 'grab', userSelect: 'none' }}
        >
          {parts.map(part => (
            <Link
              key={part.id}
              to={`/movies/${part.id}`}
              className="collection-card"
              onDragStart={(e) => e.preventDefault()} // Prevent image dragging from interfering
            >
              <div className="collection-card__poster-wrap">
                <img
                  src={`${TMDB_IMAGE_BASE}/w185${part.poster_path}`}
                  alt={part.title}
                  className="collection-card__poster"
                  loading="lazy"
                  onDragStart={(e) => e.preventDefault()}
                />
                <span className={`collection-card__badge badge--${part.badge.toLowerCase().replace(' ', '-')}`}>
                  {part.badge}
                </span>
              </div>
              <p className="collection-card__title">{part.title}</p>
              {part.release_date && (
                <p className="collection-card__year">{part.release_date.slice(0, 4)}</p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function MovieDetail() {
  const { id } = useParams()
  const movieId = Number(id)
  const { isLoggedIn } = useAuth()
  const location = useLocation()
  const passedMovie = location.state?.movie

  const cacheKey = `movie-detail-${movieId}`
  const cachedData = pageCache.get(cacheKey)

  const [movie,         setMovie]         = useState(() => {
    if (cachedData?.movie) return cachedData.movie
    if (passedMovie) {
      return {
        id: passedMovie.id,
        title: passedMovie.title || passedMovie.name,
        poster_path: passedMovie.poster_path,
        backdrop_path: passedMovie.backdrop_path,
        release_year: passedMovie.release_year,
        release_date: passedMovie.release_date,
        vote_average: passedMovie.vote_average,
        media_type: passedMovie.media_type || 'movie'
      }
    }
    return null
  })
  const [similar,       setSimilar]       = useState(cachedData?.similar || [])
  const [watchStatus,   setWatchStatus]   = useState(cachedData?.watchStatus || { watched: false, watchlisted: false })
  const [loading,       setLoading]       = useState(!cachedData?.movie)
  const [similarLoading,setSimilarLoading]= useState(!cachedData?.similar)
  const [error,         setError]         = useState(null)
  const [hasImgError,   setHasImgError]   = useState(false)
  const [watchBusy,     setWatchBusy]     = useState(false)
  const [listBusy,      setListBusy]      = useState(false)
  const [watchMsg,      setWatchMsg]      = useState(null)
  const [isModalOpen,   setIsModalOpen]   = useState(false)
  const [overviewExpanded, setOverviewExpanded] = useState(false)
  const [reqNeededState, setReqNeededState] = useState({ loading: false, success: false })
  
  const [showCollectionModal, setShowCollectionModal] = useState(false)
  const [isInAnyCollection, setIsInAnyCollection] = useState(false)
  
  const [planToWatch, setPlanToWatch] = useState(false)
  const [planToWatchId, setPlanToWatchId] = useState(null)
  const [planBusy, setPlanBusy] = useState(false)
  
  const [videosData,    setVideosData]    = useState(cachedData?.videosData || null)
  const [isTrailerModalOpen, setIsTrailerModalOpen] = useState(false)

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

  const trailerKey = videosData?.trailer_key || null

  const [collection, setCollection] = useState(null)
  const [providers, setProviders] = useState(cachedData?.providers || null)
  // Credits ride along in the page bundle and are handed to <CastCrew> as a prop
  // so it doesn't fire its own request.
  const [credits, setCredits] = useState(cachedData?.credits || null)

  useEffect(() => {
    if (movie) {
      document.title = `${movie.title} - Movientum`
    } else {
      document.title = 'Movie Details - Movientum'
    }
  }, [movie])

  useEffect(() => {
    setPosterLoaded(false)
    setShowRatingMeter(false)
    setVideoReady(false)
  }, [movieId])

  useEffect(() => {
    // Check performance guards for autoplay
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (navigator.connection && (navigator.connection.effectiveType === '2g' || navigator.connection.effectiveType === 'slow-2g')) return
    setShowVideo(true)
  }, [])

  useEffect(() => {
    if (!showVideo || !trailerKey || !backdropContainerRef.current) return;

    let isApiReady = !!window.YT && !!window.YT.Player;

    const initPlayer = () => {
      if (playerRef.current) return; // already init
      playerRef.current = new window.YT.Player(`yt-player-${movieId}`, {
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
        // Save original callback if exists
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
  }, [showVideo, trailerKey, movieId]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const iframe = document.getElementById(`yt-player-${movieId}`);
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
  }, [movieId]);

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
    const iframe = document.getElementById(`yt-player-${movieId}`);
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
  }, [movie])

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

  const handleRequestRating = async () => {
    if (!movie || reqNeededState.loading || reqNeededState.success) return
    setReqNeededState({ loading: true, success: false })
    try {
      await ratingService.requestRatingNeeded(
        movieId,
        movie.title,
        'movie',
        movie.release_year
      )
      setReqNeededState({ loading: false, success: true })
    } catch (err) {
      setReqNeededState({ loading: false, success: false })
    }
  }

  // ── Fetch the whole page in one request ──────────────
  // GET /api/v1/pages/movie/{id} returns detail + videos + credits + collection
  // + similar + this user's watch/list status, all from a single Redis key.
  // Previously this page fired five requests in sequence-ish waves (detail and
  // videos on mount, then collection and similar once detail resolved, then
  // three more for status) — the similar/collection waves in particular made the
  // page render in stages.
  useEffect(() => {
    let cancelled = false
    if (!cachedData?.movie) {
      setLoading(true)
    }
    if (similar.length === 0) {
      setSimilarLoading(true)
    }
    setError(null)
    setHasImgError(false)

    pageService.getMovie(movieId)
      .then((data) => {
        if (cancelled) return

        const detail = data?.detail || null
        const creditsData = data?.credits || null

        // `similar: null` is the backend saying "this section was not cached and
        // I refused to block the page on recomputing it". Everything above the
        // fold paints now; the row keeps its skeleton and is fetched on its own
        // just below. An empty `{movies: []}` is a real answer and is honoured.
        const similarPending = data?.similar == null
        const similarData = data?.similar?.movies || []

        if (detail) setMovie(detail)
        setVideosData(data?.videos || null)
        setCredits(creditsData)
        setProviders(data?.providers?.available ? data.providers : null)
        if (!similarPending) setSimilar(similarData)

        // Franchise strip: drop the movie being viewed, then label each remaining
        // part relative to its release date.
        const rawColl = data?.collection
        if (rawColl && detail) {
          const currentDate = detail.release_date || ''
          const parts = (rawColl.parts || [])
            .filter((p) => p.id !== movieId)
            .map((p, idx) => {
              let badge = `PART ${idx + 1}`
              if (p.release_date && currentDate) {
                badge = p.release_date < currentDate ? 'PREQUEL' : 'SEQUEL'
              }
              return { ...p, badge }
            })
          setCollection(parts.length > 0 ? { name: rawColl.name, parts } : null)
        } else {
          setCollection(null)
        }

        // Auth-only sections — null for guests, in which case the effect below
        // leaves the defaults alone.
        if (data?.watch_status) setWatchStatus(data.watch_status)
        if (data?.collections) {
          setIsInAnyCollection(data.collections.some((c) => c.has_movie))
          const plan = data.collections.find((c) => c.name === 'Plan to Watch')
          setPlanToWatch(plan ? plan.has_movie : false)
          setPlanToWatchId(plan ? plan.id : null)
        }

        pageCache.set(cacheKey, {
          ...(pageCache.get(cacheKey) || {}),
          movie: detail,
          videosData: data?.videos || null,
          credits: creditsData,
          providers: data?.providers?.available ? data.providers : null,
          ...(similarPending ? {} : { similar: similarData }),
          watchStatus: data?.watch_status || undefined,
        })

        // Everything above the fold is on screen at this point.
        setLoading(false)

        if (!similarPending) {
          setSimilarLoading(false)
          return
        }

        // Second request, only on a cold title: same endpoint the row always
        // used, so the results are exactly what the bundle would have carried.
        movieService.getSimilar(movieId, 'movie')
          .then((res) => {
            if (cancelled) return
            const rows = res?.movies || []
            setSimilar(rows)
            pageCache.set(cacheKey, { ...(pageCache.get(cacheKey) || {}), similar: rows })
          })
          .catch(() => { if (!cancelled) setSimilar([]) })
          .finally(() => { if (!cancelled) setSimilarLoading(false) })
      })
      .catch(() => {
        if (cancelled) return
        if (!movie || !movie.overview) setError('Failed to load movie')
        setSimilar([])
        setCredits({ cast: [], crew: [] })
        setLoading(false)
        setSimilarLoading(false)
      })

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movieId])

  // ── Refetch watch status after a mutation ────────────
  // Still goes through the individual endpoints: it runs *after* the user acts,
  // when the bundle for this title has just been invalidated server-side anyway.
  const fetchStatus = useCallback(() => {
    if (!isLoggedIn) return
    watchService.getStatus(movieId)
      .then((status) => {
        setWatchStatus(status)
        const curr = pageCache.get(cacheKey) || {}
        pageCache.set(cacheKey, { ...curr, watchStatus: status })
      })
      .catch(() => {})

    watchlistService.getMovieStatus(movieId)
      .then(res => {
        const inAny = res.collections?.some(c => c.has_movie)
        setIsInAnyCollection(inAny)
      })
      .catch(() => {})

    planToWatchService.checkStatus(movieId)
      .then(({ inList, listId }) => {
        setPlanToWatch(inList)
        setPlanToWatchId(listId)
      })
      .catch(() => {})
  }, [movieId, isLoggedIn])

  // First run is skipped — the bundle above already carried the status.
  const statusInitRef = useRef(true)
  useEffect(() => {
    if (statusInitRef.current) {
      statusInitRef.current = false
      return
    }
    fetchStatus()
  }, [fetchStatus])

  // ── Toggle Plan to Watch ─────────────────────────────
  const handlePlanToWatch = async (e) => {
    if (!isLoggedIn || planBusy) return
    const btn = e?.currentTarget
    setPlanBusy(true)
    try {
      if (planToWatch) {
        await planToWatchService.remove(planToWatchId, movieId)
        setPlanToWatch(false)
        setWatchMsg('Removed from Plan to Watch')
      } else {
        const { listId } = await planToWatchService.add(movieId)
        setPlanToWatchId(listId)
        setPlanToWatch(true)
        setWatchMsg('Added to Plan to Watch!')
        fireBurst(btn)
      }
      setTimeout(() => setWatchMsg(null), 2500)
    } catch {
      setWatchMsg('Failed — try again')
      setTimeout(() => setWatchMsg(null), 2500)
    } finally {
      setPlanBusy(false)
    }
  }

  // ── Toggle watched ───────────────────────────────────
  const handleWatchedToggle = async (e) => {
    if (!isLoggedIn || watchBusy) return
    const btn = e?.currentTarget
    setWatchBusy(true)
    try {
      if (watchStatus.watched) {
        if (watchStatus.rating_id) {
          await ratingService.deleteRating(watchStatus.rating_id)
        }
        await watchService.removeFromHistory(movieId)
        setWatchStatus((s) => ({ ...s, watched: false, user_rating: null, rating_id: null }))
        setWatchMsg('Removed from watch history')
        setTimeout(() => setWatchMsg(null), 2500)
      } else {
        await watchService.markWatched(movieId)
        setWatchStatus((s) => ({ ...s, watched: true }))
        setWatchMsg('Added to watch history!')
        fireBurst(btn)
        if (planToWatch) {
          try {
            await planToWatchService.remove(planToWatchId, movieId)
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



  // ── Render: loading without metadata ──────────────────
  if (loading && !movie) {
    return (
      <main className="movie-detail page-content">
        <div className="container">
          <div className="movie-detail__top animate-fade-lift">
            <div className="movie-detail__poster-col">
              <div className="skeleton" style={{ width: 240, height: 360, borderRadius: 16 }} />
            </div>
            <div className="movie-detail__info-col" style={{ gap: 16 }}>
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

  // ── Render: error ────────────────────────────────────
  if (error || !movie) {
    return (
      <main className="movie-detail page-content">
        <div className="container" style={{ paddingTop: 80 }}>
          <div className="error-state">
            <h2>Movie not found</h2>
            <p>{error || 'This movie does not exist.'}</p>
            <Link to="/movies" className="btn btn--ghost btn--md" style={{ marginTop: 16, display: 'inline-block' }}>
              ← Back to Movies
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const posterUrl  = movie.poster_path   ? `${TMDB_IMAGE_BASE}/w300${movie.poster_path}`   : null
  const backdropUrl = movie.backdrop_path ? `${TMDB_IMAGE_BASE}/w1280${movie.backdrop_path}` : null
  const genres     = movie.genres || []
  const directors  = movie.directors || []

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
              <div id={`yt-player-${movieId}`} />
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
                alt={`${movie.title} poster`}
                className={`movie-detail__poster clickable-poster poster-progressive ${posterLoaded ? 'poster-progressive--loaded' : ''}`}
                onClick={() => setIsModalOpen(true)}
                onLoad={() => setPosterLoaded(true)}
                onError={() => setHasImgError(true)}
              />
            ) : (
              <div className="movie-detail__poster-fallback">{movie.title}</div>
            )}
          </div>

          {/* Info */}
          <div className="movie-detail__info-col animate-fade-lift">
            <h1 className="movie-detail__title">{movie.title}</h1>

            {/* Meta */}
            <div className="movie-detail__meta">
              {movie.release_date && (
                <span>{new Date(movie.release_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              )}
              {loading ? (
                <>
                  <span className="dot">·</span>
                  <span className="skeleton" style={{ display: 'inline-block', width: 60, height: 16, borderRadius: 4 }} />
                </>
              ) : movie.runtime && (
                <>
                  <span className="dot">·</span>
                  <span>{movie.runtime} min</span>
                </>
              )}
              {movie.vote_average > 0 && (
                <>
                  <span className="dot">·</span>
                  <span className="movie-detail__rating">★ {movie.vote_average.toFixed(1)}</span>
                </>
              )}
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

            {/* Director */}
            {loading ? (
              <div className="skeleton" style={{ height: 20, width: '30%', borderRadius: 6, margin: '8px 0' }} />
            ) : directors.length > 0 && (
              <p className="movie-detail__director">
                <span className="label">Directed by</span>{' '}
                {directors.map((d, idx) => (
                  <span key={d.id}>
                    <Link to={`/person/${d.id}`} className="director-link">{d.name}</Link>
                    {idx < directors.length - 1 ? ', ' : ''}
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
            ) : movie.overview && (
              <div className="movie-detail__overview-block">
                <p className={`movie-detail__overview ${!overviewExpanded && movie.overview.length > 260 ? 'movie-detail__overview--clamped' : ''}`}>
                  {movie.overview}
                </p>
                {movie.overview.length > 260 && (
                  <button
                    type="button"
                    className="movie-detail__read-more"
                    onClick={() => setOverviewExpanded((v) => !v)}
                  >
                    {overviewExpanded ? 'Show Less' : 'Read More'}
                  </button>
                )}
              </div>
            )}

            {/* Actions & Financials Container */}
            <div className="movie-detail__actions-row">
              {/* Actions */}
              <div className="movie-detail__actions">
                {isLoggedIn ? (
                  <>
                    <button
                      id={`btn-watched-${movieId}`}
                      className={`btn btn--md ${watchStatus.watched ? 'btn--success' : 'btn--secondary'}`}
                      onClick={handleWatchedToggle}
                      disabled={watchBusy}
                      aria-label={watchStatus.watched ? 'Remove from watched' : 'Mark as watched'}
                    >
                      {watchStatus.watched ? '✓ Watched' : '○ Mark Watched'}
                    </button>
                    {!watchStatus.watched && (
                      <button
                        id={`btn-plantowatch-${movieId}`}
                        className={`btn btn--md ${planToWatch ? 'btn--accent' : 'btn--secondary'}`}
                        onClick={handlePlanToWatch}
                        disabled={planBusy}
                        aria-label={planToWatch ? 'Remove from Plan to Watch' : 'Plan to Watch'}
                      >
                        {planToWatch ? '✓ Plan to Watch' : '+ Plan to Watch'}
                      </button>
                    )}
                    <button
                      id={`btn-watchlist-${movieId}`}
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
                      ○ Mark Watched
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
            </div>

            {/* Where to Watch (OTT) */}
            {providers && providers.providers.length > 0 && (
              <div className="movie-detail__ott">
                <div className="movie-detail__ott-header">
                  <h4>Watch Online</h4>
                </div>
                <div className="movie-detail__ott-list">
                  {providers.providers.map((p) => {
                    // Each row goes to that platform with the title already
                    // searched, instead of every logo pointing at the same TMDB
                    // redirect page. Unmapped providers keep the TMDB link.
                    const { url, direct } = resolveOttLink(p, {
                      title: movie.title,
                      year: movie.release_year || (movie.release_date || '').slice(0, 4),
                      region: providers.region,
                      mediaType: 'movie',
                      fallback: providers.link,
                    })
                    return (
                    <a
                      key={p.id}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="movie-detail__ott-row"
                      aria-label={
                        direct
                          ? `Find ${movie.title} on ${p.name} (opens in a new tab)`
                          : `Where to watch ${movie.title} (opens in a new tab)`
                      }
                    >
                      <img className="movie-detail__ott-logo" src={p.logo_path} alt="" loading="lazy" />
                      <span className="movie-detail__ott-meta">
                        <span className="movie-detail__ott-name">{p.name}</span>
                        <span className="movie-detail__ott-category">{p.category}</span>
                      </span>
                      <svg className="movie-detail__ott-go" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="7" y1="17" x2="17" y2="7"></line>
                        <polyline points="7 7 17 7 17 17"></polyline>
                      </svg>
                    </a>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Toast */}
            {watchMsg && (
              <p className="movie-detail__toast" aria-live="polite">{watchMsg}</p>
            )}

            {/* Collection Box */}
            {collection && (
              <CollectionBox
                name={collection.name}
                parts={collection.parts}
                currentMovieDate={movie.release_date}
              />
            )}
          </div>

          {/* Rating Sidebar */}
          <div className="movie-detail__rating-sidebar">
            {showRatingMeter ? (
              <div className="animate-rating-reveal">
                <RatingMeter
                  movieId={movieId}
                  onRated={fetchStatus}
                  onRatingRemoved={async () => {
                    await watchService.removeFromHistory(movieId)
                    setWatchStatus((s) => ({ ...s, watched: false, user_rating: null, rating_id: null }))
                  }}
                  userRating={watchStatus.user_rating}
                  userRatingId={watchStatus.rating_id}
                  {...(movie.moctale_rating || { total_votes: 0, perfection: 0, go_for_it: 0, timepass: 0, skip: 0 })}
                />
              </div>
            ) : (
              <div className="skeleton rating-meter-skeleton" style={{ height: 280, borderRadius: 16 }} />
            )}

            {/* Financial Information (Budget & Revenue) */}
            {(movie.budget > 0 || movie.revenue > 0) && (
              <div className="movie-detail__financials">
                {movie.budget > 0 && (
                  <div className="financial-item">
                    <span className="financial-label">Budget</span>
                    <span className="financial-value">
                      <span className="usd-val">{formatUSD(movie.budget)}</span>
                      <span className="inr-val"> ({formatINR(movie.budget)})</span>
                    </span>
                  </div>
                )}
                {movie.revenue > 0 && (
                  <div className="financial-item">
                    <span className="financial-label">Revenue</span>
                    <span className="financial-value">
                      <span className="usd-val">{formatUSD(movie.revenue)}</span>
                      <span className="inr-val"> ({formatINR(movie.revenue)})</span>
                    </span>
                  </div>
                )}
              </div>
            )}

            {showRatingMeter && (!movie.moctale_rating || !movie.moctale_rating.total_votes) && (
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

        {/* ── Cast & Crew ── */}
        {/* Rendered once the bundle has delivered credits, so CastCrew never
            falls back to fetching them itself. */}
        {credits && <CastCrew movieId={movieId} credits={credits} />}

        {/* ── In The News ── */}
        {/* Deferred: this section fetches its own feed on mount, and that
            request used to leave the gate alongside the page bundle. */}
        <LazyMount minHeight={160}>
          <NewsArticlesSection itemId={movieId} mediaType="movie" />
        </LazyMount>

        {/* ── Production Companies & Countries ── */}
        <ProductionTags
          productionCompanies={movie.production_companies || []}
          productionCountries={movie.production_countries || []}
        />

        {/* ── Similar Movies ── */}
        <div className="movie-detail__similar">
          <MovieRow
            title="More Like This"
            movies={similar}
            loading={similarLoading}
            seeAllHref="/movies"
            premiumScroll={true}
            showFeedback={true}
            feedbackSource="more_like_this"
            emptyText="No similar movies found."
          />
        </div>

        {/* ── AI Recommendations ── */}
        {movie && (
          <LazyMount minHeight={200}>
            <div className="movie-detail__ai-recs">
              <AIRecommendations
                seedTmdbId={movie.id}
                seedMediaType="movie"
                seedTitle={movie.title}
              />
            </div>
          </LazyMount>
        )}
      </div>

      {/* The poster opens in the shared lightbox — same gesture, same chrome and
          the same Escape-to-close as the person page and the tier board. */}
      {isModalOpen && posterUrl && (
        <ImageLightbox
          src={movie.poster_path ? `${TMDB_IMAGE_BASE}/original${movie.poster_path}` : posterUrl}
          alt={movie.title}
          caption={movie.title}
          onClose={() => setIsModalOpen(false)}
        />
      )}

      {/* Trailer Modal */}
      {videosData && (
        <TrailerModal
          isOpen={isTrailerModalOpen}
          onClose={() => setIsTrailerModalOpen(false)}
          data={videosData}
        />
      )}

      {/* Save to Collection Modal */}
      <SaveToCollectionModal
        movieId={movieId}
        isOpen={showCollectionModal}
        onClose={() => {
          setShowCollectionModal(false)
          fetchStatus()
        }}
      />
    </main>
  )
}
