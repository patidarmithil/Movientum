import { useState, useEffect, useRef } from 'react';
import { LuChevronDown } from 'react-icons/lu';
import api from '../../utils/api';

const CATEGORIES = ['Improvement Idea', 'Bug/Error', 'Content Missing', 'Other'];

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

      {message && <div className="success-text" role="status">{message}</div>}
      {error && <div className="error-text" role="alert">{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="settings-form-group" ref={dropdownRef}>
          <label id="category-label">Category</label>
          <div className="settings-select">
            <button
              type="button"
              className="settings-input settings-select__btn"
              aria-haspopup="listbox"
              aria-expanded={isDropdownOpen}
              aria-labelledby="category-label"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span>{category}</span>
              <LuChevronDown aria-hidden />
            </button>
            {isDropdownOpen && (
              <ul className="settings-select__menu" role="listbox" aria-labelledby="category-label">
                {CATEGORIES.map((option) => (
                  <li key={option} role="option" aria-selected={category === option}>
                    <button
                      type="button"
                      className={`settings-select__opt${category === option ? ' is-selected' : ''}`}
                      onClick={() => {
                        setCategory(option);
                        setIsDropdownOpen(false);
                      }}
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
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
          />
        </div>

        <button type="submit" disabled={loading} className="settings-btn">
          {loading ? 'Submitting...' : 'Submit Feedback'}
        </button>
      </form>
    </div>
  );
}
