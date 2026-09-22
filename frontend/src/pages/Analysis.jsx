import { useCallback, useEffect, useState } from 'react'
import { userService } from '../services/userService'
import LazyMount from '../components/LazyMount'
import SectionRail, { EmptyNote, Section, SectionSkeleton } from './analysis/SectionRail'
import TasteFingerprint from './analysis/TasteFingerprint'
import EngineXray from './analysis/EngineXray'
import TasteProfile from './analysis/TasteProfile'
import FeedbackCenter from './analysis/FeedbackCenter'
import Habits from './analysis/Habits'
import LibraryHighlights from './analysis/LibraryHighlights'
import TuneProfile from './analysis/TuneProfile'
import { tasteHeadline } from './analysis/analysisUtils'
import './Analysis.css'

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'engine', label: 'Your feed' },
  { id: 'taste', label: 'Taste' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'habits', label: 'Habits' },
  { id: 'library', label: 'Library' },
  { id: 'tune', label: 'Settings' },
]

function Lazy({ children, height }) {
  return (
    <LazyMount rootMargin="600px" placeholder={<SectionSkeleton height={height} />}>
      {children}
    </LazyMount>
  )
}

export default function Analysis() {
  const [analysis, setAnalysis] = useState(null)
  const [engine, setEngine] = useState(null)
  const [status, setStatus] = useState('loading')
  const [engineFailed, setEngineFailed] = useState(false)

  const load = useCallback(() => {
    // Both payloads are cached per user on the server; the engine snapshot is
    // allowed to fail on its own without blanking the rest of the page.
    return Promise.all([
      userService.getAnalysis().then((r) => r.data),
      userService.getEngineSnapshot().then((r) => r.data).catch(() => null),
    ]).then(([a, e]) => {
      setAnalysis(a)
      setEngine(e)
      setEngineFailed(!e)
      setStatus('ready')
    }).catch(() => setStatus('error'))
  }, [])

  useEffect(() => { load() }, [load])

  if (status === 'loading') {
    return (
      <main className="an-page" aria-busy="true">
        <div className="an-hero an-hero--skeleton">
          <div>
            <div className="skeleton an-skel-line" style={{ width: 140 }} />
            <div className="skeleton an-skel-line an-skel-line--xl" style={{ width: '80%' }} />
            <div className="skeleton an-skel-line an-skel-line--xl" style={{ width: '55%' }} />
            <div className="skeleton an-skel-line" style={{ width: '40%', marginTop: 24 }} />
          </div>
          <div className="skeleton an-skel-print" />
        </div>
      </main>
    )
  }

  if (status === 'error' || !analysis) {
    return (
      <main className="an-page">
        <EmptyNote>Your analysis could not load. The server may be waking up; reload in a few seconds.</EmptyNote>
      </main>
    )
  }

  const { summary, personal_tags: tags = [] } = analysis
  const headline = tasteHeadline(analysis)
  const taste = engine?.taste

  return (
    <main className="an-page">
      <div className="an-grain" aria-hidden="true" />
      <SectionRail sections={SECTIONS} />

      <section id="overview" className="an-hero" aria-labelledby="overview-title">
        <div className="an-hero__copy">
          <p className="an-eyebrow"><span className="an-eyebrow__dash" />Your taste, measured</p>
          <h1 id="overview-title" className="an-hero__title">
            {headline || 'Your taste map starts with the first title you watch.'}
          </h1>
          {tags.length > 0 && (
            <ul className="an-tags" aria-label="Your viewer traits">
              {tags.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          <dl className="an-hero__stats">
            <div><dt>Watched</dt><dd className="an-num">{summary.total_watched}</dd></div>
            <div><dt>Rated</dt><dd className="an-num">{summary.total_rated}</dd></div>
            <div><dt>Discovery depth</dt><dd className="an-num">{analysis.discovery_depth_score}<small>/100</small></dd></div>
          </dl>
          <p className="an-hero__note">
            Everything below is read from the same data your recommendations use, so what you see here is what your
            feed is working with.
          </p>
        </div>
        <TasteFingerprint
          genres={taste?.genres || []}
          eras={taste?.eras || []}
          interactions={taste?.total_interactions || 0}
        />
      </section>

      <Section
        id="engine"
        eyebrow="How your feed is built"
        title="From your history to your For You feed"
        lead="Five steps, with the numbers your feed runs on right now."
      >
        {engine
          ? <EngineXray engine={engine} />
          : <EmptyNote>{engineFailed ? 'The feed breakdown could not load. Reload the page to try again.' : 'Loading…'}</EmptyNote>}
      </Section>

      <Section
        id="taste"
        eyebrow="Your taste profile"
        title="What the engine has learned about you"
        lead="These weights score every title before it reaches your feed. They move with every watch, watchlist add and thumbs."
      >
        {engine ? <TasteProfile taste={taste} /> : <EmptyNote>The taste profile could not load.</EmptyNote>}
      </Section>

      <Section
        id="feedback"
        eyebrow="Feedback"
        title="What you have told it"
        lead="Every thumbs, watch and save you sent, and the titles you asked it to hide."
      >
        <Lazy height={520}><FeedbackCenter /></Lazy>
      </Section>

      <Section
        id="habits"
        eyebrow="Habits"
        title="How you watch"
        lead="Patterns from your watch history and ratings."
      >
        <Lazy height={560}><Habits analysis={analysis} /></Lazy>
      </Section>

      <Section
        id="library"
        eyebrow="From your library"
        title="Titles worth coming back to"
      >
        <Lazy height={320}><LibraryHighlights analysis={analysis} /></Lazy>
      </Section>

      <Section
        id="tune"
        eyebrow="Settings"
        title="Tune your recommendations"
        lead="Each setting says which part of Movientum it changes."
      >
        <Lazy height={420}><TuneProfile language={engine?.language} onSaved={load} /></Lazy>
      </Section>
    </main>
  )
}
