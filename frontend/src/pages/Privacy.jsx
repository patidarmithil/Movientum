import React from 'react'
import './Help.css'

export default function Privacy() {
  React.useEffect(() => {
    document.title = "Privacy Policy - Movientum";
  }, []);

  return (
    <div className="help-page" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header className="help-header" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <h1>Privacy Policy</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>
      </header>

      <section className="help-section" style={{ border: 'none', background: 'transparent', padding: '0' }}>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          At Movientum, we take your privacy seriously. This Privacy Policy explains how we collect, use, and protect your personal information when you use our website and services.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>1. Information We Collect</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          <strong>Account Information:</strong> When you create an account, we collect your username, email address, and password (which is securely hashed).<br /><br />
          <strong>Usage Data:</strong> We collect information about how you interact with the platform, such as movies you rate, add to your watchlist, or search for. This helps power our AI recommendations.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>2. How We Use Your Information</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          - To provide, operate, and maintain our platform.<br />
          - To personalize your experience and deliver AI-powered movie and TV show recommendations.<br />
          - To understand and analyze how you use Movientum so we can improve our services.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>3. Data Security</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          We implement a variety of security measures to maintain the safety of your personal information. Your password is encrypted, and your session data is stored securely. However, no method of transmission over the Internet is 100% secure.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>4. Third-Party Services</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          We use external APIs (like TMDB) to fetch movie metadata and posters. We do not share your personally identifiable information with these third parties.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>5. Contact Us</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          If you have any questions about this Privacy Policy, please contact us through the feedback section in your dashboard.
        </p>
      </section>
    </div>
  )
}
