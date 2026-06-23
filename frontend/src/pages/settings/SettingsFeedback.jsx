import React, { useState, useEffect, useRef } from 'react';
import api from '../../utils/api';

export default function SettingsFeedback() {
  const [category, setCategory] = useState('Improvement Idea');
  const [content, setContent] = useState('');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleImageChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setImage(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!content.trim()) {
      setError('Please describe your feedback.');
      return;
    }
    
    setLoading(true);
    setError('');
    setMessage('');

    const formData = new FormData();
    formData.append('category', category);
    formData.append('content', content);
    if (image) {
      formData.append('image', image);
    }

    try {
      await api.post('/api/v1/feedback/', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      setMessage('Thank you for your feedback!');
      setContent('');
      setImage(null);
      setCategory('Improvement Idea');
    } catch (err) {
      console.error('Feedback error:', err);
      setError('Failed to submit feedback. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="settings-card">
      <div className="settings-header">
        <h1>Submit Feedback</h1>
        <p>Help us improve Movientum. We'd love to hear your thoughts, ideas, or any issues you've encountered.</p>
      </div>

      {message && <div className="success-text" style={{ marginBottom: '1rem' }}>{message}</div>}
      {error && <div className="error-text" style={{ marginBottom: '1rem' }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="settings-form-group" ref={dropdownRef}>
          <label htmlFor="category">Category</label>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="settings-input"
              style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span>{category}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>
            {isDropdownOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0,
                background: 'var(--surface-input)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', marginTop: '4px', zIndex: 10
              }}>
                {['Improvement Idea', 'Bug/Error', 'Content Missing', 'Other'].map((option) => (
                  <div
                    key={option}
                    style={{
                      padding: '10px 14px', cursor: 'pointer',
                      background: category === option ? 'var(--accent-hover)' : 'transparent'
                    }}
                    onClick={() => {
                      setCategory(option);
                      setIsDropdownOpen(false);
                    }}
                  >
                    {option}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="settings-form-group">
          <label htmlFor="content">Description</label>
          <textarea
            id="content"
            className="settings-input"
            rows="5"
            placeholder="Please describe your feedback in detail..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="settings-form-group">
          <label htmlFor="screenshot">Upload Screenshot (Optional)</label>
          <input
            type="file"
            id="screenshot"
            className="settings-input"
            accept="image/*"
            onChange={handleImageChange}
            style={{ padding: '7px 14px' }}
          />
        </div>

        <button type="submit" disabled={loading} className="settings-btn">
          {loading ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </div>
  );
}
