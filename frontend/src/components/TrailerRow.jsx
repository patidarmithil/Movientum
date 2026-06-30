import MovieRow from './MovieRow'
import TrailerCard from './TrailerCard'

export default function TrailerRow({ title, items, loading, onPlayTrailer, premiumScroll, children }) {
  return (
    <MovieRow
      title={title}
      movies={items}
      loading={loading}
      premiumScroll={premiumScroll}
      seeAllHref="/explore"
      renderCard={(item) => (
        <TrailerCard key={`${item.media_type}-${item.id}-${item.video_key}`} item={item} onPlayTrailer={onPlayTrailer} />
      )}
    >
      {children}
    </MovieRow>
  )
}
