// Pure local-day math for the personal prayer list.
//
// No DOM, no Supabase, and no clock captured at module load: every function
// takes its date so the rules can be unit-tested with node:test against fixed
// dates, timezones and DST boundaries.
//
// "Today" is the USER's local day, never UTC: prayer_activity rows are keyed
// by a local date string (YYYY-MM-DD) so a prayer completed at 11:50 PM on a
// Friday belongs to that user's Friday, matching the technique the
// meditation-reminder function already uses with notification_profiles.timezone.

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