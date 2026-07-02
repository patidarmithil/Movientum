import { useEffect, useState } from 'react'
import { userService } from '../services/userService'
import api from '../utils/api';
import ShinyText from '../components/ShinyText';
import Aurora from '../components/Aurora'
import './Analysis.css'

// ── -1. Profile Editor ──
function ProfileEditor({ dateRangeData, onSave }) {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [prefs, setPrefs] = useState({
    content_type_pref: 'balanced',
    popularity_pref: 'mixed',
    discovery_mode: 'explore'
  });
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tasteData, setTasteData] = useState([]);
  const [editedTaste, setEditedTaste] = useState({});

  useEffect(() => {
    if (dateRangeData) {
      if (dateRangeData.saved_from) setDateFrom(dateRangeData.saved_from.split('T')[0]);
      if (dateRangeData.saved_to) setDateTo(dateRangeData.saved_to.split('T')[0]);
      setPrefs({
        content_type_pref: dateRangeData.content_type_pref || 'balanced',
        popularity_pref: dateRangeData.popularity_pref || 'mixed',
        discovery_mode: dateRangeData.discovery_mode || 'explore'
      });
    }
  }, [dateRangeData]);

  useEffect(() => {
    if (expanded && tasteData.length === 0) {
      userService.getTasteProfile().then(res => {
        if (res.data) {
          setTasteData(res.data);
          const initialEdits = {};
          res.data.forEach(g => {
             initialEdits[g.id] = g.weight;
          });
          setEditedTaste(initialEdits);
        }
      }).catch(err => console.error(err));
    }
  }, [expanded]);

  if (!dateRangeData) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      await userService.saveDateRange(
        dateFrom ? new Date(dateFrom).toISOString() : null,
        dateTo ? new Date(dateTo).toISOString() : null
      );
      await userService.saveRecPreferences(prefs);
      
      if (Object.keys(editedTaste).length > 0) {
        await userService.saveTasteProfile(editedTaste);
      }
      
      if (onSave) onSave();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setDateFrom('');
    setDateTo('');
    setPrefs({
      content_type_pref: 'balanced',
      popularity_pref: 'mixed',
      discovery_mode: 'explore'
    });
    setSaving(true);
    try {
      await userService.saveDateRange(null, null);
      await userService.saveRecPreferences({
        content_type_pref: 'balanced',
        popularity_pref: 'mixed',
        discovery_mode: 'explore'
      });
      if (onSave) onSave();
    } catch(err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const setPreset = (months) => {
    if (!months) {
      setDateFrom('');
      setDateTo('');
      return;
    }
    const d = new Date();
    d.setMonth(d.getMonth() - months);
    setDateFrom(d.toISOString().split('T')[0]);
    setDateTo('');
  };

  const handleSliderChange = (id, val) => {
    setEditedTaste(prev => ({
      ...prev,
      [id]: parseFloat(val)
    }));
  };

  return (
    <section className="profile-editor-card glass-panel fade-in">
      <div className="pe-header">
        <h2><ShinyText text="Your Recommendation Profile" /></h2>
        <p className="card-subtitle">Adjust the signals we use to generate your recommendations.</p>
      </div>

      <div className="pe-date-range">
        <div className="pe-range-inputs">
          <div className="pe-input-group">
            <label>From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} min={dateRangeData.watch_history_min?.split('T')[0]} max={dateRangeData.watch_history_max?.split('T')[0]} />
          </div>
          <div className="pe-input-group">
            <label>To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} min={dateRangeData.watch_history_min?.split('T')[0]} max={dateRangeData.watch_history_max?.split('T')[0]} />
          </div>
        </div>
        <div className="pe-presets">
          <button className="preset-pill" onClick={() => setPreset(3)}>Last 3m</button>
          <button className="preset-pill" onClick={() => setPreset(6)}>Last 6m</button>
          <button className="preset-pill" onClick={() => setPreset(12)}>Last 1y</button>
          <button className="preset-pill" onClick={() => setPreset(24)}>Last 2y</button>
          <button className="preset-pill" onClick={() => setPreset(null)}>All time</button>
        </div>
      </div>

      <button className="pe-expand-btn" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide Advanced Preferences' : 'Show Advanced Preferences'}
      </button>

      {expanded && (
        <div className="pe-advanced-prefs">
          <div className="pref-group">
            <label>Content Type</label>
            <select value={prefs.content_type_pref} onChange={e => setPrefs({...prefs, content_type_pref: e.target.value})}>
              <option value="balanced">Balanced</option>
              <option value="movie">Movies Preferred</option>
              <option value="tv">TV Shows Preferred</option>
            </select>
          </div>
          <div className="pref-group">
            <label>Popularity</label>
            <select value={prefs.popularity_pref} onChange={e => setPrefs({...prefs, popularity_pref: e.target.value})}>
              <option value="mainstream">Mainstream</option>
              <option value="mixed">Mixed</option>
              <option value="niche">Niche</option>
            </select>
          </div>
          <div className="pref-group">
            <label>Discovery Mode</label>
            <select value={prefs.discovery_mode} onChange={e => setPrefs({...prefs, discovery_mode: e.target.value})}>
              <option value="safe">Safe Picks</option>
              <option value="explore">Explore / Adventurous</option>
            </select>
          </div>
          
          <div className="taste-sliders-container">
             <h3 className="taste-sliders-title">Adjust Genre Weights</h3>
             <p className="taste-sliders-desc">Manually override how much weight the recommendation engine assigns to each genre.</p>
             {tasteData.map(g => {
                const minWeight = Math.min(0, Math.floor(Math.min(...tasteData.map(d => d.weight)) * 1.5));
                const maxWeight = Math.max(100, Math.ceil(Math.max(...tasteData.map(d => d.weight)) * 1.5));
                return (
                <div key={g.id} className="taste-slider-row">
                   <span className="ts-name">{g.name}</span>
                   <input 
                      type="range" 
                      min={minWeight} 
                      max={maxWeight} 
                      step="0.1" 
                      value={editedTaste[g.id] ?? g.weight}
                      onChange={(e) => handleSliderChange(g.id, e.target.value)}
                      className="ts-slider"
                   />
                   <input
                      type="number"
                      className="ts-number"
                      value={editedTaste[g.id] !== undefined ? editedTaste[g.id] : g.weight}
                      onChange={(e) => handleSliderChange(g.id, e.target.value)}
                      step="0.1"
                   />
                </div>
                );
             })}
          </div>
        </div>
      )}

      <div className="pe-actions">
        <button className="btn-save" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</button>
        <button className="btn-reset" onClick={handleReset} disabled={saving}>Reset to Defaults</button>
      </div>
    </section>
  );
}

