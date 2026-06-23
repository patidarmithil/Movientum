import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';

export default function SettingsMyIssues() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchMyIssues = async () => {
      try {
        const response = await api.get('/api/v1/feedback/mine');
        setFeedbacks(response.data);
      } catch (err) {
        console.error('Failed to fetch my issues:', err);
        setError('Failed to load your feedback history.');
      } finally {
        setLoading(false);
      }
    };
    fetchMyIssues();
  }, []);

  if (loading) {
    return (
      <div className="settings-card">
        <div className="settings-header">
          <h1>My Submitted Feedback</h1>
        </div>
        <div>Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-card">
        <div className="settings-header">
          <h1>My Submitted Feedback</h1>
        </div>
        <div className="error-text">{error}</div>
      </div>
    );
  }

  return (
    <div className="settings-card">
      <div className="settings-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1>My Submitted Feedback</h1>
          <p>History of feedback and issues you have reported.</p>
        </div>
        <Link to="/settings/feedback" className="settings-btn" style={{ textDecoration: 'none' }}>
          New Feedback
        </Link>
      </div>

      {feedbacks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--surface-input)', borderRadius: 'var(--radius-md)' }}>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>You haven't submitted any feedback yet.</p>
          <Link to="/settings/feedback" className="settings-btn" style={{ textDecoration: 'none', display: 'inline-block' }}>
            Submit Feedback
          </Link>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {feedbacks.map((item) => (
            <div key={item.id} style={{ 
              background: 'var(--surface-input)', 
              padding: '1.5rem', 
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ 
                  background: 'var(--accent)', 
                  color: 'white', 
                  padding: '2px 8px', 
                  borderRadius: '12px', 
                  fontSize: '0.75rem', 
                  fontWeight: '600' 
                }}>
                  {item.category}
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  {new Date(item.created_at).toLocaleDateString()}
                </span>
              </div>
              <p style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>
                {item.content}
              </p>
              {item.image_url && (
                <div style={{ marginTop: '1rem' }}>
                  <img 
                    src={`http://localhost:8000${item.image_url}`} 
                    alt="Feedback screenshot" 
                    style={{ maxHeight: '150px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} 
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
