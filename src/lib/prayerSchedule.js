// Pure recurrence + local-day math for the personal prayer list.
//
// No DOM, no Supabase, and no clock captured at module load: every function
// takes its date so the rules can be unit-tested with node:test against fixed
// dates, timezones and DST boundaries.
//
// "Today" is the USER's local day, never UTC: prayer_activity rows are keyed
// by a local date string (YYYY-MM-DD) so a prayer completed at 11:50 PM on a
// Friday belongs to that user's Friday, matching the technique the
// meditation-reminder function already uses with notification_profiles.timezone.

export const RECURRENCE_TYPES = ['daily', 'never', 'weekdays', 'weekly', 'custom']

/**
 * True when `recurrence` is a well-formed rule. Mirrors the
 * validate_prayer_item_recurrence trigger so the UI can never submit an
 * invalid rule (the server would reject it anyway): unknown types are
 * rejected, `days` must be an array of integers 0..6 whenever present, and
 * weekly/custom must actually provide a non-empty `days` array.
 */
export function validRecurrence(recurrence) {
  if (!recurrence || typeof recurrence !== 'object' || Array.isArray(recurrence)) return false
  const { type, days } = recurrence
  if (!RECURRENCE_TYPES.includes(type)) return false
  if (days !== undefined && !Array.isArray(days)) return false
  if (Array.isArray(days) && !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return false
  if ((type === 'weekly' || type === 'custom') && !(Array.isArray(days) && days.length > 0)) return false
  return true
}

/**
 * True when the rule wants a prayer on `weekdayIndex` (0 = Sunday, as Date
 * reports it). Invalid rules never match rather than silently always matching.
 */
export function recurrenceMatches(recurrence, weekdayIndex) {
  if (!validRecurrence(recurrence)) return false
  const { type, days } = recurrence
  if (type === 'daily') return true
  if (type === 'never') return false
  if (type === 'weekdays') return weekdayIndex >= 1 && weekdayIndex <= 5
  return days.includes(weekdayIndex) // weekly, custom
}

/** True when an item belongs in today's checklist: active, not archived, due. */
export function isDue(item, weekdayIndex) {
  return (
    !!item &&
    item.isActive !== false &&
    item.isArchived !== true &&
    recurrenceMatches(item.recurrence, weekdayIndex)
  )
}

/** Filters a list of prayer items down to those due on `weekdayIndex`. */
export function duePrayerItems(items, weekdayIndex) {
  return (items ?? []).filter((item) => isDue(item, weekdayIndex))
}

/** Weekday index (0 = Sunday) of an ISO date string, local to the device. */
export function weekdayIndexOf(dateISO) {
  return new Date(dateISO + 'T00:00:00').getDay()
}

/**
 * The user's local calendar date (YYYY-MM-DD) for `date` in `timezone` (IANA
 * name, e.g. "Asia/Manila"). Pass `timezone = null` to use the device's own
 * zone. Same Intl technique as the meditation reminder's localDateAndHour.
 */
export function dayKey(timezone, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    ...(timezone ? { timeZone: timezone } : {}),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * Human-friendly local day heading ("Thursday, September 25") in the user's
 * timezone. The checklist keys off dayKey() — this only formats it for the
 * header, in the same zone so a far-away timezone never shows a date that
 * disagrees with what the checklist used.
 */
export function formatDayInZone(timezone, date = new Date()) {
  return new Intl.DateTimeFormat(undefined, {
    ...(timezone ? { timeZone: timezone } : {}),
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(date)
}