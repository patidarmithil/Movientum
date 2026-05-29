/**
 * MovieCardSkeleton — shimmer placeholder while data loads
 * Used in all pages during loading state
 */
import './MovieCard.css'

export default function MovieCardSkeleton({ count = 6 }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="movie-card-skeleton">
          <div className="movie-card-skeleton__poster skeleton" />
          <div className="movie-card-skeleton__info">
            <div className="movie-card-skeleton__title skeleton" />
            <div className="movie-card-skeleton__meta skeleton" />
          </div>
        </div>
      ))}
    </>
  )
}
