// Content + visuals for the Intro page. Edit this file to add/reorder sections —
// Intro.jsx renders from these arrays, it does not hardcode section markup.
//
// Images are downloaded once via `node scripts/download-intro-assets.mjs`
// (frontend/) into src/assets/intro/ and imported statically below — Vite
// fingerprints and bundles them, no runtime fetches.

import heroFar from '../assets/intro/hero-far.jpg'
import cardDiscover from '../assets/intro/card-discover-spiderverse.jpg'
import cardRate from '../assets/intro/card-rate.jpg'
// Supplied by hand, not fetched from TMDB — download-intro-assets.mjs does not
// manage this file and must never overwrite it.
import cardRecs from '../assets/intro/rec.jpg'

const posterModules = import.meta.glob('../assets/intro/posters/*.jpg', { eager: true, import: 'default' })
const posterUrls = Object.keys(posterModules)
  .sort()
  .map((key) => posterModules[key])

// A single still carries the hero. hero-mid.jpg (Blade Runner 2049) and
// hero-near.jpg (Dune: Part Two) remain on disk but are intentionally unused —
// one clean image reads better behind the headline than a stack of three.
export const HERO_LAYERS = {
  // Interstellar — deep space, empty upper field holds the headline
  far: { image: `url(${heroFar})` },
}

export const RAIL_SECTIONS = [
  { id: 'intro-start', label: 'START' },
  { id: 'intro-discover', label: 'DISCOVER' },
  { id: 'intro-rate', label: 'RATE' },
  { id: 'intro-taste', label: 'TASTE' },
  { id: 'intro-scale', label: 'SCALE' },
  { id: 'intro-lists', label: 'LISTS' },
  { id: 'intro-explore', label: 'EXPLORE' },
  { id: 'intro-library', label: 'LIBRARY' },
  { id: 'intro-creator', label: 'CREATOR' },
]

export const FEATURE_CARDS = [
  {
    id: 'intro-discover',
    side: 'left',
    ghostWord: 'DISCOVER',
    eyebrow: 'BROWSE',
    title: 'Discover',
    desc: "Browse trending movies & series, filter by genre, year, and country. Surface what's hot, what's hidden, what's yours.",
    image: cardDiscover, // Spider-Man: Into the Spider-Verse
  },
  {
    id: 'intro-rate',
    side: 'right',
    ghostWord: 'RATE',
    eyebrow: 'YOUR SCALE',
    title: 'Rate',
    desc: 'Forget 5 stars. Use our unique 4-tier human scale: Skip / Timepass / Go For It / Perfection — ratings that actually mean something.',
    image: cardRate, // Oppenheimer
  },
  {
    id: 'intro-taste',
    side: 'left',
    ghostWord: 'TASTE',
    eyebrow: 'AI-POWERED',
    title: 'Recommendations',
    desc: "AI-powered picks based on your real taste. Our engine learns from what you rate, privately, and surfaces films you'll genuinely love.",
    image: cardRecs, // Frieren
  },
]

export const RATING_PILLS = [
  { key: 'skip', color: 'var(--rating-skip)', name: 'Skip', desc: "Not your thing? Skip it." },
  { key: 'timepass', color: 'var(--rating-timepass)', name: 'Timepass', desc: 'Decent watch, no regrets.' },
  { key: 'goforit', color: 'var(--rating-goforit)', name: 'Go For It', desc: 'Absolutely worth your time.' },
  { key: 'perfection', color: 'var(--rating-perfection)', name: 'Perfection', desc: 'A masterpiece. Period.' },
]

// Poster wall — order matches scripts/download-intro-assets.mjs's POSTERS
// array (16 movies then 8 shows), so posterUrls[i] lines up with title[i].
const POSTER_TITLES = [
  'The Dark Knight', 'Parasite', 'Interstellar', 'Whiplash',
  'Across the Spider-Verse', 'Everything Everywhere', 'Mad Max: Fury Road', 'Arrival',
  'Your Name', 'Grand Budapest Hotel', 'Joker', 'Dune',
  'Oppenheimer', 'La La Land', 'Blade Runner 2049', 'Avengers: Endgame',
  'Breaking Bad', 'Game of Thrones', 'Chernobyl', 'Dark',
  'The Last of Us', 'Arcane', 'Severance', 'Stranger Things',
]

export const POSTER_WALL = POSTER_TITLES.map((title, i) => ({
  title,
  image: posterUrls[i],
}))
