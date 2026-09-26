// Pure send-window logic for the meditation reminder's resend guard.
//
// Kept outside index.ts so it can be unit-tested the way bible-chat splits its
// modules (prompt.ts / stream.ts), without pulling in the Supabase/FCM runtime.
//
// The atomic claim in index.ts is the authority on whether a window is won —
// these helpers only describe the window arithmetic that the claim encodes in
// its WHERE clause, and let the function skip a pointless claim round-trip when
// its own snapshot already shows the window is not claimable.

export const MIN_RESEND_GAP_MS = 55 * 60 * 1000 // guards against a cron double-fire within the same hour

/**
 * Whether the resend window is claimable given the last time a reminder was
 * sent. A null/absent last-sent time is always claimable (first send ever).
 */
export function shouldClaimSlot(lastSentAtIso, nowMs, gapMs = MIN_RESEND_GAP_MS) {
  if (!lastSentAtIso) return true
  return nowMs - new Date(lastSentAtIso).getTime() >= gapMs
}

/** ISO timestamp marking the start of the claimable window. */
export function windowStartIso(nowMs, gapMs = MIN_RESEND_GAP_MS) {
  return new Date(nowMs - gapMs).toISOString()
}