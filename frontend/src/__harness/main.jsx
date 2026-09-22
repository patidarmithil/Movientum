// TEMP visual harness for /analysis — delete after use.
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../index.css'
import { userService } from '../services/userService'
import Analysis from '../pages/Analysis'
import PageTransition from '../components/PageTransition'

const G = ['Action','Adventure','Animation','Comedy','Crime','Documentary','Drama','Family','Fantasy','History','Horror','Music','Mystery','Romance','Science Fiction','TV Movie','Thriller','War','Western']
const genres = G.map((n, i) => ({ id: i + 1, name: n, weight: [80,55,-40,30,62,-10,90,5,44,12,-70,8,50,20,66,-25,72,15,-5][i] }))
const eras = ['1970s','1980s','1990s','2000s','2010s','2020s'].map((id, i) => ({ id, weight: [5,20,45,60,90,70][i] }))
const item = (i, t) => ({ id: 100 + i, media_type: i % 2 ? 'tv' : 'movie', title: t || `A Really Quite Long Movie Title Number ${i} Extended Edition`, poster_path: null })
const now = new Date().toISOString()
const heat = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h + d) % 5))

const analysis = {
  summary: { total_watched: 1284, total_rated: 932, top_genre: 'Drama' },
  personal_tags: ['Night owl', 'Binge watcher', 'Drama devotee', 'Hidden-gem hunter', 'Polyglot viewer'],
  discovery_depth_score: 73,
  time_pattern: { heatmap: heat },
  monthly_activity: Array.from({ length: 12 }, (_, i) => ({ month: `2025-${String(i + 1).padStart(2, '0')}`, count: (i * 7) % 30 + 3 })),
  binge_pattern: { max_streak: 21, binge_sessions: 48, longest_binge: 9 },
  taste_drift: { label: 'Shifting', drift_score: 0.42, quarters: [{ quarter: '2025-Q1', top_genre: 'Science Fiction' }, { quarter: '2025-Q2', top_genre: 'Drama' }, { quarter: '2025-Q3', top_genre: 'Thriller' }] },
  rating_profile: { liked_count: 520, neutral_count: 300, disliked_count: 112 },
  content_behavior: { movie: { count: 900 }, tv: { count: 384 } },
  comparison: Object.fromEntries(G.slice(0, 6).map((g, i) => [g, { watch: 0.1 + i * 0.05, click: 0.3 - i * 0.03, gap: 0.2 - i * 0.04 }])),
  insight: 'You open a lot of Science Fiction but mostly finish dramas and crime thrillers.',
  rewatch_candidates: Array.from({ length: 10 }, (_, i) => ({ ...item(i), why: 'Rated Perfection 2 years ago' })),
  early_favorites: Array.from({ length: 8 }, (_, i) => ({ ...item(i + 20), why: 'Critics 8.4' })),
  hidden_gems: { ratio: 0.18, gems: Array.from({ length: 12 }, (_, i) => ({ ...item(i + 40), user_rating: 'perfection' })) },
}
const engine = {
  taste: {
    genres, eras, total_interactions: 4821, last_updated: now,
    cast: Array.from({ length: 6 }, (_, i) => ({ id: i, name: `Actor With A Long Name ${i}`, weight: 60 - i * 8 })),
    directors: Array.from({ length: 5 }, (_, i) => ({ id: 50 + i, name: `Director Name ${i}`, weight: 50 - i * 8 })),
    keywords: ['time travel', 'dystopia', 'heist', 'coming of age', 'revenge', 'based on novel or book', 'small town'].map((n, i) => ({ id: i, name: n })),
    languages: [{ id: 'en', multiplier: 1.2 }, { id: 'ja', multiplier: 1.05 }, { id: 'hi', multiplier: 0.8 }, { id: 'ko', multiplier: 1 }],
    avoid: { genres: [{ id: 1, name: 'Horror' }, { id: 2, name: 'Animation' }], keywords: [{ id: 3, name: 'musical' }, { id: 4, name: 'reality tv competition' }] },
  },
  feed: {
    block_size: 20,
    pool_weights: { established: 0.4, diverse: 0.25, recent: 0.25, fresh: 0.1 },
    rescore_weights: { taste: 0.4, relevance: 0.3, quality: 0.2, novelty: 0.1 },
    quality_tiers: [{ min_rating: 7, min_votes: 500 }, { min_rating: 6, min_votes: 100 }],
    ranker: { approved: true, composite_weights: { graph: 0.5, quality: 0.3, taste: 0.2 }, model_blend_weight: 0.5, trained_at: now, users: 142, ndcg_blended: 0.4123, ndcg_composite: 0.3871 },
  },
  language: { dominant_language: 'en', dominant_fraction: 0.82, threshold: 0.7, active: true, slots: 3 },
  seeds: { recent: [item(1, 'Everything Everywhere All at Once')], established: [item(2), item(3)], diverse: [item(4)] },
  seeds_rotate_at: new Date(Date.now() + 600000).toISOString(),
  exclusions: { recent_watched_7d: 14, low_rated: 212, in_watchlist: 87, hidden: 9 },
}
const feedback = {
  totals: { watched: 120, watchlist: 44, thumbs_up: 63, thumbs_down: 12, click: 830 },
  timeline: Array.from({ length: 30 }, (_, i) => ({ date: new Date(Date.now() - (29 - i) * 864e5).toISOString(), watched: i % 4, watchlist: i % 3, thumbs_up: i % 2, thumbs_down: i % 5 === 0 ? 1 : 0, click: (i * 3) % 11 })),
  conversion: { liked: 63, watched: 21, rate: 0.33 },
  recent: Array.from({ length: 8 }, (_, i) => ({ ...item(i + 60), signal: ['watched', 'thumbs_up', 'click', 'watchlist'][i % 4], at: now, undoable: i % 2 === 0 })),
  hidden: Array.from({ length: 3 }, (_, i) => ({ ...item(i + 80), expires_at: now, restorable: true })),
}
const ok = (data) => Promise.resolve({ data })
Object.assign(userService, {
  getAnalysis: () => ok(analysis),
  getEngineSnapshot: () => ok(engine),
  getFeedbackSnapshot: () => ok(feedback),
  getDateRange: () => Promise.resolve({ watch_history_min: '2019-01-01', watch_history_max: now, saved_from: null, saved_to: null, content_type_pref: 'balanced', language_diversity_threshold: 0.7 }),
  getTasteProfile: () => Promise.resolve({ data: genres, era_data: eras }),
})

createRoot(document.getElementById('root')).render(<MemoryRouter><main className="page-content"><PageTransition><Analysis /></PageTransition></main></MemoryRouter>)
