import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { adminService } from '../services/adminService';
import Aurora from '../components/Aurora';
import AdminAnalytics from '../components/AdminAnalytics';
import './AdminDashboard.css';
import './AdminPage.css'; // Import the new styles we created

const TASKS = [
  { key: "retrain_ranker",  label: "Retrain Ranker",          icon: "🧠" },
  { key: "sync_movies",     label: "Sync Movies",             icon: "🎞️" },
  { key: "fetch_news",      label: "Fetch News (Global)",     icon: "📰" },
  { key: "fetch_cat_news",  label: "Fetch News (Category)",   icon: "📑" },
  { key: "check_episodes",  label: "Check Episodes",          icon: "📺" },
  { key: "expire_articles", label: "Expire Old Articles",     icon: "🗑️" },
]

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

  const [taskStates, setTaskStates] = useState(
    Object.fromEntries(TASKS.map(t => [t.key, {
      status:   "idle",
      progress: 0,
      job_id:   null,
      result:   null,
      error:    null,
    }]))
  )

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

  function startPolling(task_key, job_id) {
    const interval = setInterval(async () => {
      try {
        const res = await adminService.getTaskStatus(job_id, task_key)
        const { status, progress, result, error } = res
        
        setTaskStates(prev => ({
          ...prev,
          [task_key]: { ...prev[task_key], status, progress, result, error, job_id }
        }))

        if (['SUCCESS', 'FAILURE', 'REVOKED'].includes(status)) {
          clearInterval(interval)
        }
      } catch (err) {
        clearInterval(interval)
      }
    }, 2000)
  }

  async function triggerTask(task_key) {
    setTaskStates(prev => ({...prev, [task_key]: {...prev[task_key], status: "queued", progress: 0}}))
    try {
      const res = await adminService.triggerTask(task_key)
      const job_id = res.job_id
      setTaskStates(prev => ({...prev, [task_key]: {...prev[task_key], job_id, status: "PENDING"}}))
      startPolling(task_key, job_id)
    } catch (err) {
      setTaskStates(prev => ({
        ...prev, 
        [task_key]: {
          ...prev[task_key], 
          status: "FAILURE", 
          error: err.response?.data?.detail || "Failed to trigger task"
        }
      }))
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
              <h2>Celery Task Control</h2>
              <div className="admin-tasks-table-wrapper">
                <table className="admin-tasks-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TASKS.map(task => {
                      const state = taskStates[task.key]
                      const isRunning = ['queued', 'PENDING', 'STARTED'].includes(state.status)
                      
                      return (
                        <tr key={task.key}>
                          <td>
                            <div className="admin-task-name">
                              <span className="admin-task-icon">{task.icon}</span>
                              <span>{task.label}</span>
                            </div>
                            {state.status !== 'idle' && state.status !== 'SUCCESS' && (
                              <div className="admin-task-progress">
                                <div className="admin-task-progress-track">
                                  <div 
                                    className={`admin-task-progress-bar ${state.status === 'FAILURE' ? 'error' : ''}`}
                                    style={{ width: `${state.progress}%` }} 
                                  />
                                </div>
                                <span className="admin-task-progress-label">
                                  {state.status === 'STARTED' ? 'Running...' :
                                   state.status === 'PENDING' ? 'Queued...' :
                                   state.status === 'FAILURE' ? `Failed: ${state.error}` : state.status}
                                </span>
                              </div>
                            )}
                            {state.status === 'SUCCESS' && (
                              <div className="admin-task-result">
                                <pre>{JSON.stringify(state.result, null, 2)}</pre>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className={`admin-badge admin-badge--${state.status.toLowerCase()}`}>
                              {state.status}
                            </span>
                          </td>
                          <td>
                            <button 
                              className="btn btn--primary btn--sm" 
                              onClick={() => triggerTask(task.key)}
                              disabled={isRunning}
                            >
                              {isRunning ? 'Running...' : 'Run'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
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
