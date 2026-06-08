/**
 * ProductionTags.jsx
 *
 * Displays production_companies and production_countries from TMDB detail data
 * as clickable pill tags (styled like the user's reference image).
 *
 * Placed between CastCrew and Similar sections on MovieDetail / TVDetail pages.
 *
 * Clicking a company tag → /company/:id  (GET /api/v1/movies/company/{id})
 * Clicking a country tag → /country/:iso (GET /api/v1/movies/country/{iso})
 */
import { Link } from 'react-router-dom'
import './ProductionTags.css'

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

function CompanyLogo({ logoPath, name }) {
  if (!logoPath) return null
  return (
    <img
      src={`${TMDB_IMAGE_BASE}/w92${logoPath}`}
      alt={name}
      className="prod-tag__logo"
      loading="lazy"
    />
  )
}

export default function ProductionTags({ productionCompanies = [], productionCountries = [] }) {
  const hasCompanies = productionCompanies.length > 0
  const hasCountries = productionCountries.length > 0

  if (!hasCompanies && !hasCountries) return null

  return (
    <section className="prod-tags" aria-label="Production Information">
      {/* ── Production Houses ── */}
      {hasCompanies && (
        <div className="prod-tags__block">
          <h3 className="prod-tags__heading">Production House</h3>
          <div className="prod-tags__row">
            {productionCompanies.map((company) => (
              <Link
                key={company.id}
                to={`/company/${company.id}`}
                state={{ companyName: company.name }}
                className="prod-tag prod-tag--company"
                title={`Browse titles by ${company.name}`}
              >
                {company.logo_path && (
                  <CompanyLogo logoPath={company.logo_path} name={company.name} />
                )}
                <span className="prod-tag__name">{company.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── Production Countries ── */}
      {hasCountries && (
        <div className="prod-tags__block">
          <h3 className="prod-tags__heading">Production Countries</h3>
          <div className="prod-tags__row">
            {productionCountries.map((country) => (
              <Link
                key={country.iso_3166_1}
                to={`/country/${country.iso_3166_1}`}
                state={{ countryName: country.name }}
                className="prod-tag prod-tag--country"
                title={`Browse titles from ${country.name}`}
              >
                <span className="prod-tag__flag" aria-hidden="true">
                  {countryFlag(country.iso_3166_1)}
                </span>
                <span className="prod-tag__name">{country.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** Convert ISO 3166-1 alpha-2 code → emoji flag */
function countryFlag(iso) {
  if (!iso || iso.length !== 2) return '🌍'
  const chars = [...iso.toUpperCase()].map(
    (c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0))
  )
  return chars.join('')
}
