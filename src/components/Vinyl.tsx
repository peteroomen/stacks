// The signature "." after wordmarks and page titles, rendered as a little
// green vinyl record. Sizes to the surrounding text (em-based) and carries its
// own consistent leading space so spacing never drifts between usages.
export function Vinyl({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`vinyl ${className}`} />;
}

// A small vinyl-label "stamp" pressed into the corner of an album cover to show
// its rating. Same motif as <Vinyl>, scaled up with the number as the label.
export function RatingStamp({ rating }: { rating: number }) {
  return (
    <span className="vinyl-stamp" aria-label={`Rated ${rating} out of 10`}>
      <span className="vinyl-stamp__num rating-num">{rating}</span>
    </span>
  );
}
