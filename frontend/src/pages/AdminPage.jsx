import { useState, useEffect } from 'react'
import { adminService } from '../services/adminService'
import Aurora from '../components/Aurora'
import './AdminPage.css'

const TASKS = [
  { key: "retrain_ranker",  label: "Retrain Ranker",          icon: "🧠" },
  { key: "sync_movies",     label: "Sync Movies",             icon: "🎞️" },
  { key: "fetch_news",      label: "Fetch News (Global)",     icon: "📰" },
  { key: "fetch_cat_news",  label: "Fetch News (Category)",   icon: "📑" },
  { key: "check_episodes",  label: "Check Episodes",          icon: "📺" },
  { key: "expire_articles", label: "Expire Old Articles",     icon: "🗑️" },
  { key: "nightly_job",     label: "Overall Nightly Job",     icon: "🌙" },
]

export default function AdminPage() {
  const [stats, setStats] = useState(null)
  const [loadingStats, setLoadingStats] = useState(true)

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
    adminService.getAdminStats()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoadingStats(false))
  }, [])

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

  async function handleStop(task_key, job_id) {
    if (!job_id) return
    try {
      await adminService.stopTask(job_id)
      setTaskStates(prev => ({
        ...prev,
        [task_key]: { ...prev[task_key], status: "REVOKED", progress: 0 }
      }))
    } catch (err) {
      console.error("Failed to stop task:", err)
    }
  }

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
          <p>System controls and metrics overview.</p>
        </header>

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
                  const isRunning = ['queued', 'PENDING', 'STARTED', 'PROGRESS'].includes(state.status)
                  
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
                              {state.status === 'STARTED' || state.status === 'PROGRESS' ? 'Running...' :
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
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            className="btn btn--primary btn--sm" 
                            onClick={() => triggerTask(task.key)}
                            disabled={isRunning}
                          >
                            {isRunning ? 'Running...' : 'Run'}
                          </button>
                          {isRunning && (
                            <button
                              className="btn btn--danger btn--sm"
                              onClick={() => handleStop(task.key, state.job_id)}
                              style={{ backgroundColor: '#dc3545', color: 'white' }}
                            >
                              Stop
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
