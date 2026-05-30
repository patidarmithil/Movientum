import { useEffect, useState } from 'react'
import { userService } from '../services/userService'
import './Analysis.css'

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

export default function Analysis() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const response = await userService.getAnalysis()
        setData(response.data)
      } catch (err) {
        setError('Failed to load analysis data.')
      } finally {
        setLoading(false)
      }
    }
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
    summary
  } = data

  return (
    <div className="analysis-page">
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
    </div>
  )
}
