// Tests for the send-window logic behind the meditation reminder's resend
// guard. Run: deno test supabase/functions/meditation-reminder/
//
// These guard the doubling fix: the window arithmetic encoded in the atomic
// claim's WHERE clause, and the pre-check that skips pointless claim
// round-trips. A wrong window here either doubles pushes (the exact bug this
// run fixes) or stops reminders from ever firing.
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { MIN_RESEND_GAP_MS, shouldClaimSlot, windowStartIso } from './slot.ts'

const NOW = Date.UTC(2026, 8, 26, 10, 0, 0) // 2026-09-26T10:00:00Z
const MIN = 60 * 1000

Deno.test('null/absent last-sent time is always claimable (first send ever)', () => {
  assertEquals(shouldClaimSlot(null, NOW), true)
  assertEquals(shouldClaimSlot(undefined, NOW), true)
  assertEquals(shouldClaimSlot('', NOW), true)
})

Deno.test('freshly sent (within the 55-minute gap) is NOT claimable', () => {
  const sent10MinAgo = new Date(NOW - 10 * MIN).toISOString()
  assertEquals(shouldClaimSlot(sent10MinAgo, NOW), false)
})

Deno.test('exactly at the gap boundary IS claimable', () => {
  const sentAtBoundary = new Date(NOW - MIN_RESEND_GAP_MS).toISOString()
  assertEquals(shouldClaimSlot(sentAtBoundary, NOW), true)
})

Deno.test('older than the gap IS claimable', () => {
  const sent2HoursAgo = new Date(NOW - 2 * 60 * MIN).toISOString()
  assertEquals(shouldClaimSlot(sent2HoursAgo, NOW), true)
})

Deno.test('window start is exactly now minus the gap', () => {
  assertEquals(windowStartIso(NOW), new Date(NOW - MIN_RESEND_GAP_MS).toISOString())
})

Deno.test('window start stays ISO-8601 with a Z suffix (PostgREST timestamptz parses it)', () => {
  assertEquals(windowStartIso(NOW), '2026-09-26T09:05:00.000Z')
})