// Tests for the devotion reminder's scheduling logic.
// Run: deno test supabase/functions/devotion-reminder/
//
// The full case list (DST, midnight, quiet-hour boundaries, token cleanup)
// lives in src/lib/devotionReminderSchedule.test.js, which `npm run card:test`
// runs under node against the same schedule.js. These are the core guarantees,
// kept here so the function directory is self-checking under Deno too.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { dueKind, isAuthorized, localParts, shouldDeleteToken } from './schedule.ts'

const MANILA = 'Asia/Manila'
const manila = (h: number, m: number, day = 7) => Date.UTC(2026, 9, day, h - 8, m)
const base = { tz: MANILA, remindTime: '06:30', followups: 2, done: false, sentKinds: [] as string[] }

Deno.test('initial at the chosen time, follow-ups at +2h and +5h', () => {
  assertEquals(dueKind({ ...base, nowMs: manila(6, 30) }), 'initial')
  assertEquals(dueKind({ ...base, nowMs: manila(8, 30) }), 'followup1')
  assertEquals(dueKind({ ...base, nowMs: manila(11, 30) }), 'followup2')
  assertEquals(dueKind({ ...base, nowMs: manila(6, 45) }), null)
})

Deno.test('follow-up cap, done-skip and already-sent', () => {
  assertEquals(dueKind({ ...base, followups: 1, nowMs: manila(11, 30) }), null)
  assertEquals(dueKind({ ...base, done: true, nowMs: manila(8, 30) }), null)
  assertEquals(dueKind({ ...base, sentKinds: ['initial'], nowMs: manila(6, 40) }), null)
})

Deno.test('quiet hours drop follow-ups but not a scheduled initial; nothing past midnight', () => {
  assertEquals(dueKind({ ...base, remindTime: '20:00', nowMs: manila(22, 0) }), null)
  assertEquals(dueKind({ ...base, remindTime: '05:00', nowMs: manila(5, 0) }), 'initial')
  assertEquals(dueKind({ ...base, remindTime: '23:30', nowMs: manila(1, 30, 8) }), null)
})

Deno.test('invalid timezone is skipped', () => {
  assertEquals(localParts('Not/AZone', manila(6, 30)).date, null)
  assertEquals(dueKind({ ...base, tz: 'Not/AZone', nowMs: manila(6, 30) }), null)
})

Deno.test('token cleanup and shared secret', () => {
  assertEquals(shouldDeleteToken(404, ''), true)
  assertEquals(shouldDeleteToken(400, { error: { details: [{ errorCode: 'UNREGISTERED' }] } }), true)
  assertEquals(shouldDeleteToken(500, {}), false)
  assertEquals(shouldDeleteToken(429, {}), false)
  assertEquals(shouldDeleteToken(403, {}), false)
  assertEquals(isAuthorized('abc', 'abc'), true)
  assertEquals(isAuthorized('abc', ''), false)
  assertEquals(isAuthorized(null, undefined), false)
})
