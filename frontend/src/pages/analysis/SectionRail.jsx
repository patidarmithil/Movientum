import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * Fixed right-side section navigation (Intro page rail, same material).
 * Under 900px it becomes a sticky, horizontally scrolling chip bar.
 *
 * The active section is whichever one crosses the upper third of the
 * viewport, tracked by a single IntersectionObserver.
 */
export default function SectionRail({ sections }) {
  const [active, setActive] = useState(sections[0]?.id)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (hit) setActive(hit.target.id)
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    )
    sections.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [sections])

  const jump = (e, id) => {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    setActive(id)
  }

  const index = Math.max(0, sections.findIndex((s) => s.id === active))

  return (
    <nav className="an-rail" aria-label="Analysis sections">
      <ul>
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => jump(e, s.id)}
              className={s.id === active ? 'is-active' : ''}
              aria-current={s.id === active ? 'true' : undefined}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
      <div className="an-rail__track" aria-hidden="true">
        <div
          className="an-rail__indicator"
          style={{ height: `${100 / sections.length}%`, transform: `translateY(${index * 100}%)` }}
        />
      </div>
    </nav>
  )
}

/** Section frame: eyebrow dash + label, heading, lead, then content. */
export function Section({ id, eyebrow, title, lead, children, aside }) {
  return (
    <section id={id} className="an-section" aria-labelledby={`${id}-title`}>
      <header className="an-section__head">
        <div>
          <p className="an-eyebrow"><span className="an-eyebrow__dash" />{eyebrow}</p>
          <h2 id={`${id}-title`} className="an-section__title">{title}</h2>
          {lead && <p className="an-section__lead">{lead}</p>}
        </div>
        {aside && <div className="an-section__aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

/** Placeholder shown by LazyMount and while a section's data loads. */
export function SectionSkeleton({ height = 360 }) {
  return (
    <div className="an-section an-section--skeleton" aria-hidden="true">
      <div className="skeleton an-skel-line" style={{ width: 120 }} />
      <div className="skeleton an-skel-line an-skel-line--lg" style={{ width: '42%' }} />
      <div className="skeleton an-skel-block" style={{ height }} />
    </div>
  )
}

/** Empty state that points at the action which fills the section. */
export function EmptyNote({ children, to, action }) {
  return (
    <div className="an-empty">
      <p>{children}</p>
      {to && <Link className="an-btn an-btn--sm" to={to}>{action}</Link>}
    </div>
  )
}
