// Tests for the Bible reader swipe gesture decision.
//
// The reader calls swipeDirection with touch deltas; these tests pin the
// thresholds that separate a chapter swipe from a tap, a vertical scroll, a
// slow drag, and a diagonal that isn't really horizontal.
//
// Run: npm run card:test
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  swipeDirection,
  SWIPE_MIN_DISTANCE,
  SWIPE_MAX_DURATION,
  SWIPE_DOMINANCE,
} from './swipe.js'

test('swipe left moves to the next chapter', () => {
  assert.equal(swipeDirection({ dx: -80, dy: 0, duration: 200 }), 1)
})

test('swipe right moves to the previous chapter', () => {
  assert.equal(swipeDirection({ dx: 80, dy: 0, duration: 200 }), -1)
})

test('vertical scrolling is never a swipe', () => {
  assert.equal(swipeDirection({ dx: 5, dy: 200, duration: 300 }), 0)
  assert.equal(swipeDirection({ dx: -5, dy: -180, duration: 300 }), 0)
})

test('short horizontal tremble is ignored', () => {
  assert.equal(swipeDirection({ dx: -(SWIPE_MIN_DISTANCE - 1), dy: 0, duration: 150 }), 0)
  assert.equal(swipeDirection({ dx: SWIPE_MIN_DISTANCE - 1, dy: 0, duration: 150 }), 0)
})

test('exactly the minimum distance counts as a swipe', () => {
  assert.equal(swipeDirection({ dx: -SWIPE_MIN_DISTANCE, dy: 0, duration: 150 }), 1)
})

test('slow drags are ignored even when far', () => {
  assert.equal(swipeDirection({ dx: -120, dy: 0, duration: SWIPE_MAX_DURATION + 1 }), 0)
  assert.equal(swipeDirection({ dx: 120, dy: 0, duration: 900 }), 0)
})

test('an instant touch release inside the budget still swipes', () => {
  assert.equal(swipeDirection({ dx: -90, dy: 0, duration: 0 }), 1)
})

test('diagonals must be horizontally dominant', () => {
  // 70 < 60 * 1.25 = 75, so this stays a scroll even though dx wins.
  assert.equal(swipeDirection({ dx: -70, dy: 60, duration: 200 }), 0)
  // 80 >= 75: now the horizontal travel dominates.
  assert.equal(swipeDirection({ dx: -80, dy: 60, duration: 200 }), 1)
})

test('dominance threshold is configurable', () => {
  assert.equal(swipeDirection({ dx: -70, dy: 60, duration: 200, dominance: 1.1 }), 1)
})

test('custom distance and time budgets are honored', () => {
  assert.equal(swipeDirection({ dx: -40, dy: 0, duration: 200, minDistance: 30 }), 1)
  assert.equal(swipeDirection({ dx: -100, dy: 0, duration: 600, maxDuration: 500 }), 0)
})

test('non-finite or negative input never navigates', () => {
  assert.equal(swipeDirection({ dx: NaN, dy: 0, duration: 100 }), 0)
  assert.equal(swipeDirection({ dx: -80, dy: 0, duration: -5 }), 0)
  assert.equal(swipeDirection({ dx: -80, dy: Infinity, duration: 100 }), 0)
})

test('invalid thresholds fall back to defaults instead of disabling rules', () => {
  assert.equal(swipeDirection({ dx: -80, dy: 0, duration: 200, minDistance: NaN }), 1)
  assert.equal(swipeDirection({ dx: -80, dy: 0, duration: 300, maxDuration: -1 }), 1)
  assert.equal(swipeDirection({ dx: -70, dy: 60, duration: 200, dominance: NaN }), 0)
  // A zero dx is never a swipe, even with a zero minimum requested.
  assert.equal(swipeDirection({ dx: 0, dy: 0, duration: 100, minDistance: 0 }), 0)
  assert.equal(swipeDirection({ dx: 1, dy: 0, duration: 100, minDistance: 0 }), 0)
})

test('constants stay consistent with defaults', () => {
  assert.equal(swipeDirection({ dx: -60, dy: 0, duration: 450 }), 1)
  assert.equal(swipeDirection({ dx: -59.99, dy: 0, duration: 450 }), 0)
})