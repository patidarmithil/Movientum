import MovieRow from './MovieRow'
import TrailerCard from './TrailerCard'

export default function TrailerRow({
  title,
  items,
  loading,
  onPlayTrailer,
  premiumScroll,
  showFeedback = false,
  feedbackSource = 'trailers',
  children,
}) {
  return (
    <MovieRow
      title={title}
      movies={items}
      loading={loading}
      premiumScroll={premiumScroll}
      seeAllHref="/explore"
      showFeedback={showFeedback}
      feedbackSource={feedbackSource}
      // MovieRow used to call renderCard(item) and drop the feedback props on the
      // floor, which is why this row could never show a thumbs control. It now
      // passes them as a second argument — forward them through.
      renderCard={(item, feedback = {}) => (
        <TrailerCard
          key={`${item.media_type}-${item.id}-${item.video_key}`}
          item={item}
          onPlayTrailer={onPlayTrailer}
          {...feedback}
        />
      )}
    >
      {children}
    </MovieRow>
  )
}
