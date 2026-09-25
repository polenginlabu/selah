import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RECURRENCE_TYPES,
  validRecurrence,
  recurrenceMatches,
  isDue,
  duePrayerItems,
  weekdayIndexOf,
  dayKey,
  formatDayInZone,
} from './prayerSchedule.js'

// --- validRecurrence --------------------------------------------------------

test('validRecurrence accepts every supported shape', () => {
  for (const type of RECURRENCE_TYPES) {
    // weekly/custom need a days array; the rest are complete on their own.
    const recurrence = type === 'weekly' || type === 'custom' ? { type, days: [0] } : { type }
    assert.equal(validRecurrence(recurrence), true, type)
  }
  assert.equal(validRecurrence({ type: 'weekly', days: [0] }), true)
  assert.equal(validRecurrence({ type: 'custom', days: [1, 3, 5] }), true)
  assert.equal(validRecurrence({ type: 'daily', days: [2] }), true) // extra days ignored for daily
})

test('validRecurrence rejects malformed rules', () => {
  for (const bad of [
    null, undefined, 'daily', [], 42,
    { type: 'hourly' },
    { type: 'weekly' }, // weekly requires days
    { type: 'custom' }, // custom requires days
    { type: 'weekly', days: [] },
    { type: 'custom', days: [] },
    { type: 'weekly', days: '0' },
    { type: 'daily', days: '0' },
    { type: 'custom', days: [1, 7] }, // 7 is Saturday+1 = out of range
    { type: 'custom', days: [-1, 1] },
    { type: 'custom', days: [1.5, 2] },
    { type: 'custom', days: [1, '3'] },
  ]) {
    assert.equal(validRecurrence(bad), false, JSON.stringify(bad))
  }
})

// --- recurrenceMatches ------------------------------------------------------

test('recurrenceMatches: daily and never', () => {
  for (let wd = 0; wd <= 6; wd++) {
    assert.equal(recurrenceMatches({ type: 'daily' }, wd), true, `weekday ${wd}`)
    assert.equal(recurrenceMatches({ type: 'never' }, wd), false, `weekday ${wd}`)
  }
})

test('recurrenceMatches: weekdays skips weekend', () => {
  assert.equal(recurrenceMatches({ type: 'weekdays' }, 0), false) // Sunday
  assert.equal(recurrenceMatches({ type: 'weekdays' }, 6), false) // Saturday
  for (let wd = 1; wd <= 5; wd++) assert.equal(recurrenceMatches({ type: 'weekdays' }, wd), true)
})

test('recurrenceMatches: weekly and custom hit only the chosen days', () => {
  const sunday = { type: 'weekly', days: [0] }
  for (let wd = 0; wd <= 6; wd++) assert.equal(recurrenceMatches(sunday, wd), wd === 0)
  const mwf = { type: 'custom', days: [1, 3, 5] }
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map((wd) => recurrenceMatches(mwf, wd)),
    [false, true, false, true, false, true, false]
  )
  // An invalid rule never matches instead of accidentally always matching.
  assert.equal(recurrenceMatches({ type: 'weekly' }, 0), false)
})

test('recurrenceMatches clamps nothing and treats unknown weekdays as not-matching', () => {
  assert.equal(recurrenceMatches({ type: 'daily' }, 7), true) // caller guard, but rule itself is blind
  assert.equal(recurrenceMatches({ type: 'weekdays' }, 7), false)
  assert.equal(recurrenceMatches({ type: 'daily' }, NaN), true)
  assert.equal(recurrenceMatches({ type: 'never' }, NaN), false)
})

// --- isDue / duePrayerItems -------------------------------------------------

function item(overrides = {}) {
  return {
    id: 'i1',
    categoryId: 'c1',
    title: 'The Lord is my shepherd',
    recurrence: { type: 'daily' },
    isActive: true,
    isArchived: false,
    ...overrides,
  }
}

