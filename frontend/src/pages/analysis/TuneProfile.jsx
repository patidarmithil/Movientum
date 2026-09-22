import { useEffect, useMemo, useState } from 'react'
import { userService } from '../../services/userService'
import { languageName, pct } from './analysisUtils'

const WEIGHT_MIN = -100
const WEIGHT_MAX = 100
const DEFAULT_THRESHOLD = 0.7

const PRESETS = [
  ['Last 3 months', 3],
  ['Last 6 months', 6],
  ['Last year', 12],
  ['Last 2 years', 24],
  ['All time', null],
]

const toDateInput = (iso) => (iso ? iso.split('T')[0] : '')

function WeightSlider({ label, value, onChange }) {
  const id = `w-${label.replace(/\W+/g, '-')}`
  return (
    <div className="an-slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={WEIGHT_MIN}
        max={WEIGHT_MAX}
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ '--p': `${((value - WEIGHT_MIN) / (WEIGHT_MAX - WEIGHT_MIN)) * 100}%` }}
      />
      <output htmlFor={id} className="an-num">{value > 0 ? '+' : ''}{Math.round(value)}</output>
    </div>
  )
}

export default function TuneProfile({ language, onSaved }) {
  const [loaded, setLoaded] = useState(false)
  const [bounds, setBounds] = useState({})
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [contentType, setContentType] = useState('balanced')
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD)
  const [genres, setGenres] = useState([])
  const [eras, setEras] = useState([])
  const [dirty, setDirty] = useState({ genres: false, eras: false })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      userService.getDateRange().catch(() => null),
      userService.getTasteProfile().catch(() => ({ data: [], era_data: [] })),
    ]).then(([range, taste]) => {
      if (!alive) return
      if (range) {
        setBounds({ min: toDateInput(range.watch_history_min), max: toDateInput(range.watch_history_max) })
        setDateFrom(toDateInput(range.saved_from))
        setDateTo(toDateInput(range.saved_to))
        setContentType(range.content_type_pref || 'balanced')
        setThreshold(range.language_diversity_threshold ?? DEFAULT_THRESHOLD)
      }
      setGenres(taste?.data || [])
      // Decade buckets must match backend bin_release_era ("YYYYs") so a slider
      // maps onto content's release_era field.
      const existing = Object.fromEntries((taste?.era_data || []).map((e) => [e.id, e.weight]))
      const current = Math.floor(new Date().getFullYear() / 10) * 10
      const decades = []
      for (let y = 1950; y <= current; y += 10) decades.push(`${y}s`)
      setEras(decades.map((id) => ({ id, name: id, weight: existing[id] ?? 0 })))
      setLoaded(true)
    })
    return () => { alive = false }
  }, [])

  const sortedGenres = useMemo(() => [...genres].sort((a, b) => a.name.localeCompare(b.name)), [genres])

  const setPreset = (months) => {
    setMessage(null)
    if (!months) { setDateFrom(''); setDateTo(''); return }
    const d = new Date()
    d.setMonth(d.getMonth() - months)
    setDateFrom(d.toISOString().split('T')[0])
    setDateTo('')
  }

  const updateGenre = (id, weight) => {
    setMessage(null)
    setGenres((gs) => gs.map((g) => (g.id === id ? { ...g, weight } : g)))
    setDirty((d) => ({ ...d, genres: true }))
  }
  const updateEra = (id, weight) => {
    setMessage(null)
    setEras((es) => es.map((e) => (e.id === id ? { ...e, weight } : e)))
    setDirty((d) => ({ ...d, eras: true }))
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await userService.saveDateRange(
        dateFrom ? new Date(dateFrom).toISOString() : null,
        dateTo ? new Date(dateTo).toISOString() : null,
      )
      await userService.saveRecPreferences({ content_type_pref: contentType, language_diversity_threshold: threshold })
      if (dirty.genres || dirty.eras) {
        await userService.saveTasteProfile(
          dirty.genres ? Object.fromEntries(genres.map((g) => [g.id, g.weight])) : undefined,
          dirty.eras ? Object.fromEntries(eras.map((e) => [e.id, e.weight])) : undefined,
        )
        setDirty({ genres: false, eras: false })
      }
      setMessage({ ok: true, text: 'Saved. Your feed uses these settings from your next visit to it.' })
      onSaved?.()
    } catch {
      setMessage({ ok: false, text: 'Could not save. Check your connection and press Save again.' })
    } finally {
      setSaving(false)
    }
  }

  const resetPrefs = () => {
    setDateFrom('')
    setDateTo('')
    setContentType('balanced')
    setThreshold(DEFAULT_THRESHOLD)
    setMessage({ ok: true, text: 'Filters and language limit reset. Press Save to keep this.' })
  }

  if (!loaded) return <div className="skeleton an-skel-block" style={{ height: 420 }} />

  const dominant = language?.dominant_fraction || 0
  const willMix = dominant > threshold

  return (
    <div className="an-tune">
      <div className="an-tune__grid">
        <article className="an-panel">
          <h3 className="an-subhead">Language limit</h3>
          <p className="an-affects">Changes: your For You feed</p>
          <div className="an-slider an-slider--wide">
            <label htmlFor="an-threshold">
              Mix in other languages once one language passes <b className="an-num">{pct(threshold)}</b> of what you watch
            </label>
            <div className="an-threshold">
              <input
                id="an-threshold"
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={threshold}
                onChange={(e) => { setMessage(null); setThreshold(Number(e.target.value)) }}
                style={{ '--p': `${((threshold - 0.5) / 0.45) * 100}%` }}
              />
              {dominant >= 0.5 && (
                <span
                  className="an-threshold__you"
                  style={{ left: `${Math.min(100, ((dominant - 0.5) / 0.45) * 100)}%` }}
                  title={`You: ${pct(dominant)}`}
                />
              )}
            </div>
          </div>
          {dominant > 0 && (
            <p className="an-muted">
              {languageName(language.dominant_language)} is {pct(dominant)} of your watching, so this{' '}
              {willMix ? 'will mix in other languages.' : 'leaves your feed unchanged.'}
            </p>
          )}
        </article>

        <article className="an-panel">
          <h3 className="an-subhead">Movies or series</h3>
          <p className="an-affects">Changes: AI picks only</p>
          <div className="an-seg an-seg--full" role="radiogroup" aria-label="Content type">
            {[['balanced', 'Both'], ['movie', 'Mostly movies'], ['tv', 'Mostly series']].map(([v, label]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={contentType === v}
                className={contentType === v ? 'is-on' : ''}
                onClick={() => { setMessage(null); setContentType(v) }}
              >
                {label}
              </button>
            ))}
          </div>
        </article>

        <article className="an-panel">
          <h3 className="an-subhead">History window</h3>
          <p className="an-affects">Changes: the fallback picks used when your personal pools run short</p>
          <div className="an-dates">
            <label>From
              <input type="date" value={dateFrom} min={bounds.min} max={bounds.max} onChange={(e) => { setMessage(null); setDateFrom(e.target.value) }} />
            </label>
            <label>To
              <input type="date" value={dateTo} min={bounds.min} max={bounds.max} onChange={(e) => { setMessage(null); setDateTo(e.target.value) }} />
            </label>
          </div>
          <div className="an-chips">
            {PRESETS.map(([label, months]) => (
              <button key={label} type="button" className="an-chip an-chip--btn" onClick={() => setPreset(months)}>{label}</button>
            ))}
          </div>
        </article>
      </div>

      <details className="an-panel an-tune__weights">
        <summary>
          <span className="an-subhead">Adjust genre and decade weights</span>
          <span className="an-affects">Changes: your For You feed. Your next watch or thumbs keeps nudging these.</span>
        </summary>
        <div className="an-tune__weights-grid">
          <div>
            <h4 className="an-minor">Genres</h4>
            {sortedGenres.length === 0 && <p className="an-muted">No genre weights yet.</p>}
            {sortedGenres.map((g) => (
              <WeightSlider key={g.id} label={g.name} value={g.weight} onChange={(v) => updateGenre(g.id, v)} />
            ))}
          </div>
          <div>
            <h4 className="an-minor">Decades</h4>
            {eras.map((e) => (
              <WeightSlider key={e.id} label={e.name} value={e.weight} onChange={(v) => updateEra(e.id, v)} />
            ))}
          </div>
        </div>
      </details>

      <div className="an-tune__actions">
        <button type="button" className="an-btn an-btn--solid" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        <button type="button" className="an-btn" onClick={resetPrefs} disabled={saving}>Reset filters</button>
        {message && (
          <p className={`an-toast ${message.ok ? '' : 'is-error'}`} role="status">{message.text}</p>
        )}
      </div>
    </div>
  )
}
