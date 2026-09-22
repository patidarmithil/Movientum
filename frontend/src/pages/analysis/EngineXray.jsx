import { Link } from 'react-router-dom'
import { POOL_META, detailPath, languageName, pct, posterUrl, relativeTime } from './analysisUtils'

const SEED_BUCKETS = [
  ['recent', 'Current mood'],
  ['established', 'Established taste'],
  ['diverse', 'Older interest'],
]

const POOL_ORDER = ['established', 'diverse', 'recent', 'fresh']
const POOL_COLORS = {
  established: 'var(--rating-perfection)',
  diverse: '#7AA7FF',
  recent: 'var(--rating-goforit)',
  fresh: 'rgba(255,255,255,.35)',
}

const RESCORE_LABELS = {
  taste: 'Match with your taste',
  relevance: 'Closeness to your seeds',
  quality: 'Rating, weighted by vote count',
  novelty: 'Less-known titles',
}

function WeightBar({ parts }) {
  return (
    <div className="an-stackbar" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value, 1)}`).join(', ')}>
      {parts.map((p) => (
        <span key={p.key} style={{ flexGrow: p.value, background: p.color }} title={`${p.label}: ${pct(p.value, 1)}`} />
      ))}
    </div>
  )
}

function SeedTile({ item, label }) {
  const src = posterUrl(item.poster_path, 'w154')
  return (
    <Link to={detailPath(item)} className="an-seed">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="an-seed__blank" />}
      <span className="an-seed__meta">
        <span className="an-seed__label">{label}</span>
        <span className="an-seed__title">{item.title || 'Untitled'}</span>
      </span>
    </Link>
  )
}

export default function EngineXray({ engine }) {
  const { feed, language, seeds, seeds_rotate_at: rotatesAt, exclusions } = engine
  const ranker = feed.ranker
  const cw = ranker.composite_weights

  const seedList = SEED_BUCKETS.flatMap(([key, label]) => (seeds?.[key] || []).map((s) => ({ ...s, label })))
  const rescore = Object.entries(feed.rescore_weights).sort((a, b) => b[1] - a[1])

  return (
    <div className="an-xray">
      <ol className="an-pipeline">
        {/* 1. Seeds */}
        <li className="an-stage">
          <div className="an-stage__head">
            <span className="an-stage__num">1</span>
            <h3>Starting points</h3>
          </div>
          <p className="an-stage__text">
            Your feed walks the catalogue graph outward from a few titles in your history. They rotate every 15 minutes
            {rotatesAt ? ` (next ${relativeTime(rotatesAt)})` : ''}.
          </p>
          {seedList.length > 0 ? (
            <div className="an-seeds">
              {seedList.map((s) => <SeedTile key={`${s.media_type}-${s.id}-${s.label}`} item={s} label={s.label} />)}
            </div>
          ) : (
            <p className="an-muted">No history yet, so your feed starts from popular titles.</p>
          )}
        </li>

        {/* 2. Pools */}
        <li className="an-stage">
          <div className="an-stage__head">
            <span className="an-stage__num">2</span>
            <h3>Four candidate pools</h3>
          </div>
          <p className="an-stage__text">Every {feed.block_size} titles in your feed are drawn from these pools in fixed shares.</p>
          <WeightBar
            parts={POOL_ORDER.map((k) => ({ key: k, value: feed.pool_weights[k], color: POOL_COLORS[k], label: POOL_META[k].label }))}
          />
          <ul className="an-legend-list">
            {POOL_ORDER.map((k) => (
              <li key={k}>
                <span className="an-dot" style={{ background: POOL_COLORS[k] }} />
                <span className="an-legend-list__name">{POOL_META[k].label}</span>
                <span className="an-legend-list__hint">{POOL_META[k].hint}</span>
                <span className="an-num">{pct(feed.pool_weights[k], 1)}</span>
              </li>
            ))}
          </ul>
        </li>

        {/* 3. Ranking inside each pool */}
        <li className="an-stage">
          <div className="an-stage__head">
            <span className="an-stage__num">3</span>
            <h3>Ranking each pool</h3>
          </div>
          {ranker.approved ? (
            <p className="an-stage__text">
              A trained ranking model (XGBoost) is live. Its order is blended {pct(ranker.model_blend_weight)} with the
              formula below. Trained {relativeTime(ranker.trained_at)} on {ranker.users} people; it scored
              {' '}{ranker.ndcg_blended?.toFixed(3)} against the formula&apos;s {ranker.ndcg_composite?.toFixed(3)} (NDCG@10).
            </p>
          ) : (
            <p className="an-stage__text">
              The ranking model has not passed its quality check yet, so pools are ranked by this formula alone.
              It retrains every night and takes over half the ranking once it beats the formula.
            </p>
          )}
          <div className="an-formula">
            <span><b className="an-num">{pct(cw.graph)}</b> graph closeness</span>
            <span><b className="an-num">{pct(cw.quality)}</b> quality</span>
            <span><b className="an-num">{pct(cw.taste)}</b> your taste</span>
          </div>
          <div className="an-chips">
            {feed.quality_tiers.map((t, i) => (
              <span key={i} className="an-chip">
                {i === 0 ? 'Prefers' : 'Then'} ★ {t.min_rating}+ with {t.min_votes}+ votes
              </span>
            ))}
            <span className="an-chip an-chip--quiet">Then anything, so the feed never runs empty</span>
          </div>
        </li>

        {/* 4. Re-score */}
        <li className="an-stage">
          <div className="an-stage__head">
            <span className="an-stage__num">4</span>
            <h3>Final order</h3>
          </div>
          <p className="an-stage__text">The merged feed is re-scored, then spread out so one genre or language never runs in a long streak.</p>
          <ul className="an-bars">
            {rescore.map(([k, v]) => (
              <li key={k}>
                <span className="an-bars__label">{RESCORE_LABELS[k] || k}</span>
                <span className="an-bars__track"><span style={{ width: pct(v / rescore[0][1]) }} /></span>
                <span className="an-num">{pct(v)}</span>
              </li>
            ))}
          </ul>
        </li>

        {/* 5. Language diversity */}
        <li className="an-stage">
          <div className="an-stage__head">
            <span className="an-stage__num">5</span>
            <h3>Language mix</h3>
          </div>
          <div className="an-meter" role="img" aria-label={`${languageName(language.dominant_language)} is ${pct(language.dominant_fraction)} of your watching; threshold ${pct(language.threshold)}`}>
            <span className="an-meter__fill" style={{ width: pct(language.dominant_fraction) }} />
            <span className="an-meter__mark" style={{ left: pct(language.threshold) }} />
          </div>
          <p className="an-stage__text">
            {language.dominant_fraction > 0 ? (
              <>
                {languageName(language.dominant_language)} is {pct(language.dominant_fraction)} of what you watch. Your
                limit is {pct(language.threshold)}.{' '}
                {language.active
                  ? `So at least ${language.slots} of every ${feed.block_size} picks come from other languages.`
                  : 'You are under it, so your feed is left as it is.'}
              </>
            ) : 'Watch a few titles and this shows how your feed balances languages.'}
          </p>
        </li>
      </ol>

      <div className="an-exclusions">
        <h3 className="an-subhead">Kept out of your feed</h3>
        <ul>
          <li><b className="an-num">{exclusions.recent_watched_7d}</b> watched in the last 7 days</li>
          <li><b className="an-num">{exclusions.low_rated}</b> you rated Skip or Timepass</li>
          <li><b className="an-num">{exclusions.in_watchlist}</b> already in your watchlist</li>
          <li><b className="an-num">{exclusions.hidden}</b> you hid with a thumbs-down</li>
        </ul>
      </div>
    </div>
  )
}
