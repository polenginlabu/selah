// Pure scheduling logic for the devotion reminder.
//
// Plain ESM (no TypeScript syntax) so the same file runs under Deno for the
// edge function (via schedule.ts) and under `node --test` for the app's test
// script (src/lib/devotionReminderSchedule.test.js). Nothing here touches the
// network, Supabase or FCM.

export const KINDS = ['initial', 'followup1', 'followup2']

// Minutes after the chosen time at which each reminder kind is due.
export const OFFSETS_MIN = { initial: 0, followup1: 120, followup2: 300 }

// Follow-ups never go out between 21:00 and 07:00 local time.
export const QUIET_START_MIN = 21 * 60
export const QUIET_END_MIN = 7 * 60

// How long after its due minute a kind may still be sent. Coupled to the
// 10-minute pg_cron schedule: every due minute must fall inside at least one
// tick's window, with a little slack for a late tick. Shorten the cron and this
// can shrink; lengthen it and this must grow.
export const GRACE_MIN = 14

const MINUTES_PER_DAY = 24 * 60

/**
 * The calendar date (YYYY-MM-DD) and minutes since local midnight in `tz` at
 * `nowMs`. An invalid or missing timezone gives `{ date: null, minutes: null }`
 * so the caller can skip that user without throwing.
 */
export function localParts(tz, nowMs) {
  if (!tz) return { date: null, minutes: null }
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(nowMs))
  } catch {
    return { date: null, minutes: null }
  }
  const get = (type) => parts.find((p) => p.type === type)?.value
  const hour = Number(get('hour')) % 24 // some engines still render midnight as "24"
  const minute = Number(get('minute'))
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + minute }
}

/** "HH:MM" or "HH:MM:SS" (Postgres `time`) to minutes since midnight, or null. */
export function parseTime(value) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(String(value ?? ''))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export function isQuiet(minutes, quietStartMin = QUIET_START_MIN, quietEndMin = QUIET_END_MIN) {
  return minutes >= quietStartMin || minutes < quietEndMin
}

/**
 * Which reminder, if any, should go out to this user right now.
 *
 * - Nothing once the day is done, even if a follow-up is already due.
 * - `followups` (0..2) caps how many follow-ups are eligible.
 * - A kind is due when local time is 0..graceMin minutes past its due minute
 *   on the same local date. Due minutes past midnight are dropped, never
 *   rolled into the next day.
 * - Quiet hours suppress follow-ups only. An initial reminder the user
 *   deliberately scheduled inside quiet hours still fires.
 * - If more than one kind is due, the latest unsent one wins.
 */
export function dueKind({
  nowMs,
  tz,
  remindTime,
  followups,
  done,
  sentKinds = [],
  quietStartMin = QUIET_START_MIN,
  quietEndMin = QUIET_END_MIN,
  graceMin = GRACE_MIN,
}) {
  if (done) return null
  const { date, minutes } = localParts(tz, nowMs)
  if (!date) return null
  const base = parseTime(remindTime)
  if (base === null) return null

  const cap = Math.max(0, Math.min(2, Number.isInteger(followups) ? followups : 0))
  const eligible = KINDS.slice(0, 1 + cap)

  for (const kind of [...eligible].reverse()) {
    const dueAt = base + OFFSETS_MIN[kind]
    if (dueAt >= MINUTES_PER_DAY) continue
    const late = minutes - dueAt
    if (late < 0 || late > graceMin) continue
    if (kind !== 'initial' && isQuiet(minutes, quietStartMin, quietEndMin)) continue
    if (sentKinds.includes(kind)) continue
    return kind
  }
  return null
}

/**
 * Whether the chosen time has passed today with no chance of a push
 * catching up — used by the app's in-app fallback banner.
 */
export function reminderMissed(localMinutes, remindTime, graceMin = GRACE_MIN) {
  const base = parseTime(remindTime)
  if (base === null || localMinutes === null || localMinutes === undefined) return false
  return localMinutes > base + graceMin
}

/**
 * Only a token FCM says is gone should be deleted: HTTP 404 or an
 * UNREGISTERED error code. Rate limits, server errors and auth problems are
 * on our side or transient and must leave the token alone.
 */
export function shouldDeleteToken(status, body) {
  if (status === 404) return true
  let parsed = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return false
    }
  }
  const details = parsed?.error?.details
  return Array.isArray(details) && details.some((d) => d?.errorCode === 'UNREGISTERED')
}

/**
 * Constant-time check of the shared-secret header. An unset or empty secret
 * rejects everything, so a missing env var can never open the function.
 */
export function isAuthorized(header, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return false
  if (typeof header !== 'string') return false
  const length = Math.max(header.length, secret.length)
  let diff = header.length ^ secret.length
  for (let i = 0; i < length; i++) {
    diff |= (header.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0)
  }
  return diff === 0
}
