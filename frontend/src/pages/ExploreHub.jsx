/**
 * ExploreHub.jsx — one facet's full list, picked from the navbar Explore menu.
 *
 * Route: /explore/:facet  (category | genre | country | language | family | anime | franchise)
 *
 * Four layouts:
 *   alpha     — A–Z letter column + tile grid      (category, language)
 *   tone      — gradient genre cards               (genre, family, anime)
 *   flag      — flag tiles                         (country)
 *   franchise — 16:9 banner cards                  (franchise; GET /api/v1/explore/franchises)
 *
 * Every list except franchises is static, so search filters in memory as you type.
 * A tile opens /explore with that facet applied; a franchise opens its own page.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { LuSearch, LuX } from 'react-icons/lu'
import { movieService } from '../services/movieService'
import {
  ANIME_GENRES, CATEGORIES, COUNTRIES, FAMILY, GENRES, LANGUAGES, flagUrl, groupByLetter,
} from '../utils/exploreTaxonomy'
import ExploreAurora from '../components/explore/ExploreAurora'
import '../components/explore/explore-tokens.css'
import './ExploreHub.css'

const TMDB = 'https://image.tmdb.org/t/p'

const HUBS = {
  category: {
    title: 'Categories', search: 'Search category', layout: 'alpha',
    items: CATEGORIES.map((c) => ({ key: c.slug, label: c.label, to: `/explore?category=${c.slug}` })),
  },
  language: {
    title: 'Languages', search: 'Search language', layout: 'alpha',
    items: LANGUAGES.map((l) => ({ key: l.slug, label: l.label, to: `/explore?language=${l.slug}` })),
  },
  genre: {
    title: 'Genres', search: 'Search genre', layout: 'tone',
    items: GENRES.map((g) => ({ key: g.slug, label: g.label, tone: g.tone, to: `/explore?genres=${g.slug}` })),
  },
  family: {
    title: 'Family Friendly', search: 'Search age group', layout: 'tone',
    items: FAMILY.map((f) => ({ key: f.slug, label: f.label, hint: f.hint, tone: f.tone, to: `/explore?family=${f.slug}` })),
  },
  anime: {
    title: 'Anime', search: 'Search anime genre', layout: 'tone',
    items: ANIME_GENRES.map((a) => ({
      key: a.slug, label: a.label, tone: a.tone,
      to: `/explore?anime=only&${a.genres ? `genres=${a.genres}` : `category=${a.category}`}`,
    })),
  },
  country: {
    title: 'Countries', search: 'Search country', layout: 'flag',
    items: COUNTRIES.map((c) => ({ key: c.code, label: c.label, code: c.code, to: `/explore?countries=${c.code}` })),
  },
  franchise: {
    title: 'Franchise', search: 'Search franchise collections', layout: 'franchise', items: null,
  },
}

// Franchise list survives navigating away and back within the tab.
let franchiseCache = null

export default function ExploreHub() {
  const { facet } = useParams()
  // Keyed so switching facet starts with an empty search box.
  return <Hub key={facet} facet={facet} />
}

function Hub({ facet }) {
  const hub = HUBS[facet]
  const [query, setQuery] = useState('')
  const [franchises, setFranchises] = useState(franchiseCache)

  useEffect(() => {
    if (facet !== 'franchise' || franchiseCache) return
    let alive = true
    movieService.getFranchises()
      .then((list) => {
        franchiseCache = list
        if (alive) setFranchises(list)
      })
      .catch(() => alive && setFranchises([]))
    return () => { alive = false }
  }, [facet])

  useEffect(() => {
    if (hub) document.title = `${hub.title} - Explore - Movientum`
  }, [hub])

  const items = useMemo(() => {
    if (!hub) return []
    const source = hub.layout === 'franchise'
      ? (franchises || []).map((f) => ({ key: f.slug, label: f.title, backdrop: f.backdrop, cover: f.cover, to: `/explore/franchise/${f.slug}` }))
      : hub.items
    const q = query.trim().toLowerCase()
    return q ? source.filter((it) => it.label.toLowerCase().includes(q)) : source
  }, [hub, franchises, query])

  if (!hub) return <Navigate to="/explore" replace />

  const loadingFranchises = hub.layout === 'franchise' && franchises === null

  return (
    <main className="xhub page-content">
      <ExploreAurora variant={facet} />
      <div className="xhub__inner">
        <header className="xhub__head">
          <h1 className="xhub__title">{hub.title}</h1>
          <label className="xhub__search">
            <LuSearch aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={hub.search}
              aria-label={hub.search}
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><LuX /></button>
            )}
          </label>
        </header>

        {loadingFranchises && <FranchiseSkeleton />}

        {!loadingFranchises && items.length === 0 && (
          <p className="xhub__empty">
            {query ? <>Nothing matches “{query}”. Try a shorter word.</> : 'Nothing to show here yet.'}
          </p>
        )}

        {hub.layout === 'alpha' && <AlphaList items={items} />}
        {hub.layout === 'tone' && <ToneGrid items={items} />}
        {hub.layout === 'flag' && <FlagGrid items={items} />}
        {hub.layout === 'franchise' && !loadingFranchises && <FranchiseGrid items={items} />}
      </div>
    </main>
  )
}

function AlphaList({ items }) {
  return (
    <div className="xhub-alpha">
      {groupByLetter(items).map(({ letter, items: group }) => (
        <section key={letter} className="xhub-alpha__group" aria-label={letter}>
          <span className="xhub-alpha__letter" aria-hidden>{letter}</span>
          <div className="xhub-alpha__tiles">
            {group.map((it) => (
              <Link key={it.key} to={it.to} className="xhub-alpha__tile">{it.label}</Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ToneGrid({ items }) {
  return (
    <div className="xhub-tone">
      {items.map((it) => (
        <Link key={it.key} to={it.to} className="xhub-tone__card" style={{ '--tone': it.tone }}>
          <span className="xhub-tone__label">{it.label}</span>
          {it.hint && <span className="xhub-tone__hint">{it.hint}</span>}
        </Link>
      ))}
    </div>
  )
}

function FlagGrid({ items }) {
  return (
    <div className="xhub-flag">
      {items.map((it) => (
        <Link key={it.key} to={it.to} className="xhub-flag__tile">
          <img
            className="xhub-flag__img"
            src={flagUrl(it.code, 80)}
            srcSet={`${flagUrl(it.code, 160)} 2x`}
            alt=""
            width="68"
            height="48"
            loading="lazy"
            decoding="async"
          />
          <span className="xhub-flag__name">{it.label}</span>
        </Link>
      ))}
    </div>
  )
}

function FranchiseGrid({ items }) {
  return (
    <div className="xhub-fr">
      {items.map((it) => (
        <Link key={it.key} to={it.to} className="xhub-fr__card">
          <div className="xhub-fr__art">
            {it.backdrop ? (
              <img src={`${TMDB}/w780${it.backdrop}`} alt="" loading="lazy" decoding="async" />
            ) : (
              <div className="xhub-fr__posters" aria-hidden>
                {(it.cover || []).slice(0, 3).map((p) => (
                  <img key={p} src={`${TMDB}/w185${p}`} alt="" loading="lazy" decoding="async" />
                ))}
              </div>
            )}
          </div>
          <span className="xhub-fr__title">{it.label}</span>
        </Link>
      ))}
    </div>
  )
}

function FranchiseSkeleton() {
  return (
    <div className="xhub-fr" aria-hidden>
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="xhub-fr__card xhub-fr__card--ghost">
          <div className="xhub-fr__art" />
          <span className="xhub-fr__ghostline" />
        </div>
      ))}
    </div>
  )
}
