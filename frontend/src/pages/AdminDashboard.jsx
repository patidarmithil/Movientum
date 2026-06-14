import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import './AdminDashboard.css';

export default function AdminDashboard() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    const fetchFeedbacks = async () => {
      try {
        const res = await api.get('/api/v1/feedback/');
        setFeedbacks(res.data);
      } catch (err) {
        console.error('Failed to fetch feedback:', err);
        setError('Could not load feedback. Make sure you are an admin.');
      } finally {
        setLoading(false);
      }
    };
    fetchFeedbacks();
  }, []);

  const getCategoryBadgeClass = (category) => {
    if (category === 'Bug/Error') return 'badge-error';
    if (category === 'Improvement Idea') return 'badge-improvement';
    return 'badge-other';
  };

  return (
    <div className="admin-dashboard-page fade-in">
      <div className="admin-container">
        <h1>Admin Dashboard</h1>
        <p className="admin-subtitle">Manage user feedback and system insights.</p>

        {error && <div className="admin-error">{error}</div>}

        {loading ? (
          <div className="loading-spinner"></div>
        ) : (
          <div className="table-responsive">
            <table className="feedback-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>User ID</th>
                  <th>Category</th>
                  <th>Description</th>
                  <th>Screenshot</th>
                </tr>
              </thead>
              <tbody>
                {feedbacks.length === 0 && (
                  <tr>
                    <td colSpan="5" className="empty-state">No feedback found.</td>
                  </tr>
                )}
                {feedbacks.map((fb) => (
                  <tr key={fb.id}>
                    <td className="nowrap">
                      {new Date(fb.created_at).toLocaleDateString()}
                    </td>
                    <td>{fb.user_id ? fb.user_id.split('-')[0] : 'Anonymous'}</td>
                    <td>
                      <span className={`badge ${getCategoryBadgeClass(fb.category)}`}>
                        {fb.category}
                      </span>
                    </td>
                    <td className="content-cell">{fb.content}</td>
                    <td>
                      {fb.image_url ? (
                        <button 
                          className="view-btn" 
                          onClick={() => setSelectedImage(`${api.defaults.baseURL}${fb.image_url}`)}
                        >
                          View Image
                        </button>
                      ) : (
                        <span className="no-image">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedImage && (
        <div className="image-modal-overlay" onClick={() => setSelectedImage(null)}>
          <div className="image-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-btn" onClick={() => setSelectedImage(null)}>×</button>
            <img src={selectedImage} alt="Feedback Screenshot" className="modal-img" />
          </div>
        </div>
      )}
    </div>
  );
}
