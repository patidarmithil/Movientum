import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LuInbox, LuPlus } from 'react-icons/lu';
import api from '../../utils/api';

// Uploads are stored as API-relative paths; absolute URLs pass through.
const resolveImage = (path) =>
  path.startsWith('http') ? path : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${path}`;

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

  const header = (
    <div className="settings-header settings-header--row">
      <div>
        <h1>My Submitted Feedback</h1>
        <p>History of feedback and issues you have reported.</p>
      </div>
      {!loading && !error && feedbacks.length > 0 && (
        <Link to="/settings/feedback" className="settings-btn">
          <LuPlus aria-hidden /> New Feedback
        </Link>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="settings-card">
        {header}
        <div className="settings-loading" aria-busy="true">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-card">
        {header}
        <div className="error-text" role="alert">{error}</div>
      </div>
    );
  }

  return (
    <div className="settings-card">
      {header}

      {feedbacks.length === 0 ? (
        <div className="settings-empty">
          <LuInbox aria-hidden />
          <p>You haven't submitted any feedback yet.</p>
          <Link to="/settings/feedback" className="settings-btn">Submit Feedback</Link>
        </div>
      ) : (
        <div className="settings-issues">
          {feedbacks.map((item) => (
            <article key={item.id} className="settings-issue">
              <div className="settings-issue__top">
                <span className="settings-issue__tag">{item.category}</span>
                <time className="settings-issue__date" dateTime={item.created_at}>
                  {new Date(item.created_at).toLocaleDateString()}
                </time>
              </div>
              <p className="settings-issue__body">{item.content}</p>
              {item.image_url && (
                <img
                  className="settings-issue__img"
                  src={resolveImage(item.image_url)}
                  alt="Feedback screenshot"
                  loading="lazy"
                />
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
