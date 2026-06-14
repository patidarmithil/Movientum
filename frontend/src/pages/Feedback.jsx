import React, { useState, useEffect, useRef } from 'react';
import api from '../utils/api';
import './Feedback.css';

export default function Feedback() {
  const [category, setCategory] = useState('Improvement Idea');
  const [content, setContent] = useState('');
  const [image, setImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  // Custom dropdown states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on click outside
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
    <div className="feedback-page fade-in">
      <div className="feedback-container">
        <h1>Share Your Feedback</h1>
        <p className="feedback-subtitle">
          Help us improve Movientum. We'd love to hear your thoughts, ideas, or any issues you've encountered.
        </p>

        {message && <div className="feedback-success">{message}</div>}
        {error && <div className="feedback-error">{error}</div>}

        <form onSubmit={handleSubmit} className="feedback-form">
          <div className="form-group" ref={dropdownRef}>
            <label htmlFor="category">Category</label>
            <div className="custom-select-wrapper">
              <button
                type="button"
                className={`custom-select-trigger ${isDropdownOpen ? 'open' : ''}`}
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                <span>{category}</span>
                <svg className={`custom-select-arrow ${isDropdownOpen ? 'open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              {isDropdownOpen && (
                <div className="custom-select-menu">
                  {['Improvement Idea', 'Bug/Error', 'Content Missing', 'Other'].map((option) => (
                    <div
                      key={option}
                      className={`custom-select-option ${category === option ? 'active' : ''}`}
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

          <div className="form-group">
            <label htmlFor="content">Description</label>
            <textarea
              id="content"
              rows="5"
              placeholder="Please describe your feedback in detail..."
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="screenshot">Upload Screenshot (Optional)</label>
            <input
              type="file"
              id="screenshot"
              accept="image/*"
              onChange={handleImageChange}
            />
            {image && <div className="file-selected">Selected: {image.name}</div>}
          </div>

          <button type="submit" disabled={loading} className="feedback-submit-btn">
            {loading ? 'Submitting...' : 'Submit Feedback'}
          </button>
        </form>
      </div>
    </div>
  );
}