// ── 0. Rec Explanation Panel ──
function RecExplanationPanel({ expData }) {
  if (!expData) return null;

  const {
    genre_profile,
    language_profile,
    exclusions,
    current_seed,
    blend_info,
    quality_gate,
    data_range
  } = expData;

  // Transform top 5 combined genres
  const topGenres = Object.entries(genre_profile.combined)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const topLangs = Object.entries(language_profile)
    .filter(([lang, freq]) => freq > 0.1)
    .map(([lang]) => lang);

  return (
    <section className="chart-card glass-panel fade-in full-width-card rec-explanation-panel">
      <h2>Why You See What You See</h2>
      <p className="card-subtitle">Transparency into your recommendation engine profile and settings.</p>

      <div className="rec-explanation-grid">
        {/* A. Profile Build */}
        <div className="rec-exp-section">
          <h3>How Your Profile Was Built</h3>
          <div className="signal-split-bar">
            <div className="signal-fill watch" style={{ width: '70%' }}>Watch History (70%)</div>
            <div className="signal-fill click" style={{ width: '30%' }}>Click Data (30%)</div>
          </div>
          <p className="formula-text"><code>{genre_profile.formula}</code></p>
          <div className="top-genres-bars">
            {topGenres.map(([genre, weight]) => {
              const watchW = (genre_profile.watch_genres[genre] || 0) * 0.7 * 100;
              const clickW = (genre_profile.click_genres[genre] || 0) * 0.3 * 100;
              return (
                <div key={genre} className="genre-bar-row">
                  <span className="genre-label">{genre}</span>
                  <div className="genre-bar-container">
                    <div className="genre-bar watch" style={{ width: `${watchW}%` }}></div>
                    <div className="genre-bar click" style={{ width: `${clickW}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* B. Exclusions */}
        <div className="rec-exp-section">
          <h3>What's Filtered Out</h3>
          <p className="section-desc">These are hidden from your feed to keep recommendations fresh.</p>
          <div className="exclusion-pills">
            <span className="exclusion-pill">🎬 {exclusions.recent_watched_7d} recently watched</span>
            <span className="exclusion-pill">👎 {exclusions.low_rated} low-rated excluded</span>
            <span className="exclusion-pill">📋 {exclusions.in_watchlist} in watchlist</span>
          </div>
        </div>

        {/* C. Current Seed */}
        <div className="rec-exp-section">
          <h3>Today's Recommendation Seed</h3>
          {current_seed ? (
            <div className="seed-card">
              {current_seed.poster_path ? (
                <img src={`https://image.tmdb.org/t/p/w200${current_seed.poster_path}`} alt="seed" className="seed-poster" />
              ) : (
                <div className="seed-poster placeholder">🎬</div>
              )}
              <div className="seed-info">
                <p>We started today's ML pipeline from:</p>
                <strong>{current_seed.title}</strong>
              </div>
            </div>
          ) : (
            <p className="no-data-text">No watch history to seed from.</p>
          )}
        </div>

        {/* D. Blend Formula */}
        <div className="rec-exp-section">
          <h3>Blend Formula</h3>
          <div className="signal-split-bar">
            <div className="signal-fill ml" style={{ width: `${blend_info.ml_ratio * 100}%` }}>ML Model ({blend_info.ml_ratio * 100}%)</div>
            <div className="signal-fill baseline" style={{ width: `${blend_info.baseline_ratio * 100}%` }}>Baseline ({blend_info.baseline_ratio * 100}%)</div>
          </div>
          <div className="blend-labels">
            <span>{blend_info.ml_model}</span>
            <span>{blend_info.baseline_model}</span>
          </div>
          {topLangs.length > 0 && (
            <p className="lang-note">Language priority: {topLangs.join(', ').toUpperCase()} (up to 90% of feed)</p>
          )}
        </div>

        {/* E. Quality Gate */}
        <div className="rec-exp-section">
          <h3>Quality Gate</h3>
          <div className="quality-badges">
            <span className="badge">★ ≥ {quality_gate.min_vote_average}</span>
            <span className="badge">Votes ≥ {quality_gate.min_vote_count}</span>
            {quality_gate.requires_poster && <span className="badge">Poster required</span>}
          </div>
        </div>
      </div>
    </section>
  );
}

// ── 1. Genre Distribution Donut Chart ──
function DonutChart({ data }) {
  const radius = 65;
  const strokeWidth = 18;
  const circumference = 2 * Math.PI * radius;
  let accumulatedPercent = 0;

  const colors = [
    '#A78BFA', '#F472B6', '#60A5FA', '#34D399', '#FB7185',
    '#FBBF24', '#818CF8', '#FB923C', '#2DD4BF', '#F43F5E'
  ];

  return (
    <div className="donut-chart-wrapper">
      <svg width="180" height="180" viewBox="0 0 180 180" className="donut-chart-svg">
        <circle 
          cx="90" 
          cy="90" 
          r={radius} 
          fill="none" 
          stroke="rgba(255,255,255,0.05)" 
          strokeWidth={strokeWidth} 
        />
        <g transform="rotate(-90 90 90)">
          {data.map((item, idx) => {
            const percentage = item.percentage;
            const dashArray = `${percentage * circumference} ${circumference}`;
            const dashOffset = -accumulatedPercent * circumference;
            accumulatedPercent += percentage;
            const color = colors[idx % colors.length];

            return (
              <circle
                key={item.genre}
                cx="90"
                cy="90"
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                className="donut-segment"
                style={{
                  strokeDasharray: dashArray,
                  strokeDashoffset: dashOffset
                }}
              >
                <title>{`${item.genre}: ${(percentage * 100).toFixed(1)}%`}</title>
              </circle>
            );
          })}
        </g>
        <circle cx="90" cy="90" r={radius - strokeWidth / 2 - 2} fill="#0d0e12" />
        <text x="90" y="85" textAnchor="middle" fill="#9CA3AF" fontSize="10" fontFamily="Inter">Taste DNA</text>
        <text x="90" y="108" textAnchor="middle" fill="#FFFFFF" fontSize="18" fontWeight="bold" fontFamily="Outfit">
          {data[0] ? `${(data[0].percentage * 100).toFixed(0)}%` : '0%'}
        </text>
        <text x="90" y="122" textAnchor="middle" fill="#B048FF" fontSize="9" fontWeight="bold" fontFamily="Inter">
          {data[0] ? data[0].genre.toUpperCase() : 'N/A'}
        </text>
      </svg>
      <div className="donut-legend">
        {data.slice(0, 4).map((item, idx) => (
          <div key={item.genre} className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: colors[idx % colors.length] }}></span>
            <span className="legend-label">{item.genre}</span>
            <span className="legend-value">{(item.percentage * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 2. Rating Behavior Histogram ──
function RatingHistogram({ profile }) {
  const { liked_count, neutral_count, disliked_count } = profile;
  const maxCount = Math.max(1, liked_count, neutral_count, disliked_count);

  const bars = [
    { label: 'Disliked (0-3)', count: disliked_count, color: '#F43F5E' },
    { label: 'Neutral (4-6)', count: neutral_count, color: '#FBBF24' },
    { label: 'Liked (7-10)', count: liked_count, color: '#10B981' }
  ];

  return (
    <div className="rating-histogram">
      <div className="histogram-bars">
        {bars.map((bar, idx) => {
          const heightPercent = (bar.count / maxCount) * 80;
          return (
            <div key={idx} className="histogram-col">
              <div className="histogram-bar-container">
                <span className="histogram-bar-count">{bar.count}</span>
                <div
                  className="histogram-bar"
                  style={{
                    height: `${heightPercent || 6}%`,
                    backgroundColor: bar.color,
                    boxShadow: `0 0 15px ${bar.color}33`
                  }}
                ></div>
              </div>
              <span className="histogram-label">{bar.label}</span>
            </div>
          );
        })}
      </div>
      <div className="rating-insights">
        <div className="avg-badge">
          <span className="num">{profile.avg_rating.toFixed(1)}</span>
          <span className="lbl">Average score</span>
        </div>
        <div className="style-badge">
          <span className="style-text">{profile.style_label}</span>
          <span className="lbl">Psychology Profile</span>
        </div>
      </div>
    </div>
  );
}

// ── 3. Taste Evolution Line Chart ──
function TasteEvolutionLineChart({ data }) {
  const topGenres = data.slice(0, 5);
  if (topGenres.length === 0) {
    return <p className="no-data-msg">Not enough historical watch data to track evolution.</p>;
  }

  const width = 450;
  const height = 180;
  const paddingLeft = 35;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(
    0.1,
    ...topGenres.map(g => g.recent),
    ...topGenres.map(g => g.older)
  );

  const getX = (index) => paddingLeft + (index / (topGenres.length - 1)) * chartWidth;
  const getY = (val) => height - paddingBottom - (val / maxVal) * chartHeight;

  let olderPoints = '';
  let recentPoints = '';
  let olderAreaPoints = `M ${getX(0)} ${height - paddingBottom} `;
  let recentAreaPoints = `M ${getX(0)} ${height - paddingBottom} `;

  topGenres.forEach((g, idx) => {
    const x = getX(idx);
    const yOlder = getY(g.older);
    const yRecent = getY(g.recent);

    if (idx === 0) {
      olderPoints += `M ${x} ${yOlder}`;
      recentPoints += `M ${x} ${yRecent}`;
    } else {
      olderPoints += ` L ${x} ${yOlder}`;
      recentPoints += ` L ${x} ${yRecent}`;
    }

    olderAreaPoints += `L ${x} ${yOlder} `;
    recentAreaPoints += `L ${x} ${yRecent} `;
  });

  olderAreaPoints += `L ${getX(topGenres.length - 1)} ${height - paddingBottom} Z`;
  recentAreaPoints += `L ${getX(topGenres.length - 1)} ${height - paddingBottom} Z`;

  return (
    <div className="evolution-line-chart">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        <defs>
          <linearGradient id="olderGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3"/>
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.0"/>
          </linearGradient>
          <linearGradient id="recentGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EC4899" stopOpacity="0.3"/>
            <stop offset="100%" stopColor="#EC4899" stopOpacity="0.0"/>
          </linearGradient>
        </defs>

        {/* Y Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, i) => {
          const y = height - paddingBottom - ratio * chartHeight;
          return (
            <line
              key={i}
              x1={paddingLeft}
              y1={y}
              x2={width - paddingRight}
              y2={y}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
            />
          );
        })}

        {/* Area */}
        <path d={olderAreaPoints} fill="url(#olderGrad)" />
        <path d={recentAreaPoints} fill="url(#recentGrad)" />

        {/* Lines */}
        <path d={olderPoints} fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" />
        <path d={recentPoints} fill="none" stroke="#EC4899" strokeWidth="2.5" strokeLinecap="round" />

        {/* Dots & Labels */}
        {topGenres.map((g, idx) => {
          const x = getX(idx);
          const yOlder = getY(g.older);
          const yRecent = getY(g.recent);
          return (
            <g key={idx}>
              <circle cx={x} cy={yOlder} r="3.5" fill="#3B82F6" stroke="#0d0e12" strokeWidth="1.5" />
              <circle cx={x} cy={yRecent} r="3.5" fill="#EC4899" stroke="#0d0e12" strokeWidth="1.5" />
              <text
                x={x}
                y={height - 8}
                textAnchor="middle"
                fill="#9CA3AF"
                fontSize="8.5"
                fontFamily="Inter"
              >
                {g.genre}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="legend-item"><span className="dot older-dot"></span> Older Data</span>
        <span className="legend-item"><span className="dot recent-dot"></span> Last 30 Days</span>
      </div>
    </div>
  );
}

// ── 4. Click vs Watch Gap Chart ──
function ClickWatchGapChart({ comparison }) {
  const items = Object.entries(comparison).slice(0, 5);
  if (items.length === 0) return <p className="no-data-msg">No data for comparison.</p>;

  const width = 450;
  const height = 180;
  const paddingLeft = 35;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxVal = Math.max(
    0.1,
    ...items.map(([_, v]) => Math.max(v.watch, v.click))
  );

  const getX = (index) => paddingLeft + (index / items.length) * chartWidth;
  const getY = (val) => height - paddingBottom - (val / maxVal) * chartHeight;

  const barWidth = 12;

  return (
    <div className="gap-bar-chart">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="svg-chart">
        {/* Y Grid Lines */}
        {[0, 0.25, 0.5, 0.75, 1.0].map((ratio, i) => {
          const y = height - paddingBottom - ratio * chartHeight;
          return (
            <line
              key={i}
              x1={paddingLeft}
              y1={y}
              x2={width - paddingRight}
              y2={y}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
            />
          );
        })}

        {items.map(([genre, stats], idx) => {
          const groupWidth = chartWidth / items.length;
          const startX = getX(idx) + (groupWidth - barWidth * 2 - 4) / 2;

          const yWatch = getY(stats.watch);
          const hWatch = height - paddingBottom - yWatch;

          const yClick = getY(stats.click);
          const hClick = height - paddingBottom - yClick;

          return (
            <g key={genre}>
              {/* Watch Bar (Purple) */}
              <rect
                x={startX}
                y={yWatch}
                width={barWidth}
                height={hWatch || 2}
                rx="2"
                fill="#8B5CF6"
                className="chart-rect"
              >
                <title>{`Watch: ${(stats.watch * 100).toFixed(1)}%`}</title>
              </rect>
              {/* Click Bar (Pink) */}
              <rect
                x={startX + barWidth + 4}
                y={yClick}
                width={barWidth}
                height={hClick || 2}
                rx="2"
                fill="#F472B6"
                className="chart-rect"
              >
                <title>{`Click: ${(stats.click * 100).toFixed(1)}%`}</title>
              </rect>
              {/* X Label */}
              <text
                x={startX + barWidth + 2}
                y={height - 8}
                textAnchor="middle"
                fill="#9CA3AF"
                fontSize="8.5"
                fontFamily="Inter"
              >
                {genre}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="chart-legend">
        <span className="legend-item"><span className="dot watch-dot"></span> Watched %</span>
        <span className="legend-item"><span className="dot click-dot"></span> Clicked %</span>
      </div>
    </div>
  );
}

// ── 5. Discovery Score Gauge ──
function DiscoveryGauge({ score, type }) {
  const radius = 45;
  const strokeWidth = 8;
  const fullCircumference = 2 * Math.PI * radius;
  const strokeDashoffset = fullCircumference - (score / 100) * fullCircumference;

  return (
    <div className="discovery-gauge-wrapper">
      <svg width="130" height="130" viewBox="0 0 130 130" className="gauge-svg">
        <defs>
          <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#10B981"/>
            <stop offset="50%" stopColor="#6366F1"/>
            <stop offset="100%" stopColor="#EC4899"/>
          </linearGradient>
        </defs>
        <circle
          cx="65"
          cy="65"
          r={radius}
          fill="none"
          stroke="rgba(255, 255, 255, 0.05)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="65"
          cy="65"
          r={radius}
          fill="none"
          stroke="url(#gaugeGrad)"
          strokeWidth={strokeWidth}
          strokeDasharray={fullCircumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 65 65)"
          className="gauge-progress"
          style={{ transition: 'stroke-dashoffset 1s ease-out' }}
        />
        <text x="65" y="58" textAnchor="middle" fill="#9CA3AF" fontSize="9" fontFamily="Inter">DEPTH</text>
        <text x="65" y="78" textAnchor="middle" fill="#FFFFFF" fontSize="20" fontWeight="bold" fontFamily="Outfit">{score}</text>
        <text x="65" y="92" textAnchor="middle" fill="#B048FF" fontSize="8" fontWeight="bold" fontFamily="Inter">{type.toUpperCase()}</text>
      </svg>
    </div>
  );
}

// ── 6. Phase 3 Components ──
function DirectorAffinity({ data }) {
  if (!data || !data.top_directors || data.top_directors.length === 0) return <p className="no-data-msg">No director data available.</p>;
  const maxCount = Math.max(...data.top_directors.map(d => d.count));
  
  return (
    <div className="director-affinity">
      {data.top_directors.map(d => (
        <div key={d.name} className="director-row">
          <span className="dir-name">{d.name}</span>
          <div className="dir-bar-container">
            <div className="dir-bar" style={{ width: `${(d.count / maxCount) * 100}%` }}></div>
          </div>
          <span className="dir-count">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

function BingePattern({ data }) {
  if (!data) return null;
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const maxDow = Math.max(1, ...days.map(d => data.binge_dow[d] || 0));

  return (
    <div className="binge-pattern">
      <div className="binge-stats">
        <div className="stat-box"><h4>{data.binge_sessions}</h4><p>Binge Sessions</p></div>
        <div className="stat-box"><h4>{data.longest_binge}</h4><p>Max Items</p></div>
        <div className="stat-box"><h4>{data.max_streak}</h4><p>Day Streak</p></div>
      </div>
      <div className="binge-dow-chart">
        {days.map(day => (
          <div key={day} className="dow-col">
            <div className="dow-bar-container">
              <div className="dow-bar" style={{ height: `${((data.binge_dow[day] || 0) / maxDow) * 100}%` }}></div>
            </div>
            <span>{day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TasteDrift({ data }) {
  if (!data || !data.quarters || data.quarters.length < 2) return <p className="no-data-msg">Not enough historical quarters for drift analysis.</p>;
  
  return (
    <div className="taste-drift">
      <div className="drift-header">
        <div className="drift-score-box">
          <span className="score">{(data.drift_score * 100).toFixed(0)}%</span>
          <span className="label">Drift</span>
        </div>
        <div className="drift-label-box">
          <h4>{data.label}</h4>
        </div>
      </div>
      <div className="drift-timeline">
        {data.quarters.map((q, idx) => (
          <div key={q.quarter} className="timeline-node">
            <div className="node-dot"></div>
            <div className="node-info">
              <span className="node-q">{q.quarter}</span>
              <span className="node-genre">{q.top_genre}</span>
            </div>
            {idx < data.quarters.length - 1 && <div className="node-line"></div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function HiddenGems({ data }) {
  if (!data || data.count === 0) return <p className="no-data-msg">No hidden gems found yet.</p>;

  return (
    <div className="hidden-gems">
      <div className="gems-header">
        <span className="gems-ratio">{(data.ratio * 100).toFixed(1)}% of favorites are obscure</span>
        {data.seed_genres && data.seed_genres.length > 0 && (
          <span className="gems-seeds">Explore more: {data.seed_genres.map(g => g[0]).join(', ')}</span>
        )}
      </div>
      <div className="rewatch-scroll-row">
        {data.gems.map(item => (
          <a href={`/movies/${item.id}`} key={item.id} className="rewatch-card">
            {item.poster_path ? (
              <img src={`https://image.tmdb.org/t/p/w200${item.poster_path}`} alt={item.title} />
            ) : (
              <div className="no-poster">🎬</div>
            )}
            <div className="overlay">
              <span className="rewatch-title">{item.title}</span>
              <span className="rewatch-why">Pop: {item.tmdb_popularity.toFixed(1)}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function FeedbackLoop({ data }) {
  if (!data || (data.thumbs_up === 0 && data.thumbs_down === 0 && data.not_interested === 0)) return <p className="no-data-msg">No feedback interactions yet.</p>;

  return (
    <div className="feedback-loop">
      <div className="feedback-stats">
        <div className="f-stat"><span className="icon">👍</span> {data.thumbs_up}</div>
        <div className="f-stat"><span className="icon">👎</span> {data.thumbs_down}</div>
        <div className="f-stat"><span className="icon">🚫</span> {data.not_interested}</div>
      </div>
      <div className="conversion-box">
        <h4>{(data.conversion_rate * 100).toFixed(1)}%</h4>
        <p>of liked recommendations were actually watched</p>
      </div>
    </div>
  );
}

export default function Analysis() {
  const [data, setData] = useState(null)
  const [expData, setExpData] = useState(null)
  const [dateRangeData, setDateRangeData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchData = async () => {
    setLoading(true);
    try {
      const [analysisRes, expRes, dateRes] = await Promise.all([
        userService.getAnalysis(),
        userService.getRecExplanation().catch(err => ({ data: null })),
        userService.getDateRange().catch(err => null)
      ]);
      setData(analysisRes.data)
      if (expRes && expRes.data) setExpData(expRes.data)
      if (dateRes) setDateRangeData(dateRes)
    } catch (err) {
      setError('Failed to load analysis data.')
    } finally {
      setLoading(false)
    }
  };

  useEffect(() => {
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="analysis-page loading">
        <div className="spinner"></div>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="analysis-page error">
        <h2>{error || 'No data available.'}</h2>
      </div>
    )
  }

  const {
    genre_distribution,
    rating_profile,
    evolution,
    comparison,
    insight,
    popularity_style,
    avg_popularity,
    content_behavior,
    rewatch_candidates,
    early_favorites,
    discovery_depth_score,
    personal_tags,
    summary,
    director_affinity,
    binge_pattern,
    taste_drift,
    hidden_gems,
    feedback_loop
  } = data

  return (
    <div className="analysis-page">
      {/* ── Background Aurora Animation ── */}
      <div className="analysis-aurora-bg" aria-hidden="true">
        <Aurora
          colorStops={["#00FF87", "#60EFFF", "#0061ff"]}
          blend={0.5}
          amplitude={1.0}
          speed={0.7}
        />
        <div className="analysis-aurora-overlay" />
      </div>

      <header className="analysis-header">
        <div className="header-info">
          <h1>Taste Insights Engine</h1>
          <p>A statistical mirror of your catalog interactions and behavioral profile.</p>
        </div>
        <div className="personal-tags">
          {personal_tags.map(tag => (
            <span key={tag} className="tag-pill">{tag}</span>
          ))}
        </div>
      </header>

      {/* Summary Card */}
      <section className="summary-card glass-panel fade-in">
        <div className="summary-stat">
          <span className="label">Top Genre</span>
          <span className="value gradient-text">{summary.top_genre}</span>
        </div>
        <div className="summary-stat">
          <span className="label">Currently Exploring</span>
          <span className="value">{summary.exploring}</span>
        </div>
        <div className="summary-stat">
          <span className="label">Taste Profile</span>
          <span className="value">{summary.rating_style}</span>
        </div>
        <div className="summary-stat">
          <span className="label">Format Preference</span>
          <span className="value">{summary.media_preference}</span>
        </div>
        <div className="summary-stat">
          <span className="label">Discovery Type</span>
          <span className="value">{summary.discovery_type}</span>
        </div>
      </section>

      {/* Recommendation Explanation Panel */}
      <RecExplanationPanel expData={expData} />

      {/* Row 1: Genre Pie & Rating Histogram */}
      <div className="analysis-row">
        <section className="chart-card glass-panel fade-in">
          <h2>Genre Taste Breakdown</h2>
          <p className="card-subtitle">Aggregated interest based on watched catalog (70%) and clicked previews (30%).</p>
          <DonutChart data={genre_distribution} />
        </section>

        <section className="chart-card glass-panel fade-in">
          <h2>Rating Behavior</h2>
          <p className="card-subtitle">Breakdown of explicit preferences. Maps labels to standard numerical scores.</p>
          <RatingHistogram profile={rating_profile} />
        </section>
      </div>

      {/* Profile Editor Panel */}
      <ProfileEditor dateRangeData={dateRangeData} onSave={fetchData} />

      {/* Row 2: Taste Evolution & Click vs Watch Gap */}
      <div className="analysis-row">
        <section className="chart-card glass-panel fade-in">
          <h2>Taste Evolution</h2>
          <p className="card-subtitle">Compares watch genre percentage shifts in the last 30 days against prior history.</p>
          <TasteEvolutionLineChart data={evolution} />
        </section>

        <section className="chart-card glass-panel fade-in">
          <h2>Click vs Watch Gap</h2>
          <p className="card-subtitle">Difference between curious exploration (clicks) vs confirmed media consumption (watches).</p>
          <p className="insight-bubble">💡 {insight}</p>
          <ClickWatchGapChart comparison={comparison} />
        </section>
      </div>

      {/* Row 3: Content Split & Discovery Score */}
      <div className="analysis-row">
        <section className="chart-card glass-panel fade-in split-card">
          <h2>Content Type Behavior</h2>
          <p className="card-subtitle">Movie vs TV ratios, counts, and explicit preference ratings.</p>
          <div className="split-progress">
            <div className="split-bar">
              <div 
                className="split-fill movie-fill" 
                style={{ width: `${(content_behavior.movie.count / Math.max(1, content_behavior.movie.count + content_behavior.tv.count)) * 100}%` }}
              ></div>
              <div 
                className="split-fill tv-fill" 
                style={{ width: `${(content_behavior.tv.count / Math.max(1, content_behavior.movie.count + content_behavior.tv.count)) * 100}%` }}
              ></div>
            </div>
            <div className="split-labels">
              <span>Movies: {content_behavior.movie.count} ({content_behavior.movie.avg_rating > 0 ? `${content_behavior.movie.avg_rating.toFixed(1)} avg` : 'no rating'})</span>
              <span>TV Shows: {content_behavior.tv.count} ({content_behavior.tv.avg_rating > 0 ? `${content_behavior.tv.avg_rating.toFixed(1)} avg` : 'no rating'})</span>
            </div>
          </div>
        </section>

        <section className="chart-card glass-panel fade-in split-card">
          <h2>Discovery Depth & Popularity</h2>
          <p className="card-subtitle">Aggregates percentage of niche catalog selections, genre diversity, and click explore rates.</p>
          <div className="discovery-flex">
            <DiscoveryGauge score={discovery_depth_score} type={popularity_style} />
            <div className="discovery-info">
              <h3>Avg TMDB Popularity: {avg_popularity}</h3>
              <p>
                {popularity_style === 'Mainstream' && 'You lean heavily towards popular releases.'}
                {popularity_style === 'Mixed' && 'You watch a balanced mix of blockbusters and hidden gems.'}
                {popularity_style === 'Niche' && 'You seek out underground, less common, and indie content.'}
              </p>
            </div>
          </div>
        </section>
      </div>

      {/* Row 4: Rewatch Candidates Section */}
      {rewatch_candidates && rewatch_candidates.length > 0 && (
        <section className="chart-card glass-panel fade-in full-width-card">
          <h2>Rewatch Candidates</h2>
          <p className="card-subtitle">Highly rated items or items you revisited after your initial watch.</p>
          <div className="rewatch-scroll-row">
            {rewatch_candidates.map(item => (
              <a href={`/${item.media_type}s/${item.id}`} key={item.id} className="rewatch-card">
                {item.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w200${item.poster_path}`} alt={item.title} />
                ) : (
                  <div className="no-poster">🎬</div>
                )}
                <div className="overlay">
                  <span className="rewatch-title">{item.title}</span>
                  <span className="rewatch-why">{item.why}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Row 5: Early Favorites (All-Time Classics) */}
      {early_favorites && early_favorites.length > 0 && (
        <section className="chart-card glass-panel fade-in full-width-card" style={{ marginTop: '24px' }}>
          <h2>All-Time Classics</h2>
          <p className="card-subtitle">High-rated titles you watched long ago that you might want to revisit.</p>
          <div className="rewatch-scroll-row">
            {early_favorites.map(item => (
              <a href={`/${item.media_type}s/${item.id}`} key={item.id} className="rewatch-card">
                {item.poster_path ? (
                  <img src={`https://image.tmdb.org/t/p/w200${item.poster_path}`} alt={item.title} />
                ) : (
                  <div className="no-poster">🎬</div>
                )}
                <div className="overlay">
                  <span className="rewatch-title">{item.title}</span>
                  <span className="rewatch-why">{item.why}</span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* Row 5: Director Affinity & Binge Pattern */}
      <div className="analysis-row">
        <section className="chart-card glass-panel fade-in">
          <h2>Director Affinity</h2>
          <p className="card-subtitle">Which directors dominate your watch history.</p>
          <DirectorAffinity data={director_affinity} />
        </section>

        <section className="chart-card glass-panel fade-in">
          <h2>Binge Pattern Detector</h2>
          <p className="card-subtitle">Days with 3+ watches, streaks, and day-of-week frequency.</p>
          <BingePattern data={binge_pattern} />
        </section>
      </div>

      {/* Row 6: Taste Drift Timeline */}
      <section className="chart-card glass-panel fade-in full-width-card" style={{ marginTop: '24px' }}>
        <h2>Taste Drift Timeline</h2>
        <p className="card-subtitle">How your core genre preference shifted quarter by quarter.</p>
        <TasteDrift data={taste_drift} />
      </section>

      {/* Row 7: Hidden Gems & Feedback Loop */}
      <div className="analysis-row" style={{ marginTop: '24px' }}>
        <section className="chart-card glass-panel fade-in">
          <h2>Hidden Gems</h2>
          <p className="card-subtitle">Low popularity items you rated highly.</p>
          <HiddenGems data={hidden_gems} />
        </section>

        <section className="chart-card glass-panel fade-in">
          <h2>Feedback Loop</h2>
          <p className="card-subtitle">How well recommendations convert into actual watches.</p>
          <FeedbackLoop data={feedback_loop} />
        </section>
      </div>
    </div>
  )
}
