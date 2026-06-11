import React, { useState } from 'react';
import { searchService } from '../services/searchService';
import './RequestContentModal.css';

export default function RequestContentModal({ query, onClose }) {
  const [selectedType, setSelectedType] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async () => {
    if (!selectedType) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await searchService.requestContent(query, selectedType);
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="request-modal-overlay">
      <div className="request-modal">
        <h2>Submit a request</h2>
        <p className="request-modal-subtitle">
          Content Missing - "{query}"
        </p>

        {success ? (
          <div className="request-modal-success">
            <p>Request submitted successfully!</p>
          </div>
        ) : (
          <>
            <div className="request-modal-options">
              <button 
                className={`request-option ${selectedType === 'Movie' ? 'selected' : ''}`}
                onClick={() => setSelectedType('Movie')}
              >
                Movie
              </button>
              <button 
                className={`request-option ${selectedType === 'TV Show' ? 'selected' : ''}`}
                onClick={() => setSelectedType('TV Show')}
              >
                TV Show
              </button>
            </div>

            {error && <p className="request-modal-error">{error}</p>}

            <div className="request-modal-actions">
              <button 
                className="submit-request-btn" 
                onClick={handleSubmit} 
                disabled={!selectedType || isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit request'}
              </button>
              <button className="cancel-request-btn" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
