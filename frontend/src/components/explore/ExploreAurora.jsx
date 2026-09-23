/**
 * ExploreAurora.jsx — the top-of-page aurora shared by every /explore page.
 *
 * Same shader and fade as /recommendations, but each explore surface gets its
 * own palette so the results page, every facet hub and a franchise page read
 * as distinct rooms. Aurora picks up new colorStops on the next frame, so
 * hopping between hubs recolours the existing canvas instead of remounting it.
 */
import Aurora from '../Aurora'
import './ExploreAurora.css'

const PALETTES = {
  results:   ['#00C2FF', '#7B61FF', '#00E5A0'], // cyan · violet · mint
  category:  ['#FF8A00', '#FF3D77', '#7A2BFF'], // sunset
  genre:     ['#FF4D6D', '#B048FF', '#3A86FF'], // rose · purple · blue
  country:   ['#00B4D8', '#00F5D4', '#4895EF'], // ocean
  language:  ['#F72585', '#7209B7', '#4CC9F0'], // neon magenta · indigo · ice
  family:    ['#FFD166', '#06D6A0', '#118AB2'], // sunny · green · teal
  anime:     ['#FF006E', '#FB5607', '#FFBE0B'], // hot pink · orange · yellow
  franchise: ['#F5B93C', '#C1121F', '#6A040F'], // gold · crimson · wine
  saga:      ['#5E60CE', '#48BFE3', '#80FFDB'], // single franchise page
}

export default function ExploreAurora({ variant = 'results' }) {
  return (
    <div className="x-aurora" aria-hidden="true">
      <Aurora colorStops={PALETTES[variant] || PALETTES.results} blend={0.5} amplitude={1.0} speed={0.5} />
      <div className="x-aurora__fade" />
    </div>
  )
}