test('isDue honours active, archived and recurrence together', () => {
  assert.equal(isDue(item(), 3), true)
  assert.equal(isDue(item({ isActive: false }), 3), false)
  assert.equal(isDue(item({ isArchived: true }), 3), false)
  assert.equal(isDue(item({ isArchived: true, isActive: false }), 3), false)
  assert.equal(isDue(item({ recurrence: { type: 'weekdays' } }), 0), false)
  assert.equal(isDue(item({ recurrence: { type: 'weekdays' } }), 2), true)
  assert.equal(isDue(null, 2), false)
})

test('duePrayerItems filters a mixed list by weekday', () => {
  const list = [
    item({ id: 'a', recurrence: { type: 'daily' } }),
    item({ id: 'b', recurrence: { type: 'never' } }),
    item({ id: 'c', recurrence: { type: 'weekdays' } }),
    item({ id: 'd', recurrence: { type: 'weekly', days: [0] } }),
    item({ id: 'e', isArchived: true, recurrence: { type: 'daily' } }),
    item({ id: 'f', isActive: false, recurrence: { type: 'daily' } }),
  ]
  assert.deepEqual(duePrayerItems(list, 3).map((i) => i.id), ['a', 'c']) // Wednesday: daily + weekdays
  assert.deepEqual(duePrayerItems(list, 0).map((i) => i.id), ['a', 'd']) // Sunday
  assert.deepEqual(duePrayerItems([], 1), [])
})

// --- weekdayIndexOf ---------------------------------------------------------

test('weekdayIndexOf resolves an ISO date to Date-convention weekday', () => {
  assert.equal(weekdayIndexOf('2026-09-25'), 5) // a Friday
  assert.equal(weekdayIndexOf('2026-09-20'), 0) // a Sunday
  assert.equal(weekdayIndexOf('2026-09-26'), 6) // a Saturday
})

// --- dayKey -----------------------------------------------------------------

test('dayKey renders the local calendar date in the user timezone', () => {
  // 16:30 UTC on the 25th is already 00:30 on the 26th in Manila (+8).
  assert.equal(dayKey('Asia/Manila', new Date('2026-09-25T16:30:00Z')), '2026-09-26')
  // 06:30 UTC is still the 25th in Los Angeles (-7 in September).
  assert.equal(dayKey('America/Los_Angeles', new Date('2026-09-26T06:30:00Z')), '2026-09-25')
  // No timezone = device zone (here: parse the device's own local date).
  assert.equal(dayKey(null, new Date(2026, 8, 25, 23, 59)).length, 10)
})

test('an 11:50 PM completion stays in the user\'s own day', () => {
  // In UTC the timestamp is already the next day; the user's local day is not.
  const lateLocal = new Date('2026-09-25T15:50:00Z') // 23:50 in Manila
  assert.equal(dayKey('Asia/Manila', lateLocal), '2026-09-25')
  assert.equal(dayKey('UTC', lateLocal), '2026-09-25')
  assert.equal(dayKey('America/New_York', lateLocal), '2026-09-25')
})

test('dayKey is stable across a DST boundary', () => {
  // Spring forward 2026-03-08 in New York (UTC-5 -> UTC-4).
  const before = new Date('2026-03-08T04:30:00Z') // 23:30 EST on the 7th
  const after = new Date('2026-03-09T04:30:00Z') // 00:30 EDT on the 9th
  assert.equal(dayKey('America/New_York', before), '2026-03-07')
  assert.equal(dayKey('America/New_York', after), '2026-03-09')
  // Daily hygiene while DST-active code runs: no NaN dates, always 10 chars.
  assert.match(dayKey('America/New_York', new Date('2026-11-01T06:30:00Z')), /^\d{4}-\d{2}-\d{2}$/)
})

test('formatDayInZone renders a weekday date heading in-zone', () => {
  const heading = formatDayInZone('Asia/Manila', new Date('2026-09-25T16:30:00Z')) // local: Sat Sep 26
  assert.ok(heading.includes('Saturday'))
  assert.ok(heading.includes('September'))
  assert.ok(heading.includes('26'))
  assert.equal(typeof formatDayInZone(null), 'string') // device-zone fallback never throws
})