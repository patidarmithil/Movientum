import { useEffect, useMemo, useState } from 'react'
import { userService } from '../../services/userService'
import { languageName, pct } from './analysisUtils'

// Weights are uncapped. The slider starts at ±100 (or the server's stored range)
// and, when released near either end or given a big number, widens to 1.5× that
// weight — so dragging to the end and letting go opens more room. Widening only
// on release keeps the thumb from jumping under the pointer mid-drag.
const DEFAULT_BOUND = 100
const DEFAULT_THRESHOLD = 0.7
const DEFAULT_REWATCH = 0.1
const MAX_REWATCH = 0.3
const MAX_LANGS = 6
// Offered in "Add language" after the user's own history languages.
const COMMON_LANGS = ['en', 'hi', 'ko', 'ja', 'ta', 'te', 'ml', 'es', 'fr', 'zh', 'de', 'it', 'pt', 'th', 'tr']
// One colour per row in the mix bar, in row order.
const MIX_COLORS = ['#9B59FF', '#00E5A0', '#FFC300', '#4DA3FF', '#FF4D6D', '#FF9F43']

/** Top history languages as whole percentages (steps of 5) summing to 100. */
function suggestMix(historyLangs) {
  const top = (historyLangs || []).slice(0, 3)
  if (!top.length) return [{ code: 'en', pct: 100 }]
  const total = top.reduce((a, l) => a + l.share, 0) || 1
  const rows = top.map((l) => ({ code: l.code, pct: Math.max(5, Math.round((l.share / total) * 20) * 5) }))
  const diff = 100 - rows.reduce((a, r) => a + r.pct, 0)
  rows[0].pct = Math.max(5, rows[0].pct + diff)
  return rows
}

const roomFor = (weight) => Math.ceil((Math.abs(weight) * 1.5) / 50) * 50

const PRESETS = [
  ['Last 3 months', 3],
  ['Last 6 months', 6],
  ['Last year', 12],
  ['Last 2 years', 24],
  ['All time', null],
]

const toDateInput = (iso) => (iso ? iso.split('T')[0] : '')

