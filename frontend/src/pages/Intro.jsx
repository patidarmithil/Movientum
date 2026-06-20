import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import profileImg from '../assets/profile.jpeg'
import meterImg from '../assets/meter.png'
import watchlistImg from '../assets/watchlist.png'
import { movieService } from '../services/movieService'
import './Intro.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'

// Poster placeholder data — color gradients simulating real poster artwork
const POSTER_COLORS = [
  'linear-gradient(160deg,#1a0533 0%,#4a1070 100%)',
  'linear-gradient(160deg,#0d1f3c 0%,#1a4a7a 100%)',
  'linear-gradient(160deg,#1f0d0d 0%,#6b1a1a 100%)',
  'linear-gradient(160deg,#0d3020 0%,#1a6b4a 100%)',
  'linear-gradient(160deg,#2a1a0d 0%,#7a4a1a 100%)',
  'linear-gradient(160deg,#1a1a2e 0%,#4a4a8a 100%)',
]

const POSTER_LABELS = ['Action', 'Drama', 'Thriller', 'Sci-Fi', 'Romance', 'Crime']

export default function Intro() {
  const observerRef = useRef(null)
  const [trendingMovies, setTrendingMovies] = useState([])
  const [libraryMovies, setLibraryMovies] = useState([])
  const [libraryPage, setLibraryPage] = useState(1)
  const [showContactModal, setShowContactModal] = useState(false)

  useEffect(() => {
    movieService.getTrending()
      .then((data) => {
        const movies = data?.movies || data || [];
        setTrendingMovies(movies.slice(0, 20));
      })
      .catch(err => console.error("Failed to fetch trending:", err));
  }, [])

  useEffect(() => {
    movieService.getMovies(libraryPage, 24)
      .then((data) => {
        const movies = data?.movies || data || [];
        setLibraryMovies(prev => [...prev, ...movies]);
      })
      .catch(err => console.error("Failed to fetch library:", err));
  }, [libraryPage])

  useEffect(() => {
    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
        }
      })
    }, { threshold: 0.12 })

    const elements = document.querySelectorAll('.intro-reveal, .intro-reveal-left, .intro-reveal-right, .intro-reveal-scale')
    elements.forEach(el => observerRef.current.observe(el))

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [])

  return (
    <div className="intro-page">

      {/* ── 1. Hero ── */}
      <section className="intro-hero">
        {/* Cinematic spotlight gradient */}
        <div className="intro-hero__spotlight" aria-hidden="true" />
        <div className="intro-hero__spotlight intro-hero__spotlight--secondary" aria-hidden="true" />

        {/* Text content above poster row */}
        <div className="container intro-hero__content">
          <div className="intro-hero__badge">
            <span className="intro-hero__badge-text">BETA</span>
          </div>
          <h1 className="intro-hero__title intro-reveal">
            Your movies. Your ratings.<br />Your community.
          </h1>
          <p className="intro-hero__sub intro-reveal" style={{ animationDelay: '100ms' }}>
            Movientum is the dark-mode home for movie &amp; series lovers.<br />
            Discover, rate, review, and build your watchlists — powered by AI-backed recommendations.
          </p>
          <div className="intro-hero__ctas intro-reveal" style={{ animationDelay: '200ms' }}>
            <Link to="/register" className="btn btn--primary btn--lg">Get Started &rarr;</Link>
            <Link to="/explore" className="btn btn--secondary btn--lg">Explore Movies</Link>
          </div>
        </div>

        {/* Real horizontal poster row — staggered heights + tilt */}
        <div className="intro-hero__posters-container" aria-hidden="true">
          <div className="intro-hero__poster-row">
            {trendingMovies.length > 0 ? trendingMovies.slice(0, 6).map((movie, i) => (
              <div key={`r1-${movie.id}`} className={`intro-hero__poster-card intro-hero__poster-card--${i + 1}`} style={{ backgroundImage: `url(${TMDB_IMAGE_BASE}${movie.poster_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            )) : null}
          </div>
          <div className="intro-hero__poster-row intro-hero__poster-row--offset">
            {trendingMovies.length > 0 ? trendingMovies.slice(6, 12).map((movie, i) => (
              <div key={`r2-${movie.id}`} className={`intro-hero__poster-card intro-hero__poster-card--${i + 1}`} style={{ backgroundImage: `url(${TMDB_IMAGE_BASE}${movie.poster_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            )) : null}
          </div>
          <div className="intro-hero__poster-row">
            {trendingMovies.length > 0 ? trendingMovies.slice(12, 18).map((movie, i) => (
              <div key={`r3-${movie.id}`} className={`intro-hero__poster-card intro-hero__poster-card--${i + 1}`} style={{ backgroundImage: `url(${TMDB_IMAGE_BASE}${movie.poster_path})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            )) : null}
          </div>
        </div>

        {/* Bottom fade into next section */}
        <div className="intro-hero__bottom-fade" aria-hidden="true" />
      </section>

      {/* ── 2. Features — asymmetric two-col alternating layout ── */}
      <section className="intro-features-section container">
        {/* Feature 1: Discover — image-collage left, text right */}
        <div className="intro-feature-row intro-reveal-left">
          <div className="intro-feature-row__visual">
            <div className="intro-feature-collage">
              <div className="intro-fc-card intro-fc-card--a" style={{ background: trendingMovies.length > 6 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[6].poster_path}) center/cover` : 'linear-gradient(135deg,#2a0a4a,#6a1aaa)' }} />
              <div className="intro-fc-card intro-fc-card--b" style={{ background: trendingMovies.length > 7 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[7].poster_path}) center/cover` : 'linear-gradient(135deg,#0a1a3a,#1a4a8a)' }} />
              <div className="intro-fc-card intro-fc-card--c" style={{ background: trendingMovies.length > 8 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[8].poster_path}) center/cover` : 'linear-gradient(135deg,#1a0a0a,#5a1a1a)' }} />
            </div>
          </div>
          <div className="intro-feature-row__text">
            <div className="intro-feature-row__icon" style={{ background: 'linear-gradient(135deg, rgba(176,72,255,0.2), rgba(176,72,255,0.05))', borderColor: 'rgba(176,72,255,0.4)' }}>
              <span>🎥</span>
            </div>
            <h2 className="intro-feature-row__title" style={{ color: '#B048FF' }}>Discover</h2>
            <p className="intro-feature-row__desc">Browse trending movies &amp; series, filter by genre, year, and country. Surface what's hot, what's hidden, what's yours.</p>
          </div>
        </div>

        {/* Feature 2: Rate — text left, visual right */}
        <div className="intro-feature-row intro-feature-row--reverse intro-reveal-right">
          <div className="intro-feature-row__text">
            <div className="intro-feature-row__icon" style={{ background: 'linear-gradient(135deg, rgba(255,195,0,0.2), rgba(255,195,0,0.05))', borderColor: 'rgba(255,195,0,0.4)' }}>
              <span>⭐</span>
            </div>
            <h2 className="intro-feature-row__title" style={{ color: '#FFC300' }}>Rate</h2>
            <p className="intro-feature-row__desc">Forget 5 stars. Use our unique 4-tier human scale: Skip / Timepass / Go For It / Perfection — ratings that actually mean something.</p>
          </div>
          <div className="intro-feature-row__visual">
            {/* Rating pills floating on a poster card */}
            <div className="intro-rating-poster-wrap">
              <div className="intro-rating-poster" style={{ background: trendingMovies.length > 2 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[2].poster_path}) center/cover` : 'linear-gradient(160deg,#1a0533 0%,#4a1070 60%,#2a0a2a 100%)' }}>
                <span className="intro-rating-poster__label" style={{textShadow: '0 1px 3px rgba(0,0,0,0.8)'}}>{trendingMovies.length > 2 ? trendingMovies[2].title : 'Drama'}</span>
              </div>
              <div className="intro-floating-tag" style={{ '--tag-color': '#00E5A0', top: '18%', left: '-18%' }}>
                🟢 Go For It
              </div>
              <div className="intro-floating-tag" style={{ '--tag-color': '#9B59FF', top: '55%', right: '-22%', transform: 'rotate(3deg)' }}>
                🟣 Perfection
              </div>
              <div className="intro-floating-tag" style={{ '--tag-color': '#FFC300', bottom: '12%', left: '-14%', transform: 'rotate(-4deg)' }}>
                🟡 Timepass
              </div>
            </div>
          </div>
        </div>

        {/* Feature 3: AI — image-collage left, text right */}
        <div className="intro-feature-row intro-reveal-left">
          <div className="intro-feature-row__visual">
            <div className="intro-feature-collage intro-feature-collage--ai">
              <div className="intro-fc-card intro-fc-card--a" style={{ background: trendingMovies.length > 0 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[0].poster_path}) center/cover` : 'linear-gradient(135deg,#0a2a1a,#1a6a4a)' }} />
              <div className="intro-fc-card intro-fc-card--b" style={{ background: trendingMovies.length > 1 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[1].poster_path}) center/cover` : 'linear-gradient(135deg,#1a1a2e,#4a4a8a)' }} />
              <div className="intro-fc-card intro-fc-card--c" style={{ background: trendingMovies.length > 3 ? `url(${TMDB_IMAGE_BASE}${trendingMovies[3].poster_path}) center/cover` : 'linear-gradient(135deg,#2a1a0a,#7a4a1a)' }} />
              <div className="intro-fc-ai-badge">🤖 AI</div>
            </div>
          </div>
          <div className="intro-feature-row__text">
            <div className="intro-feature-row__icon" style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(34,197,94,0.05))', borderColor: 'rgba(34,197,94,0.4)' }}>
              <span>🤖</span>
            </div>
            <h2 className="intro-feature-row__title" style={{ color: '#22C55E' }}>Recommendations</h2>
            <p className="intro-feature-row__desc">AI-powered picks based on your real taste. Our engine learns from what you rate, privately, and surfaces films you'll genuinely love.</p>
          </div>
        </div>
      </section>

      {/* ── 3. Rating System Showcase ── */}
      <section className="intro-ratings container intro-reveal-scale">
        <div className="intro-ratings__header">
          <h2>Rate Like a Human, Not a Robot</h2>
          <p>Forget 5-star systems. We built 4 real ratings that actually make sense.</p>
        </div>
        <div className="intro-ratings__content">
          <div className="intro-ratings__pills">
            <div className="intro-rating-pill" style={{ '--pill-color': '#FF4D6D', animationDelay: '0ms' }}>
              <span className="dot" />
              <span className="intro-rating-pill__name">Skip</span>
              <span className="desc">Not your thing? Skip it.</span>
            </div>
            <div className="intro-rating-pill" style={{ '--pill-color': '#FFC300', animationDelay: '120ms' }}>
              <span className="dot" />
              <span className="intro-rating-pill__name">Timepass</span>
              <span className="desc">Decent watch, no regrets.</span>
            </div>
            <div className="intro-rating-pill" style={{ '--pill-color': '#00E5A0', animationDelay: '240ms' }}>
              <span className="dot" />
              <span className="intro-rating-pill__name">Go For It</span>
              <span className="desc">Absolutely worth your time.</span>
            </div>
            <div className="intro-rating-pill" style={{ '--pill-color': '#9B59FF', animationDelay: '360ms' }}>
              <span className="dot" />
              <span className="intro-rating-pill__name">Perfection</span>
              <span className="desc">A masterpiece. Period.</span>
            </div>
          </div>
          <div className="intro-ratings__visual">
            <img src={meterImg} alt="Rating Meter" />
          </div>
        </div>
      </section>

      {/* ── 4. Watchlists & Collections ── */}
      <section className="intro-watchlists container intro-reveal-left">
        <div className="intro-watchlists__text">
          <h2>Create Watchlists With Lots of Content</h2>
          <p>Create unlimited watchlists and manage them with our proper filters system. Share your taste and follow others.</p>
        </div>
        <div className="intro-watchlists__visual">
          <div className="intro-watchlists__image intro-watchlists__image--curved">
            <img src={watchlistImg} alt="Watchlist Showcase" />
          </div>
        </div>
      </section>



      {/* ── 6. News & Explore ── */}
      <section className="intro-news-explore container intro-reveal-right">
        <div className="intro-split-panel intro-split-panel--left">
          <h2>Stay in the Loop</h2>
          <p>News from the movie world, updated daily.</p>
          <Link to="/news" className="btn btn--ghost">Browse News &rarr;</Link>
        </div>
        <div className="intro-split-panel intro-split-panel--right">
          <h2>Explore Everything</h2>
          <p>Filter by genre, country, year, company. Discover hidden gems.</p>
          <Link to="/explore" className="btn btn--ghost">Start Exploring &rarr;</Link>
        </div>
      </section>

      {/* ── 7. TMDB Library Grid ── */}
      <section className="intro-library container intro-reveal-scale">
        <div className="intro-library__header">
          <h2>Lakhs of Movies & TV Shows</h2>
          <p>Browse the entire TMDB library natively. Explore by genres, popularity, and hidden gems with our proper UI and filters.</p>
        </div>
        <div className="intro-library__filters">
          <button className="btn btn--primary btn--sm glow-pulse">Trending</button>
          <button className="btn btn--ghost btn--sm">Top Rated</button>
          <button className="btn btn--ghost btn--sm">Action</button>
          <button className="btn btn--ghost btn--sm">Sci-Fi</button>
          <button className="btn btn--ghost btn--sm">Romance</button>
        </div>
        <div className="intro-library__grid">
          {libraryMovies.map((movie, i) => (
            <div key={`${movie.id}-${i}`} className="intro-library-card">
              <img src={`${TMDB_IMAGE_BASE}${movie.poster_path}`} alt={movie.title} loading="lazy" />
              <div className="intro-library-card__overlay">
                <span className="intro-library-card__title">{movie.title}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="intro-library__load-more">
          <button className="btn btn--ghost btn--lg" onClick={() => setLibraryPage(p => p + 1)}>Load More Content</button>
        </div>
      </section>

      {/* ── 8. Final CTA ── */}
      <section className="intro-cta intro-reveal-scale">
        {/* Distinct dark navy → void gradient background */}
        <div className="intro-cta__gradient-bg" aria-hidden="true" />
        <div className="container intro-cta__content">
          <h2>Ready to Watch Smarter?</h2>
          <p>Join Movientum now and get full features access.</p>
          <div className="intro-cta__buttons">
            <Link to="/register" className="btn btn--primary btn--lg glow-pulse">Create Free Account</Link>
            <Link to="/home" className="btn btn--ghost btn--lg">Browse Without Account &rarr;</Link>
          </div>
        </div>
      </section>

      {/* ── 9. Creator Section ── */}
      <section className="intro-creator intro-reveal-left">
        <div className="container intro-creator__content">
          <h2>Meet the Creator</h2>
          <div className="intro-creator__card intro-creator__card--redesigned">
            <div className="intro-creator__image intro-creator__image--curved">
              <img src={profileImg} alt="Mithil Patidar" />
            </div>
            <div className="intro-creator__details">
              <h3>Mithil Patidar</h3>
              <p className="intro-creator__role">Full-Stack Engineer & AI Enthusiast</p>
              <div className="intro-creator__badges">
                <a href="https://github.com/patidarmithil" target="_blank" rel="noopener noreferrer" className="creator-badge">
                  <span>🐙</span> GitHub
                </a>
                <a href="https://patidarmithil-portfolio.netlify.app/" target="_blank" rel="noopener noreferrer" className="creator-badge">
                  <span>💼</span> Portfolio
                </a>
                <a href="https://drive.google.com/file/d/1rKfbHPCh1TuNtQRXP3ipYApoF37PV0SE/view" target="_blank" rel="noopener noreferrer" className="creator-badge">
                  <span>📄</span> Resume
                </a>
                <a href="https://www.linkedin.com/in/mithil-patidar-361010324/" target="_blank" rel="noopener noreferrer" className="creator-badge">
                  <span>🔗</span> LinkedIn
                </a>
                <button type="button" onClick={() => setShowContactModal(true)} className="creator-badge" style={{ background: 'rgba(255, 255, 255, 0.05)', cursor: 'pointer', border: '1px solid rgba(255, 255, 255, 0.1)', fontFamily: 'inherit' }}>
                  <span>📧</span> Contact
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="intro-footer">
        <div className="container">
          <div className="intro-footer__links">
            <span>&copy; {new Date().getFullYear()} Movientum</span>
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms-of-service">Terms of Service</Link>
          </div>
          <div className="intro-footer__note">BETA · Built with ❤️ · Always improving</div>
        </div>
      </footer>

      {showContactModal && (
        <div className="intro-contact-modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="intro-contact-modal" onClick={(e) => e.stopPropagation()}>
            <button className="intro-contact-modal__close" onClick={() => setShowContactModal(false)}>&times;</button>
            <h3>Get in Touch</h3>
            <p className="intro-contact-modal__subtitle">
              Feel free to reach out directly at{' '}
              <a href="mailto:mithilpatidar80@gmail.com">mithilpatidar80@gmail.com</a> or use the form below.
            </p>
            <form onSubmit={(e) => {
              e.preventDefault()
              const name = e.target.name.value
              const email = e.target.email.value
              const msg = e.target.message.value
              window.location.href = `mailto:mithilpatidar80@gmail.com?subject=Contact from Movientum by ${name}&body=${encodeURIComponent(msg)}%0D%0A%0D%0AReply to: ${email}`
            }}>
              <div className="form-group" style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                <label htmlFor="contact-name" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Name</label>
                <input id="contact-name" name="name" type="text" placeholder="Your Name" required style={{ width: '100%', padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.95rem' }} />
              </div>
              <div className="form-group" style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                <label htmlFor="contact-email" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Email</label>
                <input id="contact-email" name="email" type="email" placeholder="yourname@example.com" required style={{ width: '100%', padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.95rem' }} />
              </div>
              <div className="form-group" style={{ marginBottom: '1.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                <label htmlFor="contact-message" style={{ fontSize: '0.9rem', fontWeight: '600', color: 'rgba(255,255,255,0.7)' }}>Message</label>
                <textarea id="contact-message" name="message" rows="4" placeholder="Your Message..." required style={{ width: '100%', padding: '0.8rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: '#fff', fontSize: '0.95rem', resize: 'vertical' }}></textarea>
              </div>
              <button type="submit" className="btn btn--primary" style={{ width: '100%', padding: '1rem', fontWeight: '600' }}>Send Message</button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
