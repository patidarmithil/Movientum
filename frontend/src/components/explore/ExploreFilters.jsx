/**
 * Explore filter controls, shared by the desktop rail and the mobile bottom sheet.
 *
 * `value` is the whole filter object (see DEFAULT_FILTERS); every control calls
 * `onChange(next)` with a new object. The results page owns turning that into URL
 * params, so the rail and the sheet stay dumb.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LuCheck, LuChevronDown, LuSearch, LuSlidersHorizontal, LuX } from 'react-icons/lu'
import {
  CATEGORIES, CINEMAS, COMPANIES, COUNTRIES, CURRENT_YEAR, DECADES, DURATIONS, FAMILY, GENRES,
  LANGUAGES, SORTS, flagUrl,
} from '../../utils/exploreTaxonomy'
import { OTT } from '../../utils/ott'
import { DEFAULT_FILTERS, MIN_YEAR } from '../../utils/exploreFilters'
import './ExploreFilters.css'

const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

// ── Select: listbox with optional search and multi-select ────────────────────
export function Select({ id, label, placeholder, value, options, onChange, multiple = false, searchable = false, renderIcon }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef(null)
  const searchRef = useRef(null)
  const listRef = useRef(null)

  const selected = multiple ? value : (value ? [value] : [])
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter((o) => o.label.toLowerCase().includes(t)) : options
  }, [options, q])

  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    ;(searchable ? searchRef.current : listRef.current)?.focus()
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open, searchable])

  const choose = (opt) => {
    if (multiple) {
      onChange(toggleIn(value, opt.value))
    } else {
      onChange(opt.value === value ? '' : opt.value)
      setOpen(false)
    }
  }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
    else if (e.key === 'Tab') setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const labelFor = (v) => options.find((o) => o.value === v)?.label ?? v
  const triggerText = selected.length === 0
    ? placeholder
    : selected.length === 1 ? labelFor(selected[0]) : `${labelFor(selected[0])} +${selected.length - 1}`

  return (
    <div className={`xsel${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        id={id}
        className={`xsel__trigger${selected.length ? ' has-value' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true) } }}
      >
        <span className="xsel__text">{triggerText}</span>
        <LuChevronDown aria-hidden className="xsel__caret" />
      </button>
      {open && (
        <div className="xsel__menu">
          {searchable && (
            <label className="xsel__search">
              <LuSearch aria-hidden />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => { setQ(e.target.value); setActive(0) }}
                onKeyDown={onKey}
                placeholder={`Search ${label.toLowerCase()}`}
                aria-label={`Search ${label.toLowerCase()}`}
              />
            </label>
          )}
          <ul
            className="xsel__list"
            role="listbox"
            aria-label={label}
            aria-multiselectable={multiple || undefined}
            tabIndex={searchable ? -1 : 0}
            ref={listRef}
            onKeyDown={searchable ? undefined : onKey}
          >
            {shown.length === 0 && <li className="xsel__none">No match</li>}
            {shown.map((opt, i) => {
              const on = selected.includes(opt.value)
              return (
                <li
                  key={opt.value}
                  data-i={i}
                  role="option"
                  aria-selected={on}
                  className={`xsel__opt${i === active ? ' is-active' : ''}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(opt)}
                >
                  {renderIcon?.(opt)}
                  <span>{opt.label}</span>
                  {on && <LuCheck aria-hidden className="xsel__check" />}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

// ── Min-rating slider: commits on release so a drag is one request. Keyed on the
//    committed value by the parent, so an outside change (Clear) remounts it. ─────
function RatingSlider({ value, onCommit }) {
  const [v, setV] = useState(value)
  const commit = () => { if (v !== value) onCommit(v) }
  return (
    <div className="xrange">
      <div className="xrange__head">
        <span>Any</span>
        <strong>{v > 0 ? `★ ${v}+` : 'No minimum'}</strong>
      </div>
      <input
        type="range"
        min="0"
        max="9"
        step="0.5"
        value={v}
        aria-label="Minimum rating"
        style={{ '--pct': `${(v / 9) * 100}%` }}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  )
}

// ── Year inputs: commit on blur / Enter ─────────────────────────────────────
function YearInput({ label, value, onCommit, min, max }) {
  const [v, setV] = useState(String(value))
  const commit = () => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n)) { setV(String(value)); return }
    const clamped = Math.min(max, Math.max(min, n))
    setV(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }
  return (
    <label className="xyear">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
      />
    </label>
  )
}

function Pills({ options, value, onChange, label }) {
  return (
    <div className="xpills" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value === o.value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            className={`xpill${on ? ' is-on' : ''}`}
            onClick={() => onChange(on ? '' : o.value)}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const CATEGORY_OPTS = CATEGORIES.map((c) => ({ value: c.slug, label: c.label }))
const LANGUAGE_OPTS = LANGUAGES.map((l) => ({ value: l.slug, label: l.label }))
const COUNTRY_OPTS = COUNTRIES.map((c) => ({ value: c.code, label: c.label }))
const COMPANY_OPTS = COMPANIES.map((c) => ({ value: c.id, label: c.label }))
const FAMILY_OPTS = FAMILY.map((f) => ({ value: f.slug, label: f.label }))
const TYPE_OPTS = [{ value: 'movie', label: 'Movies' }, { value: 'tv', label: 'Shows' }]
const ANIME_OPTS = [{ value: 'hide', label: 'Hide Anime' }, { value: 'only', label: 'Only Anime' }]

// ── The panel ────────────────────────────────────────────────────────────────
export function FilterPanel({ value, onChange, idPrefix }) {
  const set = (patch) => onChange({ ...value, ...patch })
  const decade = DECADES.find((d) => d.from === value.yearFrom && d.to === value.yearTo)?.value ?? ''

  return (
    <div className="xfp">
      <section className="xfp__group">
        <h3 className="xfp__title">Sort by</h3>
        <Select
          id={`${idPrefix}-sort`}
          label="Sort by"
          value={value.sort}
          options={SORTS}
          onChange={(v) => set({ sort: v || 'popularity' })}
        />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Special collections</h3>
        <div className="xchips">
          <button
            type="button"
            aria-pressed={value.award}
            className={`xchip xchip--sky${value.award ? ' is-on' : ''}`}
            onClick={() => set({ award: !value.award })}
          >
            <span className="xchip__box" aria-hidden /> Award Winner
          </button>
          <button
            type="button"
            aria-pressed={!!value.family}
            className={`xchip xchip--mint${value.family ? ' is-on' : ''}`}
            onClick={() => set({ family: value.family ? '' : 'under10' })}
          >
            <span className="xchip__box" aria-hidden /> Family Friendly
          </button>
        </div>
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Content type</h3>
        <Pills label="Content type" options={TYPE_OPTS} value={value.type} onChange={(v) => set({ type: v })} />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Anime</h3>
        <Pills label="Anime" options={ANIME_OPTS} value={value.anime} onChange={(v) => set({ anime: v })} />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Genre</h3>
        <div className="xpills" role="group" aria-label="Genre">
          {GENRES.map((g) => {
            const on = value.genres.includes(g.slug)
            return (
              <button
                key={g.slug}
                type="button"
                aria-pressed={on}
                className={`xpill xpill--dot${on ? ' is-on' : ''}`}
                style={{ '--dot': g.dot }}
                onClick={() => set({ genres: toggleIn(value.genres, g.slug) })}
              >
                <span className="xpill__dot" aria-hidden /> {g.label}
              </button>
            )
          })}
        </div>
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Category</h3>
        <Select
          id={`${idPrefix}-category`}
          label="Category"
          placeholder="Select category…"
          searchable
          value={value.category}
          options={CATEGORY_OPTS}
          onChange={(v) => set({ category: v })}
        />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Language</h3>
        <Select
          id={`${idPrefix}-language`}
          label="Language"
          placeholder="Select language…"
          searchable
          value={value.language}
          options={LANGUAGE_OPTS}
          onChange={(v) => set({ language: v })}
        />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Country</h3>
        <Select
          id={`${idPrefix}-country`}
          label="Country"
          placeholder="Select country…"
          searchable
          multiple
          value={value.countries}
          options={COUNTRY_OPTS}
          onChange={(v) => set({ countries: v })}
          renderIcon={(o) => <img className="xsel__flag" src={flagUrl(o.value, 40)} alt="" loading="lazy" />}
        />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Age group</h3>
        <Pills label="Age group" options={FAMILY_OPTS} value={value.family} onChange={(v) => set({ family: v })} />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Duration</h3>
        <Pills label="Duration" options={DURATIONS} value={value.duration} onChange={(v) => set({ duration: v })} />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Decade</h3>
        <Pills
          label="Decade"
          options={DECADES}
          value={decade}
          onChange={(v) => {
            const d = DECADES.find((x) => x.value === v)
            set(d ? { yearFrom: d.from, yearTo: d.to } : { yearFrom: MIN_YEAR, yearTo: CURRENT_YEAR })
          }}
        />
        <div className="xyears">
          <YearInput key={`f${value.yearFrom}`} label="From" value={value.yearFrom} min={MIN_YEAR} max={value.yearTo} onCommit={(n) => set({ yearFrom: n })} />
          <YearInput key={`t${value.yearTo}`} label="To" value={value.yearTo} min={value.yearFrom} max={CURRENT_YEAR + 2} onCommit={(n) => set({ yearTo: n })} />
        </div>
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Minimum rating</h3>
        <RatingSlider key={value.minRating} value={value.minRating} onCommit={(n) => set({ minRating: n })} />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Cinema</h3>
        <Select
          id={`${idPrefix}-cinema`}
          label="Cinema"
          placeholder="Any cinema"
          value={value.cinema}
          options={CINEMAS}
          onChange={(v) => set({ cinema: v })}
        />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">Studios</h3>
        <Select
          id={`${idPrefix}-studio`}
          label="Studio"
          placeholder="Any studio"
          searchable
          multiple
          value={value.companies}
          options={COMPANY_OPTS}
          onChange={(v) => set({ companies: v })}
        />
      </section>

      <section className="xfp__group">
        <h3 className="xfp__title">OTT</h3>
        <div className="xott">
          {OTT.map(({ id, label, bg, Icon, glyph }) => {
            const on = value.ott.includes(id)
            return (
              <button
                key={id}
                type="button"
                aria-pressed={on}
                className={`xott__tile${on ? ' is-on' : ''}`}
                onClick={() => set({ ott: toggleIn(value.ott, id) })}
              >
                <span className="xott__logo" style={{ background: bg }} aria-hidden>{Icon ? <Icon /> : glyph}</span>
                <span className="xott__name">{label}</span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ── Mobile bottom sheet ─────────────────────────────────────────────────────
export function FilterSheet({ initial, defaults = DEFAULT_FILTERS, onApply, onClose, children, title = 'Filters' }) {
  const [draft, setDraft] = useState(initial)
  const [dragY, setDragY] = useState(0)
  const dragStart = useRef(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const onPointerDown = (e) => { dragStart.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId) }
  const onPointerMove = (e) => { if (dragStart.current != null) setDragY(Math.max(0, e.clientY - dragStart.current)) }
  const onPointerUp = () => {
    if (dragY > 110) onClose()
    dragStart.current = null
    setDragY(0)
  }

  return createPortal(
    <div className="xsheet" role="dialog" aria-modal="true" aria-labelledby="xsheet-title">
      <div className="xsheet__scrim" onClick={onClose} />
      <div className="xsheet__panel" style={dragY ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}>
        <div
          className="xsheet__grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span />
        </div>
        <header className="xsheet__head">
          <LuSlidersHorizontal aria-hidden />
          <h2 id="xsheet-title">{title}</h2>
          <button type="button" className="xsheet__close" onClick={onClose} aria-label="Close filters"><LuX /></button>
        </header>
        <div className="xsheet__body">{children(draft, setDraft)}</div>
        <footer className="xsheet__foot">
          <button type="button" className="xsheet__clear" onClick={() => setDraft({ ...defaults })}>Clear all</button>
          <button type="button" className="xsheet__apply" onClick={() => onApply(draft)}>Show results</button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
