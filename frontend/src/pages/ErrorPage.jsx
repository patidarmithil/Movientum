import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './ErrorPage.css';

const ErrorPage = ({ type = '404', message: customMessage, onRetry }) => {
  const navigate = useNavigate();

  const isNotFound = type === '404';

  const title = isNotFound ? "404 — Page Not Found" : "500 — Something went wrong";
  const message = customMessage || (isNotFound 
    ? "The page you are looking for doesn't exist or has been moved." 
    : "We experienced an unexpected error while loading this page. Please try again or return home.");

  const handleRetry = () => {
    if (onRetry) {
      onRetry();
    } else {
      // Fallback reload
      window.location.reload();
    }
  };

  return (
    <div className="error-page-container">
      <div className="error-page-content">
        <div className="error-icon-wrapper">
          {isNotFound ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="error-icon not-found">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="error-icon server-error">
              <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          )}
        </div>
        
        <h1 className="error-title">{title}</h1>
        <p className="error-message">{message}</p>
        
        <div className="error-actions">
          {isNotFound ? (
            <button onClick={() => navigate(-1)} className="btn-secondary">
              Go Back
            </button>
          ) : (
            <button onClick={handleRetry} className="btn-primary">
              Try Again
            </button>
          )}
          <Link to="/" className="btn-primary-outline">
            Go to Homepage
          </Link>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;
