import React from 'react'
import './Help.css'

export default function TermsOfService() {
  React.useEffect(() => {
    document.title = "Terms of Service - Movientum";
  }, []);

  return (
    <div className="help-page" style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem' }}>
      <header className="help-header" style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <h1>Terms of Service</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>
      </header>

      <section className="help-section" style={{ border: 'none', background: 'transparent', padding: '0' }}>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          Welcome to Movientum. By accessing or using our website and services, you agree to be bound by these Terms of Service. If you disagree with any part of the terms, you may not access the service.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>1. Use of Service</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          You must be at least 13 years old to use this service. You are responsible for safeguarding the password that you use to access the service and for any activities or actions under your password.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>2. User Content</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          Our service allows you to post ratings, reviews, and create watchlists. You retain all of your ownership rights in your content, but you grant us a license to use, store, and display that content on Movientum to provide the service.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>3. Acceptable Use</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          You agree not to engage in any activity that interferes with or disrupts the services. Spamming, abusive language in reviews, and automated scraping of our data without permission are strictly prohibited and may result in account termination.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>4. Termination</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          We may terminate or suspend access to our service immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms.
        </p>

        <h2 style={{ color: '#fff', marginTop: '2rem', marginBottom: '1rem' }}>5. Changes to Terms</h2>
        <p style={{ marginBottom: '1rem', color: '#ccc', lineHeight: '1.6' }}>
          We reserve the right, at our sole discretion, to modify or replace these Terms at any time. We will try to provide at least 30 days notice prior to any new terms taking effect.
        </p>
      </section>
    </div>
  )
}
