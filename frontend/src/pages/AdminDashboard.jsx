import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { adminService } from '../services/adminService';
import Aurora from '../components/Aurora';
import AdminAnalytics from '../components/AdminAnalytics';
import './AdminDashboard.css';
import './AdminPage.css'; // Import the new styles we created


export default function AdminDashboard() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedImage, setSelectedImage] = useState(null);

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  
  const [activeTab, setActiveTab] = useState('business'); // 'system', 'business', 'infrastructure', 'ml', 'feedback'

  const [subTabBusiness, setSubTabBusiness] = useState('db'); // 'db', 'kpis', 'behaviour'
  const [subTabInfra, setSubTabInfra] = useState('api'); // 'api', 'infra'
  const [subTabML, setSubTabML] = useState('recs'); // 'recs', 'graph', 'retrain'

  const [taskStatuses, setTaskStatuses] = useState({});
  const [activeInterval, setActiveInterval] = useState(null);

  const TASKS = [
    { 
      key: "nightly_job", name: "Overall Nightly Job", desc: "Runs the full suite of nightly updates.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
    },
    { 
      key: "sync_movies", name: "Sync Movies", desc: "Synchronize popular and upcoming movies from TMDB.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>
    },
    { 
      key: "retrain_ranker", name: "Retrain ML Ranker", desc: "Retrains the XGBRanker model using recent logs.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
    },
    { 
      key: "fetch_news", name: "Fetch Global News", desc: "Fetches global movie and TV news from API partners.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8l-4 4v14a2 2 0 0 0 2 2z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg>
    },
    { 
      key: "fetch_cat_news", name: "Fetch Category News", desc: "Fetches news specific to movie genres and TV.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
    },
    { 
      key: "check_episodes", name: "Check New Episodes", desc: "Checks for new episodes of tracked TV shows.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"></rect><polyline points="17 2 12 7 7 2"></polyline></svg>
    },
    { 
      key: "expire_articles", name: "Expire Old Articles", desc: "Archives news articles older than 7 days.",
      icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
    }
  ];

  useEffect(() => {
    // Load Feedbacks
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

    // Load Stats
    adminService.getAdminStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoadingStats(false));
  }, []);

  useEffect(() => {
    // Poll active tasks
    const pollInterval = setInterval(() => {
      setTaskStatuses(currentStatuses => {
        const activeKeys = Object.keys(currentStatuses).filter(k => {
          const st = currentStatuses[k];
          return st && (st.progress > 0 && st.progress < 100 && st.status !== 'FAILURE');
        });

        if (activeKeys.length > 0) {
          activeKeys.forEach(async (key) => {
            try {
              const res = await api.get(`/internal/progress/${key}`);
              setTaskStatuses(prev => ({...prev, [key]: res.data}));
            } catch (e) {
              console.error(e);
            }
          });
        }
        return currentStatuses;
      });
    }, 2000);

    return () => clearInterval(pollInterval);
  }, []);

  async function handleTriggerTask(taskKey) {
    setTaskStatuses(prev => ({...prev, [taskKey]: { progress: 5, status: "Starting..." }}));
    try {
      await api.post(`/internal/trigger/${taskKey}?token=super-secret-cron-token-change-me`);
    } catch (err) {
      setTaskStatuses(prev => ({...prev, [taskKey]: { progress: 0, status: "FAILURE", error: err.message }}));
    }
  }

  async function handleCancelTask(taskKey) {
    try {
      await api.post(`/internal/cancel/${taskKey}?token=super-secret-cron-token-change-me`);
      setTaskStatuses(prev => ({...prev, [taskKey]: { progress: 0, status: "CANCELLED" }}));
    } catch (err) {
      console.error("Failed to cancel task:", err);
    }
  }

  const getCategoryBadgeClass = (category) => {
    if (category === 'Bug/Error') return 'badge-error';
    if (category === 'Improvement Idea') return 'badge-improvement';
    return 'badge-other';
  };

  const getEmbedUrl = (url) => {
    if (!url) return "";
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}from=now-2d&to=now`;
  };

  const GrafanaCard = ({ title, description, url, icon }) => (
    <div className="admin-grafana-card">
      <span className="admin-grafana-card-glow"></span>
      <div className="admin-grafana-card-header">
        <span className="admin-grafana-icon">{icon}</span>
        <h3>{title}</h3>
      </div>
      <p>{description}</p>
      <a 
        href={getEmbedUrl(url)} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="btn btn--primary btn--sm admin-grafana-btn"
      >
        Open Live Dashboard ↗
      </a>
    </div>
  );

  return (
    <main className="admin-page page-content">
      <div className="admin-aurora-bg" aria-hidden="true">
        <Aurora colorStops={["#1c1c1c", "#3a3a3a", "#000000"]} blend={0.6} amplitude={0.5} speed={0.4} />
      </div>

      <div className="container admin-container">
        <header className="admin-header">
          <h1>
            <span className="admin-icon">🛡️</span> Admin Panel
          </h1>
          <p>System controls, metrics, and user feedback overview.</p>
        </header>

        {/* ── Tabs Navigation ── */}
        <div className="admin-tabs">
          <button className={`admin-tab ${activeTab === 'business' ? 'active' : ''}`} onClick={() => setActiveTab('business')}>Business Growth</button>
          <button className={`admin-tab ${activeTab === 'system' ? 'active' : ''}`} onClick={() => setActiveTab('system')}>System Tasks</button>
          <button className={`admin-tab ${activeTab === 'infrastructure' ? 'active' : ''}`} onClick={() => setActiveTab('infrastructure')}>API & Infra</button>
          <button className={`admin-tab ${activeTab === 'ml' ? 'active' : ''}`} onClick={() => setActiveTab('ml')}>Machine Learning</button>
          <button className={`admin-tab ${activeTab === 'feedback' ? 'active' : ''}`} onClick={() => setActiveTab('feedback')}>User Feedback</button>
        </div>

        {error && <div className="admin-error">{error}</div>}

        {/* ── Business & Growth Analytics ── */}
        {activeTab === 'business' && (
          <section className="admin-stats-section fade-in">
            <div className="admin-subtabs">
              <button className={`admin-subtab ${subTabBusiness === 'db' ? 'active' : ''}`} onClick={() => setSubTabBusiness('db')}>Database Stats</button>
              <button className={`admin-subtab ${subTabBusiness === 'kpis' ? 'active' : ''}`} onClick={() => setSubTabBusiness('kpis')}>Business KPIs (Grafana)</button>
              <button className={`admin-subtab ${subTabBusiness === 'behaviour' ? 'active' : ''}`} onClick={() => setSubTabBusiness('behaviour')}>User Behaviour (Grafana)</button>
            </div>

            {subTabBusiness === 'db' && <AdminAnalytics />}

            {subTabBusiness === 'kpis' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="Business KPIs"
                  description="Review key performance metrics including recommendations served, DAU growth, watchlist actions, and watchlist-to-watch conversion funnels."
                  url={stats?.grafana_business}
                  icon="📈"
                />
              </div>
            )}

            {subTabBusiness === 'behaviour' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="User Behaviour"
                  description="Analyze rating distributions, feedback click logs, and raw interaction log volumes."
                  url={stats?.grafana_behaviour}
                  icon="👥"
                />
              </div>
            )}
          </section>
        )}

        {/* ── System Tasks & Stats ── */}
        {activeTab === 'system' && (
          <div className="fade-in">
            <section className="admin-stats-section">
              <h2>System Stats</h2>
              <div className="admin-stats-grid">
                {loadingStats ? (
                  <p>Loading stats...</p>
                ) : stats ? (
                  <>
                    <div className="admin-stat-card">
                      <span className="admin-stat-label">Users</span>
                      <span className="admin-stat-value">{stats.users?.toLocaleString()}</span>
                    </div>
                    <div className="admin-stat-card">
                      <span className="admin-stat-label">Movies in DB</span>
                      <span className="admin-stat-value">{stats.movies_in_db?.toLocaleString()}</span>
                    </div>
                    <div className="admin-stat-card">
                      <span className="admin-stat-label">Total Ratings</span>
                      <span className="admin-stat-value">{stats.total_ratings?.toLocaleString()}</span>
                    </div>
                    <div className="admin-stat-card">
                      <span className="admin-stat-label">Total Watches</span>
                      <span className="admin-stat-value">{stats.total_watches?.toLocaleString()}</span>
                    </div>
                  </>
                ) : (
                  <p>Failed to load stats.</p>
                )}
              </div>
            </section>

            <section className="admin-tasks-section">
              <h2>Manual Triggers & Tasks</h2>
              <div className="admin-tasks-list">
                {TASKS.map(task => {
                  const state = taskStatuses[task.key] || { progress: 0, status: "idle" };
                  const isRunning = state.progress > 0 && state.progress < 100 && state.status !== 'FAILURE' && state.status !== 'CANCELLED';
                  const isSuccess = state.progress === 100 && state.status === 'SUCCESS';
                  const isFailed = state.status === 'FAILURE';
                  const isCancelled = state.status === 'CANCELLED';
                  
                  return (
                    <div key={task.key} className="admin-task-row">
                      <div className="admin-task-row-left">
                        <div className="admin-task-row-icon">
                          {task.icon}
                        </div>
                        <div className="admin-task-row-details">
                          <h4>{task.name}</h4>
                          <p>{task.desc}</p>
                        </div>
                      </div>
                      
                      <div className="admin-task-row-right">
                        {/* Progress Bar Area */}
                        {(isRunning || isSuccess || isFailed || isCancelled || state.progress > 0) && (
                          <div className="admin-task-row-progress-container">
                            <div className="admin-task-row-progress-text">
                              <span style={{ 
                                color: isFailed ? '#ef4444' : isSuccess ? '#10b981' : isCancelled ? '#6b7280' : '#56CFE1',
                                fontWeight: 500
                              }}>
                                {state.status}
                              </span>
                              <span style={{ color: 'var(--text-secondary)' }}>{state.progress}%</span>
                            </div>
                            <div className="admin-task-row-progress-track">
                              <div className="admin-task-row-progress-bar" style={{ 
                                width: `${state.progress}%`,
                                background: isFailed ? '#ef4444' : isSuccess ? '#10b981' : isCancelled ? '#4b5563' : '#56CFE1',
                              }} />
                            </div>
                            {isFailed && state.error && (
                              <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '4px' }}>{state.error}</div>
                            )}
                          </div>
                        )}
                        
                        {/* Actions */}
                        <div className="admin-task-row-actions">
                          {isRunning ? (
                            <button 
                              className="btn btn--danger btn--sm" 
                              onClick={() => handleCancelTask(task.key)}
                              style={{ 
                                background: 'rgba(239, 68, 68, 0.1)', 
                                border: '1px solid #ef4444', 
                                color: '#ef4444',
                                minWidth: '80px' 
                              }}
                            >
                              Stop
                            </button>
                          ) : (
                            <button 
                              className="btn btn--primary btn--sm" 
                              onClick={() => handleTriggerTask(task.key)}
                              style={{ minWidth: '80px' }}
                            >
                              {isSuccess ? 'Run Again' : 'Run'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        )}

        {/* ── API & Infrastructure ── */}
        {activeTab === 'infrastructure' && (
          <section className="admin-stats-section fade-in">
            <div className="admin-subtabs">
              <button className={`admin-subtab ${subTabInfra === 'api' ? 'active' : ''}`} onClick={() => setSubTabInfra('api')}>API Health</button>
              <button className={`admin-subtab ${subTabInfra === 'infra' ? 'active' : ''}`} onClick={() => setSubTabInfra('infra')}>Infrastructure</button>
            </div>

            {subTabInfra === 'api' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="API Health Metrics"
                  description="Monitor request counts, response durations, HTTP error rates, status code breakdowns, and throughput trends in real-time."
                  url={stats?.grafana_api_health}
                  icon="🚀"
                />
              </div>
            )}

            {subTabInfra === 'infra' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="Infrastructure Health"
                  description="Track server metrics including CPU load, memory usage, request volumes, and active exception rates."
                  url={stats?.grafana_infra}
                  icon="🖥️"
                />
              </div>
            )}
          </section>
        )}

        {/* ── Machine Learning ── */}
        {activeTab === 'ml' && (
          <section className="admin-stats-section fade-in">
            <div className="admin-subtabs">
              <button className={`admin-subtab ${subTabML === 'recs' ? 'active' : ''}`} onClick={() => setSubTabML('recs')}>Recommendation System</button>
              <button className={`admin-subtab ${subTabML === 'graph' ? 'active' : ''}`} onClick={() => setSubTabML('graph')}>Graph Analysis</button>
              <button className={`admin-subtab ${subTabML === 'retrain' ? 'active' : ''}`} onClick={() => setSubTabML('retrain')}>Retraining</button>
            </div>

            {subTabML === 'recs' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="Recommendation System"
                  description="Analyze Personalized PageRank latencies, XGBRanker inference speeds, feature matrix construction times, and cache hit/miss distributions."
                  url={stats?.grafana_recs}
                  icon="🧠"
                />
              </div>
            )}

            {subTabML === 'graph' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="Graph Analysis"
                  description="Visualize graph size growth, node/edge counts, and density ratio fluctuations over time."
                  url={stats?.grafana_graph}
                  icon="🕸️"
                />
              </div>
            )}

            {subTabML === 'retrain' && (
              <div className="admin-cards-container">
                <GrafanaCard
                  title="Model Retraining Tracker"
                  description="Track nightly model retraining outcomes, training durations, iterations, and active Celery task schedules."
                  url={stats?.grafana_retrain}
                  icon="🔄"
                />
              </div>
            )}
          </section>
        )}

        {/* ── User Feedback ── */}
        {activeTab === 'feedback' && (
          <section className="admin-tasks-section fade-in">
            <h2>User Feedback</h2>
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
          </section>
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
    </main>
  );
}
