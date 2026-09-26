// Pure math for the devotional plans feature.
//
// No DOM, no Supabase: every function takes its inputs so the rules can be
// unit-tested with node:test. The theme palette is re-exported from
// scripts/selah/themes.js — the single source of truth the nightly generator
// draws from — so the plan UI and the seed catalog can never drift from it.

export { THEMES } from '../../scripts/selah/themes.js'

/** The seeded catalog has one 7-day plan per theme. */
export const PLAN_DAY_COUNT = 7

/**
 * Marks `day` complete. The array is a set of day numbers; completing an
 * already-complete day is a no-op, and the result is always sorted so the
 * stored array is canonical regardless of completion order.
 */
export function completeDay(completedDays = [], day) {
  const set = new Set(completedDays)
  set.add(day)
  return [...set].sort((a, b) => a - b)
}

/** Removes `day` from the completed set (the undo direction of completeDay). */
export function removeDay(completedDays = [], day) {
  const set = new Set(completedDays)
  set.delete(day)
  return [...set].sort((a, b) => a - b)
}

/**
 * The day the reader should be on: the smallest day number not yet completed,
 * or null when every day is done. Completing out of order is allowed — the
 * next day is always the first gap, so a skipped day pulls the reader back to
 * it before anything later.
 */
export function currentDayIndex(completedDays = [], totalDays) {
  for (let i = 1; i <= totalDays; i += 1) {
    if (!completedDays.includes(i)) return i
  }
  return null
}

/** True when every day of the plan is completed. */
export function isPlanFinished(completedDays = [], totalDays) {
  return totalDays > 0 && currentDayIndex(completedDays, totalDays) === null
}

/**
 * Decides which devotion a plan day shows. The themed archive devotion wins;
 * without one the reader falls back to today's devotion; without either it
 * reports `none` (nothing generated yet). Returns the winning row alongside
 * the source so callers can render it directly.
 */
export function pickDevotion({ themeDevotion, todayDevotion } = {}) {
  if (themeDevotion) return { source: 'theme', devotion: themeDevotion }
  if (todayDevotion) return { source: 'today', devotion: todayDevotion }
  return { source: 'none', devotion: null }
}