// Pure swipe decision helper for the Bible reader.
//
// Kept DOM-free so gesture logic is unit-testable with node:test like the
// other src/lib modules (npm run card:test). The reader wires touch events to
// this; a swipe left means "next chapter", swipe right means "previous", and
// anything that is really a tap, a vertical scroll, or a slow drag is 0.

export const SWIPE_MIN_DISTANCE = 60  // px of horizontal travel required
export const SWIPE_MAX_DURATION = 450 // ms; slower drags are scrolling, not swipes
export const SWIPE_DOMINANCE = 1.25   // horizontal travel must beat vertical by this factor

/**
 * Decide a horizontal swipe from touch deltas.
 *
 * @param {object} gesture
 * @param {number} gesture.dx      Horizontal travel in px (negative = left)
 * @param {number} [gesture.dy=0]  Vertical travel in px
 * @param {number} [gesture.duration=0] Gesture duration in ms
 * @param {number} [gesture.minDistance=SWIPE_MIN_DISTANCE]
 * @param {number} [gesture.maxDuration=SWIPE_MAX_DURATION]
 * @param {number} [gesture.dominance=SWIPE_DOMINANCE]
 * @returns {number} -1 previous chapter, 1 next chapter, 0 not a swipe
 */
export function swipeDirection({
  dx,
  dy = 0,
  duration = 0,
  minDistance = SWIPE_MIN_DISTANCE,
  maxDuration = SWIPE_MAX_DURATION,
  dominance = SWIPE_DOMINANCE,
}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(duration)) return 0
  // Thresholds must be sane or they silently disable the gesture rules
  // (NaN disables every < comparison); fall back to the defaults.
  const min = Number.isFinite(minDistance) && minDistance > 0 ? minDistance : SWIPE_MIN_DISTANCE
  const max = Number.isFinite(maxDuration) && maxDuration >= 0 ? maxDuration : SWIPE_MAX_DURATION
  const dom = Number.isFinite(dominance) && dominance > 0 ? dominance : SWIPE_DOMINANCE
  if (duration < 0 || duration > max) return 0
  const absX = Math.abs(dx)
  if (absX === 0 || absX < min || absX < Math.abs(dy) * dom) return 0
  return dx < 0 ? 1 : -1
}