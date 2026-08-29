import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import profileImg from '../assets/profile.jpeg'
import meterImg from '../assets/meter.png'
import watchlistImg from '../assets/watchlist.png'
import {
  HERO_LAYERS,
  RAIL_SECTIONS,
  FEATURE_CARDS,
  RATING_PILLS,
  POSTER_WALL,
} from '../data/introSections'
import { prefersReducedMotion } from '../hooks/useRatioObserver'
import { contactService } from '../services/contactService'
import './Intro.css'

const THRESHOLDS = Array.from({ length: 101 }, (_, i) => i / 100)

export default function Intro() {
  const { isLoggedIn } = useAuth()
  const [showContactModal, setShowContactModal] = useState(false)
  const [contactStatus, setContactStatus] = useState('idle') // idle | sending | sent | error
  const [activeSection, setActiveSection] = useState('intro-start')

  const heroPlaceholderRef = useRef(null)
  const farRef = useRef(null)
  const heroTextRef = useRef(null)

  useEffect(() => {
    document.title = 'About - Movientum'
  }, [])

  // Non-logged-in visitor on the zero-backend landing page — fire a stray
  // ping to wake whichever backend (primary/secondary) is cold, picked at
  // random so both stay warm. Result ignored either way.
  useEffect(() => {
    if (isLoggedIn) return
    const urls = [
      import.meta.env.VITE_API_URL || 'https://movientum.azurewebsites.net',
      import.meta.env.VITE_API_URL_SECONDARY || 'https://movientum-backend-secondary.onrender.com',
    ]
    const target = urls[Math.floor(Math.random() * urls.length)]
    fetch(`${target}/api/health`).catch(() => {})
  }, [isLoggedIn])

  // Drive the jump from JS rather than relying on the href alone. The rail used
  // to need two clicks: it auto-hid on a timer, and `visibility: hidden` makes an
  // element unhittable, so the first click landed on whatever was underneath and
  // only served to bring the rail back. The rail is now permanently visible, and
  // scrollIntoView removes the remaining dependence on hash handling.
  const goToSection = (event, id) => {
    event.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    setActiveSection(id)
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  // Hero parallax + fade.
  //
  // This used to read `intersectionRatio` off an IntersectionObserver and write
  // the transform straight from it. An observer only fires when a threshold is
  // crossed, so the image moved in discrete jumps — visible as a stutter on any
  // scroll faster than a crawl. Here the target is measured from the element's
  // own geometry and the rendered value eases toward it once per animation
  // frame, which turns the same scroll into continuous motion and also smooths
  // over the coarse, chunky deltas that a mouse wheel produces.
  //
  // A second observer starts and stops the loop so nothing runs once the hero is
  // off screen.
  useEffect(() => {
    const reduced = prefersReducedMotion()
    const placeholder = heroPlaceholderRef.current
    if (!placeholder) return

    let frame = 0
    let rendered = 0   // eased value actually written to the DOM
    let target = 0     // 0 = hero fully in view, 1 = fully scrolled past

    const render = () => {
      const rect = placeholder.getBoundingClientRect()
      const height = rect.height || 1
      target = Math.max(0, Math.min(1, -rect.top / height))

      // Exponential ease: covers ~90% of the remaining distance in a quarter of
      // a second, so it never lags behind the scroll enough to feel detached.
      rendered += (target - rendered) * 0.09
      if (Math.abs(target - rendered) < 0.0005) rendered = target

      if (heroTextRef.current) heroTextRef.current.style.opacity = String(1 - rendered)
      if (!reduced && farRef.current) {
        // translate3d keeps the layer on its own compositor layer; the drift and
        // zoom keyframes use the `translate`/`scale` properties, so all three
        // compose instead of overwriting each other.
        farRef.current.style.transform = `translate3d(0, ${(rendered * -110).toFixed(2)}px, 0)`
      }
      frame = requestAnimationFrame(render)
    }

    const gate = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !frame) {
        frame = requestAnimationFrame(render)
      } else if (!entry.isIntersecting && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }, { threshold: 0 })
    gate.observe(placeholder)

    return () => {
      gate.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])

  // Section rail: tracks which section is dominant on screen.
  useEffect(() => {
    const sectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.intersectionRatio > 0.6) {
          setActiveSection(entry.target.id)
        }
      })
    }, { threshold: THRESHOLDS })

    RAIL_SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) sectionObserver.observe(el)
    })

    return () => sectionObserver.disconnect()
  }, [])

  // Scroll-reveal for feature cards, ratings, watchlists, split panels, library, creator.
  // threshold 0 + a slightly inset root: `isIntersecting` then flips reliably at the
  // real boundary in both directions, including for elements taller than the viewport
  // (a single mid-range threshold can leave those stuck hidden).
  useEffect(() => {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-visible', entry.isIntersecting)
      })
    }, { threshold: 0, rootMargin: '-6% 0px -6% 0px' })

    const els = document.querySelectorAll(
      '.intro-reveal, .intro-reveal-left, .intro-reveal-right, .intro-reveal-scale, .intro-card-eyebrow-dash'
    )
    els.forEach((el) => revealObserver.observe(el))

    return () => revealObserver.disconnect()
  }, [])

  const railIndex = Math.max(0, RAIL_SECTIONS.findIndex((s) => s.id === activeSection))

  return (
    <div className="intro-page">

      {/* ── Right-side vertical pagination (film-perforation rail) ── */}
      <nav className="intro-rail" aria-label="Page sections">
        <ul>
          {RAIL_SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => goToSection(e, s.id)}
                className={s.id === activeSection ? 'is-active' : ''}
                aria-current={s.id === activeSection ? 'true' : undefined}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="intro-rail__track">
          <div
            className="intro-rail__indicator"
            style={{ transform: `translateY(${railIndex * 100}%)`, height: `${100 / RAIL_SECTIONS.length}%` }}
          />
        </div>
      </nav>

      {/* ── 0. Hero ── */}
      <section id="intro-start" className="intro-hero">
        <div ref={heroPlaceholderRef} className="intro-hero__placeholder" aria-hidden="true" />

        <div ref={farRef} className="intro-hero__layer intro-hero__layer--far" style={{ backgroundImage: HERO_LAYERS.far.image }} aria-hidden="true" />
        <div className="intro-hero__layer-scrim intro-hero__layer-scrim--top" aria-hidden="true" />
        <div className="intro-hero__grain" aria-hidden="true" />

        <div ref={heroTextRef} className="container intro-hero__content">
          <h1 className="intro-hero__title">
            Your movies.<br />Your way.
          </h1>
          {/* Signed-out visitors are being sold the product; signed-in ones just
              want back into it, so the pair of actions swaps entirely. */}
          <div className="intro-hero__ctas">
            {isLoggedIn ? (
              <>
                <Link to="/home" className="intro-cta intro-cta--solid">Continue &rarr;</Link>
                <Link to="/explore" className="intro-cta">Explore</Link>
              </>
            ) : (
              <>
                <Link to="/signup" className="intro-cta intro-cta--solid">Get Started &rarr;</Link>
                <Link to="/home" className="intro-cta">Guest mode</Link>
              </>
            )}
          </div>
          <div className="intro-hero__scroll-down">
            <span>scroll down</span>
            <span className="intro-hero__scroll-arrow" aria-hidden="true">&darr;</span>
          </div>
        </div>

        <div className="intro-hero__bottom-fade" aria-hidden="true" />
      </section>

      {/* ── Lede — the platform description the hero used to carry ── */}
      <section className="intro-lede container intro-reveal">
        <p>
          Movientum is the dark-mode home for movie &amp; series lovers —
          <strong> discover, rate, review, and build your watchlists</strong>,
          powered by AI-backed recommendations that learn from what you actually watch.
        </p>
      </section>

      {/* ── 1–3. Feature cards, alternating ── */}
      <section className="intro-feature-cards container">
        {FEATURE_CARDS.map((card) => (
          <div
            key={card.id}
            id={card.id}
            className={`intro-card ${card.side === 'right' ? 'intro-card--reverse' : ''}`}
          >
            <div
              className={`intro-card__visual intro-reveal-${card.side === 'right' ? 'right' : 'left'}`}
              style={{ '--card-glow': `url(${card.image})` }}
            >
              <div className="intro-card__glow" aria-hidden="true" />
              <div className="intro-gate">
                <div className="intro-gate__image" style={{ backgroundImage: `url(${card.image})` }} />
                <div className="intro-gate__scrim" />
                <div className="intro-gate__grain" aria-hidden="true" />
              </div>
            </div>

            <div className="intro-card__text intro-reveal">
              <div className="intro-eyebrow intro-card-eyebrow-dash">
                <span className="intro-eyebrow__dash" />
                <span className="intro-eyebrow__text">{card.eyebrow}</span>
              </div>
              <h2 className="intro-card__title">{card.title}</h2>
              <p className="intro-card__desc">{card.desc}</p>
            </div>
          </div>
        ))}
      </section>

      {/* ── 4. Rating System Showcase ── */}
      <section id="intro-scale" className="intro-ratings container intro-reveal-scale">
        <div className="intro-ratings__header">
          <div className="intro-eyebrow intro-eyebrow--center">
            <span className="intro-eyebrow__dash" />
            <span className="intro-eyebrow__text">YOUR SCALE</span>
          </div>
          <h2>Rate Like a Human, Not a Robot</h2>
          <p>Forget 5-star systems. We built 4 real ratings that actually make sense.</p>
        </div>
        <div className="intro-ratings__content">
          <div className="intro-ratings__pills">
            {RATING_PILLS.map((pill, i) => (
              <div key={pill.key} className="intro-rating-pill" style={{ '--pill-color': pill.color, transitionDelay: `${i * 120}ms` }}>
                <span className="dot" />
                <span className="intro-rating-pill__name">{pill.name}</span>
                <span className="desc">{pill.desc}</span>
              </div>
            ))}
          </div>
          <div className="intro-ratings__visual">
            <img src={meterImg} alt="Rating Meter" />
          </div>
        </div>
      </section>

      {/* ── 5. Watchlists ── */}
      <section id="intro-lists" className="intro-watchlists container intro-reveal-left">
        <div className="intro-watchlists__text">
          <div className="intro-eyebrow">
            <span className="intro-eyebrow__dash" />
            <span className="intro-eyebrow__text">ORGANIZE</span>
          </div>
          <h2>Create Watchlists With Lots of Content</h2>
          <p>Create unlimited watchlists and manage them with our proper filters system. Share your taste and follow others.</p>
        </div>
        <div className="intro-watchlists__visual">
          <div className="intro-watchlists__image intro-watchlists__image--curved">
            <img src={watchlistImg} alt="Watchlist Showcase" />
          </div>
          <span className="intro-watchlists__badge">+ Unlimited lists</span>
        </div>
      </section>

      {/* ── 6. News & Explore ── */}
      <section id="intro-explore" className="intro-news-explore container intro-reveal-right">
        <div className="intro-split-panel intro-split-panel--left">
          <span className="intro-split-panel__icon" aria-hidden="true">📰</span>
          <h2>Stay in the Loop</h2>
          <p>News from the movie world, updated daily — releases, casting, festival coverage, and what the industry is arguing about this week.</p>
          <Link to="/news" className="intro-cta intro-cta--sm">Browse News &rarr;</Link>
        </div>
        <div className="intro-split-panel intro-split-panel--right">
          <span className="intro-split-panel__icon" aria-hidden="true">🧭</span>
          <h2>Explore Everything</h2>
          <p>Filter by genre, country, year, or production company. Dig past the front page and find the films nobody put on a homepage.</p>
          <Link to="/explore" className="intro-cta intro-cta--sm">Start Exploring &rarr;</Link>
        </div>
      </section>

      {/* ── 7. Poster wall + Final CTA ── */}
      <section id="intro-library" className="intro-library intro-reveal-scale">
        <div className="container intro-library__header">
          <div className="intro-eyebrow intro-eyebrow--center">
            <span className="intro-eyebrow__dash" />
            <span className="intro-eyebrow__text">THE LIBRARY</span>
          </div>
          <h2>Lakhs of Movies &amp; TV Shows</h2>
          <p>Browse the entire TMDB library natively — genres, popularity, hidden gems, with our own filters.</p>
        </div>

        <div className="intro-marquee" aria-hidden="true">
          <div className="intro-marquee__row intro-marquee__row--left">
            {[...POSTER_WALL, ...POSTER_WALL].map((p, i) => (
              <div key={`row1-${i}`} className="intro-marquee__poster" style={{ backgroundImage: `url(${p.image})` }}>
                <span>{p.title}</span>
              </div>
            ))}
          </div>
          <div className="intro-marquee__row intro-marquee__row--right">
            {[...POSTER_WALL].reverse().concat([...POSTER_WALL].reverse()).map((p, i) => (
              <div key={`row2-${i}`} className="intro-marquee__poster" style={{ backgroundImage: `url(${p.image})` }}>
                <span>{p.title}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="container intro-library__cta">
          <h2>Ready to Watch Smarter?</h2>
          <p>Join Movientum now and get full features access.</p>
          <div className="intro-library__cta-buttons">
            <Link to="/signup" className="intro-cta intro-cta--solid">Create Free Account</Link>
            <Link to="/home" className="intro-cta">Browse Without Account &rarr;</Link>
          </div>
        </div>
      </section>

      {/* ── 8. Creator ── */}
      <section id="intro-creator" className="intro-creator intro-reveal-left">
        <div className="container intro-creator__content">
          <h2>Meet the Creator</h2>
          <div className="intro-creator__card intro-creator__card--redesigned">
            <div className="intro-creator__image intro-creator__image--curved">
              <img src={profileImg} alt="Mithil Patidar" />
            </div>
            <div className="intro-creator__details">
              <h3>Mithil Patidar</h3>
              <p className="intro-creator__role">Full-Stack Engineer &amp; AI Enthusiast</p>
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
                {/* No inline background/border here — the .creator-badge class owns
                    the glass treatment, and inline styles would win over its hover. */}
                <button type="button" onClick={() => setShowContactModal(true)} className="creator-badge">
                  <span>📧</span> Contact
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="intro-footer">
        <div className="intro-footer__info">
          <div className="intro-footer__logo">MOVIENTUM</div>
          <p>Discover, rate, review, and build your watchlists — the dark-mode home for movie &amp; series lovers.</p>
          <span className="intro-footer__copyright">&copy; {new Date().getFullYear()} Movientum, Inc. · BETA · Always improving</span>
        </div>

        <div className="intro-footer__navlinks">
          <div>
            <div className="intro-footer__navheader">More on Movientum</div>
            <ul>
              <li><Link to="/home">Home</Link></li>
              <li><Link to="/explore">Explore</Link></li>
              <li><Link to="/news">News</Link></li>
              <li><Link to="/recommendations">Recommendations</Link></li>
              <li><Link to="/help">Help</Link></li>
            </ul>
          </div>
          <div>
            <div className="intro-footer__navheader">More from the Creator</div>
            <ul>
              <li><a href="https://patidarmithil-portfolio.netlify.app/" target="_blank" rel="noopener noreferrer">Portfolio</a></li>
              <li><a href="https://github.com/patidarmithil" target="_blank" rel="noopener noreferrer">GitHub</a></li>
              <li><button type="button" onClick={() => setShowContactModal(true)}>Contact</button></li>
              <li><Link to="/privacy">Privacy Policy</Link></li>
              <li><Link to="/terms">Terms of Service</Link></li>
            </ul>
          </div>
        </div>
      </footer>

      {showContactModal && (
        <div className="intro-contact-modal-overlay" onClick={() => { setShowContactModal(false); setContactStatus('idle') }}>
          <div className="intro-contact-modal" onClick={(e) => e.stopPropagation()}>
            <button className="intro-contact-modal__close" onClick={() => { setShowContactModal(false); setContactStatus('idle') }}>&times;</button>
            <h3>Get in Touch</h3>
            <p className="intro-contact-modal__subtitle">
              Send a message and we'll reply to the email you give below, or reach out directly at{' '}
              <a href="mailto:mithilpatidar80@gmail.com">mithilpatidar80@gmail.com</a>.
            </p>
            {contactStatus === 'sent' ? (
              <p style={{ color: '#4ADE80', fontWeight: 600 }}>Message sent — thanks! We'll get back to you soon.</p>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault()
                const name = e.target.name.value
                const email = e.target.email.value
                const message = e.target.message.value
                setContactStatus('sending')
                try {
                  await contactService.submit({ name, email, message })
                  setContactStatus('sent')
                } catch {
                  setContactStatus('error')
                }
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
                {contactStatus === 'error' && (
                  <p style={{ color: '#F87171', marginBottom: '1rem' }}>Failed to send — please try again or email us directly.</p>
                )}
                <button type="submit" className="btn btn--primary" disabled={contactStatus === 'sending'} style={{ width: '100%', padding: '1rem', fontWeight: '600' }}>
                  {contactStatus === 'sending' ? 'Sending...' : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