function WeightSlider({ label, value, bound, onChange, onWiden }) {
  const id = `w-${label.replace(/\W+/g, '-')}`
  const [draft, setDraft] = useState(null)
  const shown = Math.round(value)
  const pos = Math.max(-bound, Math.min(bound, value))
  const commit = () => {
    if (draft === null) return
    const n = Number(draft)
    if (draft.trim() !== '' && Number.isFinite(n)) {
      onChange(n)
      if (Math.abs(n) >= bound * 0.95) onWiden(n)
    }
    setDraft(null)
  }
  const release = () => { if (Math.abs(value) >= bound * 0.95) onWiden(value) }
  return (
    <div className="an-slider">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="range"
        min={-bound}
        max={bound}
        step="1"
        value={pos}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={release}
        onKeyUp={release}
        style={{ '--p': `${((pos + bound) / (2 * bound)) * 100}%` }}
      />
      <input
        type="number"
        step="1"
        className="an-num an-slider__num"
        aria-label={`${label} weight`}
        value={draft ?? String(shown)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      />
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
  const [langMode, setLangMode] = useState('auto')
  const [langRows, setLangRows] = useState([])
  const [historyLangs, setHistoryLangs] = useState([])
  const [rewatch, setRewatch] = useState(DEFAULT_REWATCH)
  const [watchedCount, setWatchedCount] = useState(0)
  const [rewatchMin, setRewatchMin] = useState(300)
  const [genres, setGenres] = useState([])
  const [eras, setEras] = useState([])
  const [weightBounds, setWeightBounds] = useState({ genres: DEFAULT_BOUND, eras: DEFAULT_BOUND })
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
        setHistoryLangs(range.history_languages || [])
        setRewatch(range.rewatch_share ?? DEFAULT_REWATCH)
        setWatchedCount(range.total_items_in_range || 0)
        setRewatchMin(range.rewatch_min_watched || 300)
        const shares = range.language_shares
        if (shares && Object.keys(shares).length) {
          setLangMode('custom')
          setLangRows(
            Object.entries(shares)
              .sort((a, b) => b[1] - a[1])
              .map(([code, v]) => ({ code, pct: Math.round(v * 100) })),
          )
        }
      }
      setGenres(taste?.data || [])
      setWeightBounds({
        genres: taste?.genre_bound || DEFAULT_BOUND,
        eras: taste?.era_bound || DEFAULT_BOUND,
      })
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
  const widen = (kind, weight) =>
    setWeightBounds((b) => ({ ...b, [kind]: Math.max(b[kind], roomFor(weight)) }))

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

  const langTotal = langRows.reduce((a, r) => a + r.pct, 0)
  const addOptions = useMemo(() => {
    const used = new Set(langRows.map((r) => r.code))
    const codes = [...historyLangs.map((l) => l.code), ...COMMON_LANGS]
    return [...new Set(codes)].filter((c) => !used.has(c))
  }, [langRows, historyLangs])

  const chooseLangMode = (mode) => {
    setMessage(null)
    setLangMode(mode)
    if (mode === 'custom' && langRows.length === 0) setLangRows(suggestMix(historyLangs))
  }
  const setRowPct = (code, value) => {
    setMessage(null)
    setLangRows((rows) => rows.map((r) => (r.code === code ? { ...r, pct: value } : r)))
  }
  const removeRow = (code) => {
    setMessage(null)
    setLangRows((rows) => rows.filter((r) => r.code !== code))
  }
  const addRow = (code) => {
    if (!code) return
    setMessage(null)
    setLangRows((rows) => (rows.length >= MAX_LANGS ? rows : [...rows, { code, pct: 10 }]))
  }
  // Scale to exactly 100 keeping proportions; rounding slack goes to the largest row.
  const balance = () => {
    if (!langTotal) return
    setLangRows((rows) => {
      const next = rows.map((r) => ({ ...r, pct: Math.round((r.pct / langTotal) * 100) }))
      const diff = 100 - next.reduce((a, r) => a + r.pct, 0)
      const big = next.reduce((bi, r, i) => (r.pct > next[bi].pct ? i : bi), 0)
      next[big].pct += diff
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      await userService.saveDateRange(
        dateFrom ? new Date(dateFrom).toISOString() : null,
        dateTo ? new Date(dateTo).toISOString() : null,
      )
      const customRows = langRows.filter((r) => r.pct > 0)
      const useCustom = langMode === 'custom' && customRows.length > 0
      await userService.saveRecPreferences({
        content_type_pref: contentType,
        language_diversity_threshold: threshold,
        rewatch_share: rewatch,
        ...(useCustom
          ? { language_shares: Object.fromEntries(customRows.map((r) => [r.code, r.pct])) }
          : { language_shares_auto: true }),
      })
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
    setLangMode('auto')
    setRewatch(DEFAULT_REWATCH)
    setMessage({ ok: true, text: 'Filters, language settings and rewatch picks reset. Press Save to keep this.' })
  }

  if (!loaded) return <div className="skeleton an-skel-block" style={{ height: 420 }} />

  const dominant = language?.dominant_fraction || 0
  const willMix = dominant > threshold
  const custom = langMode === 'custom'
  const perTwenty = Math.round(rewatch * 20)
  const similarActive = watchedCount >= rewatchMin

  return (
    <div className="an-tune">
      <div className="an-tune__grid">
        <article className={`an-panel${custom ? ' is-overridden' : ''}`}>
          <h3 className="an-subhead">Language limit</h3>
          <p className="an-affects">
            {custom ? 'Not used while Language mix is set to Custom' : 'Changes: your For You feed'}
          </p>
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

      <div className="an-tune__grid an-tune__grid--two">
        <article className="an-panel an-langmix">
          <div className="an-langmix__head">
            <div>
              <h3 className="an-subhead">Language mix</h3>
              <p className="an-affects">Changes: For You and More like this</p>
            </div>
            <div className="an-seg" role="radiogroup" aria-label="Language mix mode">
              {[['auto', 'Auto'], ['custom', 'Custom']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={langMode === v}
                  className={langMode === v ? 'is-on' : ''}
                  onClick={() => chooseLangMode(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {!custom && (
            <>
              <p className="an-muted">
                The engine follows what you watch and only mixes in other languages past your language limit.
                Switch to Custom to set the share of each language yourself.
              </p>
              {historyLangs.length > 0 && (
                <div className="an-chips">
                  {historyLangs.slice(0, 5).map((l) => (
                    <span key={l.code} className="an-chip an-chip--quiet">
                      {languageName(l.code)} {pct(l.share)}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {custom && (
            <>
              <div className="an-langmix__bar" aria-hidden="true">
                {langRows.map((r, i) => (
                  <span
                    key={r.code}
                    style={{ flexGrow: r.pct || 0.0001, background: MIX_COLORS[i % MIX_COLORS.length] }}
                  />
                ))}
              </div>
              <ul className="an-langmix__rows">
                {langRows.map((r, i) => (
                  <li key={r.code} className="an-langmix__row">
                    <span className="an-langmix__dot" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                    <label htmlFor={`lm-${r.code}`} className="an-langmix__name">{languageName(r.code)}</label>
                    <input
                      id={`lm-${r.code}`}
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={r.pct}
                      onChange={(e) => setRowPct(r.code, Number(e.target.value))}
                      style={{ '--p': `${r.pct}%` }}
                    />
                    <span className="an-num an-langmix__pct">
                      {langTotal ? Math.round((r.pct / langTotal) * 100) : 0}%
                    </span>
                    <button
                      type="button"
                      className="an-langmix__remove"
                      aria-label={`Remove ${languageName(r.code)}`}
                      onClick={() => removeRow(r.code)}
                      disabled={langRows.length <= 1}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="an-langmix__foot">
                {langRows.length < MAX_LANGS && addOptions.length > 0 && (
                  <select
                    className="an-langmix__add"
                    value=""
                    onChange={(e) => addRow(e.target.value)}
                    aria-label="Add a language"
                  >
                    <option value="">+ Add language</option>
                    {addOptions.map((c) => (
                      <option key={c} value={c}>{languageName(c)}</option>
                    ))}
                  </select>
                )}
                {langTotal !== 100 && langTotal > 0 && (
                  <button type="button" className="an-btn an-btn--sm" onClick={balance}>Make it 100%</button>
                )}
              </div>
              <p className="an-muted">
                Percentages show each language&apos;s final share. Languages not listed only fill in when a listed one runs short of good picks.
              </p>
            </>
          )}
        </article>

        <article className="an-panel">
          <h3 className="an-subhead">Rewatch picks</h3>
          <p className="an-affects">Changes: For You and More like this</p>
          <div className="an-slider an-slider--wide">
            <label htmlFor="an-rewatch">
              Up to <b className="an-num">{perTwenty}</b> of every 20 picks can be titles you&apos;ve already watched
            </label>
            <input
              id="an-rewatch"
              type="range"
              min="0"
              max={MAX_REWATCH}
              step="0.05"
              value={rewatch}
              onChange={(e) => { setMessage(null); setRewatch(Number(e.target.value)) }}
              style={{ '--p': `${(rewatch / MAX_REWATCH) * 100}%` }}
            />
          </div>
          <p className="an-muted">
            {similarActive
              ? `More like this can bring back great titles you've seen (you've watched ${watchedCount}).`
              : `More like this starts doing this at ${rewatchMin} watched titles (you're at ${watchedCount}). For You uses it now.`}
          </p>
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
              <WeightSlider key={g.id} label={g.name} value={g.weight} bound={weightBounds.genres} onChange={(v) => updateGenre(g.id, v)} onWiden={(v) => widen('genres', v)} />
            ))}
          </div>
          <div>
            <h4 className="an-minor">Decades</h4>
            {eras.map((e) => (
              <WeightSlider key={e.id} label={e.name} value={e.weight} bound={weightBounds.eras} onChange={(v) => updateEra(e.id, v)} onWiden={(v) => widen('eras', v)} />
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
