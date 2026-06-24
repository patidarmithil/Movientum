import React from 'react'
import './Help.css'



function TutorialStep({ number, title, description }) {
  return (
    <div className="tutorial-step">
      <div className="tutorial-step__num">{number}</div>
      <div>
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
    </div>
  )
}

export default function Help() {
  return (
    <div className="help-page">
      <header className="help-header">
        <h1>Movientum — Your Movie & TV Universe</h1>
        <p>A complete guide to everything you can do here.</p>
      </header>

      <section className="help-section">
        <h2>🏠 What is Movientum?</h2>
        <img src="/help_images/Platform_overview_image.png" alt="Platform overview" className="help-screenshot" />
        <p>Discover, rate, track, and get personalized recommendations for all your favorite movies, TV shows, and anime in one place.</p>
      </section>

      <section className="help-section">
        <h2>🔍 Searching (Predictive Search)</h2>
        <img src="/help_images/Search_overlay_screenshot.png" alt="Search overlay" className="help-screenshot" />
        <p>Start typing anywhere on the site or use the search icon. Our predictive, typo-tolerant search brings instant results without leaving your current page.</p>
      </section>

      <section className="help-section">
        <h2>🎬 Movie & TV Detail Pages</h2>
        <img src="/help_images/Movie_detail_screenshot.png" alt="Movie detail" className="help-screenshot" />
        <p>Get full information including trailers, cast, crew, similar titles, production company links, and our unique Moctale rating meter.</p>
      </section>

      <section className="help-section">
        <h2>⭐ Moctale Rating System</h2>
        <img src="/help_images/Rating_categories_screenshot.png" alt="Rating categories" className="help-screenshot" />
        <p>Real audience sentiment is divided into four easy buckets: <strong>Skip</strong>, <strong>Timepass</strong>, <strong>Go For It</strong>, and <strong>Perfection</strong>.</p>
      </section>

      <section className="help-section">
        <h2>🔎 Explore & Filters</h2>
        <img src="/help_images/Explore_page_screenshot.png" alt="Explore page" className="help-screenshot" />
        <p>Use our advanced filters to browse by genre, type (Movies/TV/Anime), year range, minimum rating, and custom sort orders.</p>
      </section>

      <section className="help-section">
        <h2>📰 Movie News</h2>
        <img src="/help_images/News_page_screenshot.png" alt="News page" className="help-screenshot" />
        <p>Stay updated with the latest Hollywood and Bollywood news, pulled fresh every 2 hours and personalized based on your watch history.</p>
      </section>

      <section className="help-login-banner">
        <h3>👤 LOGIN TO UNLOCK</h3>
        <div className="help-login-grid">
          <span>✓ Watch History</span>
          <span>✓ Watchlist</span>
          <span>✓ Your Ratings</span>
          <span>✓ Personalized Recs</span>
          <span>✓ Episode Notifs</span>
          <span>✓ Watching</span>
          <span>✓ Your Analytics</span>
          <span>✓ Personalized News</span>
        </div>
        <a href="/signup" className="help-btn">Create Free Account →</a>
      </section>

      <section className="help-section">
        <h2>📖 Tutorial: How to Rate a Movie</h2>
        <div className="tutorial-list">
          <TutorialStep number="1" title="Open any page" description="Open any movie or TV show detail page." />
          <TutorialStep number="2" title="Find the rating section" description="Scroll to the Rating section below the overview." />
          <TutorialStep number="3" title="Select a category" description="Choose one of four categories: Skip, Timepass, Go For It, or Perfection." />
          <TutorialStep number="4" title="Saved instantly" description="Your rating is saved instantly. You can change it anytime." />
        </div>
      </section>

      <section className="help-section">
        <h2>📖 Tutorial: How to Use Watching</h2>
        <div className="tutorial-list">
          <TutorialStep number="1" title="Open a TV series" description="Open any TV series detail page." />
          <TutorialStep number="2" title="Mark as Watching" description="Click the 'Watching' button on the TV series page." />
          <TutorialStep number="3" title="Wait for new episodes" description="When a new episode airs, you'll see a bell notification icon in the navbar." />
          <TutorialStep number="4" title="Check notifications" description="Click the bell to see which tracked shows dropped a new episode today." />
        </div>
      </section>

      <section className="help-section">
        <h2>📱 Tutorial: How to Install Movientum as an App</h2>
        
        <div style={{ marginTop: '20px' }}>
          <h3 style={{ color: '#fff', fontSize: '1.2rem', marginBottom: '12px' }}>For iPhone (iOS Safari)</h3>
          <div className="tutorial-list">
            <TutorialStep number="1" title="Open in Safari" description="Go to the website in the Safari app on your iPhone." />
            <TutorialStep number="2" title="Tap Share" description="Tap the Share button at the bottom of the screen." />
            <TutorialStep number="3" title="Add to Home Screen" description="Scroll down the options and tap 'Add to Home Screen'." />
            <TutorialStep number="4" title="Confirm App" description="Turn on 'Open as Web App' and tap 'Add' to confirm." />
          </div>
        </div>

        <div style={{ marginTop: '32px' }}>
          <h3 style={{ color: '#fff', fontSize: '1.2rem', marginBottom: '12px' }}>For Android (Google Chrome)</h3>
          <div className="tutorial-list">
            <TutorialStep number="1" title="Open in Chrome" description="Open the website in Chrome on your Android phone." />
            <TutorialStep number="2" title="Tap More Menu" description="Tap the three vertical dots (More button) in the top-right corner." />
            <TutorialStep number="3" title="Add to Home Screen" description="Tap 'Add to Home screen' from the menu." />
            <TutorialStep number="4" title="Confirm App" description="Enter a name if desired and tap 'Add' to place the app shortcut." />
          </div>
        </div>
      </section>

      <section className="help-section help-faq">
        <h2>❓ FAQ</h2>
        <details>
          <summary>Is Movientum free?</summary>
          <p>Yes, completely free.</p>
        </details>
        <details>
          <summary>How are Moctale ratings different from TMDB ratings?</summary>
          <p>Moctale ratings come from our community rating system (Skip/Timepass/Go For It/Perfection). TMDB is shown as a fallback when no community rating exists yet.</p>
        </details>
        <details>
          <summary>How do personalized recommendations work?</summary>
          <p>They are based on your watch history, the genres you rate highly, and your click patterns.</p>
        </details>
        <details>
          <summary>Is my data stored safely?</summary>
          <p>Yes. Passwords are securely hashed with bcrypt, and auth tokens are stored safely in your browser session/local storage.</p>
        </details>
        <details>
          <summary>How do I request missing content?</summary>
          <p>Use the search overlay — if no results are found, a "Request Content" button will appear.</p>
        </details>
      </section>
    </div>
  )
}
