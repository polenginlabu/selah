import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dueKind,
  isAuthorized,
  isQuiet,
  localParts,
  parseTime,
  reminderMissed,
  shouldDeleteToken,
} from '../../supabase/functions/devotion-reminder/schedule.js'

// The scheduler's pure logic lives beside the edge function so Deno and this
// node --test run exercise the same file.

const MANILA = 'Asia/Manila' // UTC+8, no DST
const NEW_YORK = 'America/New_York'

/** A Manila wall-clock time on 2026-10-07 (or `day`) as epoch ms. */
const manila = (h, m, day = 7) => Date.UTC(2026, 9, day, h - 8, m)

const base = { tz: MANILA, remindTime: '06:30', followups: 2, done: false, sentKinds: [] }
const at = (h, m, overrides = {}) => dueKind({ ...base, nowMs: manila(h, m), ...overrides })

// --- localParts / parseTime --------------------------------------------------

test('localParts gives the local date and minutes in the user timezone', () => {
  assert.deepEqual(localParts(MANILA, manila(6, 30)), { date: '2026-10-07', minutes: 390 })
  assert.deepEqual(localParts(MANILA, manila(0, 0)), { date: '2026-10-07', minutes: 0 })
})

test('the same instant is a different local day in Manila and New York', () => {
  const instant = Date.UTC(2026, 9, 7, 2, 0) // 10:00 Manila, 22:00 previous day New York
  assert.deepEqual(localParts(MANILA, instant), { date: '2026-10-07', minutes: 600 })
  assert.deepEqual(localParts(NEW_YORK, instant), { date: '2026-10-06', minutes: 1320 })
})

test('an invalid or missing timezone yields no date instead of throwing', () => {
  assert.deepEqual(localParts('Not/AZone', manila(6, 30)), { date: null, minutes: null })
  assert.deepEqual(localParts(null, manila(6, 30)), { date: null, minutes: null })
  assert.equal(at(6, 30, { tz: 'Not/AZone' }), null)
  assert.equal(at(6, 30, { tz: '' }), null)
})

test('parseTime accepts HH:MM and Postgres HH:MM:SS, rejects junk', () => {
  assert.equal(parseTime('06:30'), 390)
  assert.equal(parseTime('06:30:00'), 390)
  assert.equal(parseTime('23:59:59'), 1439)
  assert.equal(parseTime('24:00'), null)
  assert.equal(parseTime('nope'), null)
  assert.equal(parseTime(null), null)
  assert.equal(at(6, 30, { remindTime: null }), null)
})

// --- initial window ----------------------------------------------------------

test('nothing before the chosen time; initial exactly at it', () => {
  assert.equal(at(6, 29), null)
  assert.equal(at(6, 30), 'initial')
  assert.equal(at(6, 30, { remindTime: '06:30:00' }), 'initial')
})

test('initial stays due through the grace window and not one minute past', () => {
  assert.equal(at(6, 44), 'initial')
  assert.equal(at(6, 45), null)
})

// --- follow-ups and the cap --------------------------------------------------

test('follow-ups are due at +2h and +5h', () => {
  assert.equal(at(8, 30), 'followup1')
  assert.equal(at(11, 30), 'followup2')
  assert.equal(at(9, 30), null)
})

test('followups caps how many follow-ups are eligible', () => {
  assert.equal(at(8, 30, { followups: 0 }), null)
  assert.equal(at(11, 30, { followups: 0 }), null)
  assert.equal(at(6, 30, { followups: 0 }), 'initial')
  assert.equal(at(8, 30, { followups: 1 }), 'followup1')
  assert.equal(at(11, 30, { followups: 1 }), null)
  assert.equal(at(11, 30, { followups: 2 }), 'followup2')
})

test('an out-of-range or missing followups value never exceeds two follow-ups', () => {
  assert.equal(at(11, 30, { followups: 9 }), 'followup2')
  assert.equal(at(8, 30, { followups: undefined }), null)
})

// --- done and already-sent ---------------------------------------------------

test('done today suppresses every kind, including follow-ups already due', () => {
  assert.equal(at(6, 30, { done: true }), null)
  assert.equal(at(8, 30, { done: true }), null)
  assert.equal(at(11, 30, { done: true }), null)
})

test('a kind already in the log is not sent again by a later tick', () => {
  assert.equal(at(6, 40, { sentKinds: ['initial'] }), null)
  assert.equal(at(8, 40, { sentKinds: ['initial', 'followup1'] }), null)
  assert.equal(at(8, 40, { sentKinds: ['initial'] }), 'followup1')
})

test('a late tick sends only the latest due kind', () => {
  // Widen the grace so two windows overlap; the latest unsent kind wins.
  assert.equal(at(8, 35, { graceMin: 200 }), 'followup1')
  assert.equal(at(8, 35, { graceMin: 200, sentKinds: ['followup1'] }), 'initial')
})

// --- quiet hours -------------------------------------------------------------

test('quiet hours run 21:00 to 07:00', () => {
  assert.equal(isQuiet(20 * 60 + 59), false)
  assert.equal(isQuiet(21 * 60), true)
  assert.equal(isQuiet(6 * 60 + 59), true)
  assert.equal(isQuiet(7 * 60), false)
})

