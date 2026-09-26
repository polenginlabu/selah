import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dayKey, formatDayInZone } from './prayerDay.js'

// --- dayKey -----------------------------------------------------------------

test('dayKey renders the local calendar date in the user timezone', () => {
  // 16:30 UTC on the 25th is already 00:30 on the 26th in Manila (+8).
  assert.equal(dayKey('Asia/Manila', new Date('2026-09-25T16:30:00Z')), '2026-09-26')
  // 06:30 UTC is still the 25th in Los Angeles (-7 in September).
  assert.equal(dayKey('America/Los_Angeles', new Date('2026-09-26T06:30:00Z')), '2026-09-25')
  // No timezone = device zone (here: parse the device's own local date).
  assert.equal(dayKey(null, new Date(2026, 8, 25, 23, 59)).length, 10)
})

test("an 11:50 PM completion stays in the user's own day", () => {
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

// --- formatDayInZone --------------------------------------------------------

test('formatDayInZone renders a weekday date heading in-zone', () => {
  const heading = formatDayInZone('Asia/Manila', new Date('2026-09-25T16:30:00Z')) // local: Sat Sep 26
  assert.ok(heading.includes('Saturday'))
  assert.ok(heading.includes('September'))
  assert.ok(heading.includes('26'))
  assert.equal(typeof formatDayInZone(null), 'string') // device-zone fallback never throws
})