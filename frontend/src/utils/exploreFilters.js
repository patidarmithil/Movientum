/**
 * Explore filter defaults and helpers (kept out of ExploreFilters.jsx so that file
 * exports components only, which Vite fast refresh needs).
 */
import { CURRENT_YEAR } from './exploreTaxonomy'

export const MIN_YEAR = 1900

export const DEFAULT_FILTERS = {
  sort: 'popularity',
  type: '',
  anime: '',
  genres: [],
  category: '',
  language: '',
  countries: [],
  family: '',
  award: false,
  duration: '',
  yearFrom: MIN_YEAR,
  yearTo: CURRENT_YEAR,
  minRating: 0,
  cinema: '',
  companies: [],
  ott: [],
}

/** How many filters differ from the defaults (sort does not count). */
export function countActive(f) {
  return (
    !!f.type + !!f.anime + f.genres.length + !!f.category + !!f.language + f.countries.length +
    !!f.family + f.award + !!f.duration + (f.yearFrom > MIN_YEAR || f.yearTo < CURRENT_YEAR) +
    (f.minRating > 0) + !!f.cinema + f.companies.length + f.ott.length
  )
}

