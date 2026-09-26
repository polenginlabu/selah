import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PLAN_DAY_COUNT,
  THEMES,
  completeDay,
  currentDayIndex,
  isPlanFinished,
  pickDevotion,
  removeDay,
} from './devotionPlans.js'

// --- Palette -----------------------------------------------------------------

test('the plan catalog matches the generator palette, one 7-day plan per theme', () => {
  assert.equal(PLAN_DAY_COUNT, 7)
  assert.deepEqual(
    THEMES.map((t) => t.id),
    ['peace', 'joy', 'hope', 'faith', 'gratitude', 'rest', 'courage']
  )
  assert.ok(THEMES.every((t) => t.id && t.label))
})

// --- completeDay / removeDay -------------------------------------------------

test('completeDay adds a day and keeps the list sorted', () => {
  assert.deepEqual(completeDay([], 3), [3])
  assert.deepEqual(completeDay([3, 1], 2), [1, 2, 3])
})

test('completeDay is idempotent', () => {
  assert.deepEqual(completeDay([1, 2], 2), [1, 2])
})

test('removeDay drops a day and keeps the rest sorted', () => {
  assert.deepEqual(removeDay([1, 2, 3], 2), [1, 3])
  assert.deepEqual(removeDay([1, 3], 1), [3])
  assert.deepEqual(removeDay([], 2), [])
  assert.deepEqual(removeDay([1, 2], 5), [1, 2]) // removing a day never completed
})

// --- currentDayIndex ---------------------------------------------------------

test('currentDayIndex is the smallest uncompleted day', () => {
  assert.equal(currentDayIndex([], 7), 1)
  assert.equal(currentDayIndex([1, 2], 7), 3)
  assert.equal(currentDayIndex([1, 3, 4], 7), 2) // skipped day pulls the reader back
  assert.equal(currentDayIndex([2, 4, 6], 7), 1)
})

test('currentDayIndex is null when every day is complete', () => {
  assert.equal(currentDayIndex([1, 2, 3, 4, 5, 6, 7], 7), null)
  // Out-of-order completion still lands on null.
  assert.equal(currentDayIndex([4, 7, 1, 3, 6, 2, 5], 7), null)
})

test('currentDayIndex ignores out-of-range day numbers', () => {
  assert.equal(currentDayIndex([0, 8, 99], 7), 1)
})

// --- isPlanFinished ----------------------------------------------------------

test('isPlanFinished only when every day is done', () => {
  assert.equal(isPlanFinished([1, 2, 3, 4, 5, 6, 7], 7), true)
  assert.equal(isPlanFinished([1, 2, 3], 7), false)
  assert.equal(isPlanFinished([], 7), false)
  // Degenerate guard: an empty plan is never "finished".
  assert.equal(isPlanFinished([], 0), false)
})

// --- pickDevotion ------------------------------------------------------------

test('pickDevotion prefers the themed archive devotion over today', () => {
  const themed = { id: 10, date: '2026-09-20', title: 'Lay Down Your Burdens' }
  const today = { id: 11, date: '2026-09-26', title: 'The God Who Sees' }
  assert.deepEqual(pickDevotion({ themeDevotion: themed, todayDevotion: today }), {
    source: 'theme',
    devotion: themed,
  })
})

test('pickDevotion falls back to today when the theme has no archive devotion', () => {
  const today = { id: 11, date: '2026-09-26', title: 'The God Who Sees' }
  assert.deepEqual(pickDevotion({ themeDevotion: null, todayDevotion: today }), {
    source: 'today',
    devotion: today,
  })
})

test('pickDevotion reports none when nothing exists yet', () => {
  assert.deepEqual(pickDevotion({ themeDevotion: null, todayDevotion: null }), {
    source: 'none',
    devotion: null,
  })
  assert.deepEqual(pickDevotion({}), { source: 'none', devotion: null })
})