test('a follow-up due just before 21:00 goes out; one minute into quiet hours it does not', () => {
  const evening = { remindTime: '18:50', followups: 1 }
  assert.equal(at(20, 50, evening), 'followup1')
  assert.equal(at(20, 59, evening), 'followup1')
  assert.equal(at(21, 0, evening), null)
})

test("a 20:00 reminder's +2h follow-up lands in quiet hours and is dropped", () => {
  const evening = { remindTime: '20:00' }
  assert.equal(at(20, 0, evening), 'initial')
  assert.equal(at(22, 0, evening), null)
  assert.equal(at(22, 10, evening), null)
})

test('quiet hours do not suppress an initial the user scheduled inside them', () => {
  const early = { remindTime: '05:00' }
  assert.equal(at(5, 0, early), 'initial')
  assert.equal(at(22, 30, { remindTime: '22:30' }), 'initial')
  // Its follow-ups only fire once quiet hours end.
  assert.equal(at(7, 0, early), 'followup1')
  assert.equal(at(10, 0, early), 'followup2')
})

// --- midnight ----------------------------------------------------------------

test('a 23:30 reminder never sends past midnight', () => {
  const late = { remindTime: '23:30' }
  assert.equal(at(23, 30, late), 'initial')
  assert.equal(at(23, 44, late), 'initial')
  // +2h would be 01:30 the next local day: dropped, not rolled over.
  assert.equal(dueKind({ ...base, ...late, nowMs: manila(1, 30, 8) }), null)
  assert.equal(dueKind({ ...base, ...late, nowMs: manila(4, 30, 8) }), null)
  // And the grace window does not carry the initial over midnight either.
  assert.equal(dueKind({ ...base, remindTime: '23:55', nowMs: manila(0, 3, 8) }), null)
})

// --- DST ---------------------------------------------------------------------

test('New York spring-forward day: 06:30 local is still due at 06:30 EDT', () => {
  const nowMs = Date.UTC(2026, 2, 8, 10, 30) // 06:30 EDT
  assert.deepEqual(localParts(NEW_YORK, nowMs), { date: '2026-03-08', minutes: 390 })
  assert.equal(dueKind({ ...base, tz: NEW_YORK, nowMs }), 'initial')
  // The day before, 06:30 EST is an hour later in UTC.
  assert.equal(dueKind({ ...base, tz: NEW_YORK, nowMs: Date.UTC(2026, 2, 7, 11, 30) }), 'initial')
})

test('New York fall-back day: a repeated 01:30 is due twice, and the log blocks the second send', () => {
  const remind = { tz: NEW_YORK, remindTime: '01:30' }
  const first = Date.UTC(2026, 10, 1, 5, 30) // 01:30 EDT
  const second = Date.UTC(2026, 10, 1, 6, 30) // 01:30 EST
  assert.equal(localParts(NEW_YORK, first).minutes, 90)
  assert.equal(localParts(NEW_YORK, second).minutes, 90)
  assert.equal(dueKind({ ...base, ...remind, nowMs: first }), 'initial')
  assert.equal(dueKind({ ...base, ...remind, nowMs: second, sentKinds: ['initial'] }), null)
})

// --- missed banner -----------------------------------------------------------

test('reminderMissed is true only once the time and its grace have passed', () => {
  assert.equal(reminderMissed(390, '06:30'), false)
  assert.equal(reminderMissed(404, '06:30'), false)
  assert.equal(reminderMissed(405, '06:30'), true)
  assert.equal(reminderMissed(405, 'bad'), false)
  assert.equal(reminderMissed(null, '06:30'), false)
})

// --- token cleanup -----------------------------------------------------------

test('only 404 or UNREGISTERED deletes a token', () => {
  const unregistered = {
    error: {
      code: 404,
      status: 'NOT_FOUND',
      details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }],
    },
  }
  assert.equal(shouldDeleteToken(404, unregistered), true)
  assert.equal(shouldDeleteToken(404, ''), true)
  assert.equal(shouldDeleteToken(400, unregistered), true)
  assert.equal(shouldDeleteToken(400, JSON.stringify(unregistered)), true)
  assert.equal(shouldDeleteToken(500, { error: { code: 500 } }), false)
  assert.equal(shouldDeleteToken(429, { error: { details: [{ errorCode: 'QUOTA_EXCEEDED' }] } }), false)
  assert.equal(shouldDeleteToken(403, { error: { details: [{ errorCode: 'SENDER_ID_MISMATCH' }] } }), false)
  assert.equal(shouldDeleteToken(503, 'not json'), false)
})

// --- shared secret -----------------------------------------------------------

test('isAuthorized requires an exact match and rejects an unset secret', () => {
  assert.equal(isAuthorized('s3cret', 's3cret'), true)
  assert.equal(isAuthorized('s3creT', 's3cret'), false)
  assert.equal(isAuthorized('s3cret-longer', 's3cret'), false)
  assert.equal(isAuthorized('', 's3cret'), false)
  assert.equal(isAuthorized(null, 's3cret'), false)
  assert.equal(isAuthorized('', ''), false)
  assert.equal(isAuthorized('anything', undefined), false)
  assert.equal(isAuthorized(undefined, undefined), false)
})
