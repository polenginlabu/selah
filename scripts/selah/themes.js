// The curated devotion themes.
//
// A theme is a category ("Hope") that steers the whole daily devotional; the
// agent still picks its own specific topic within it ("Waiting on God"). The
// nightly generator draws one at random when the admin has not pinned a theme
// (devotion_settings.theme), and the pick is persisted on the daily_devotions
// row — the agent never reports a theme back, so the row always matches what
// was asked for.
//
// This file is the single source of truth. The admin console's quick-pick
// chips import THEMES from here (src/pages/Admin.jsx) so they cannot drift
// from what the generator actually draws.

/** The palette. ids are slugify(label), unique, in display order. */
export const THEMES = [
  { id: 'peace', label: 'Peace' },
  { id: 'joy', label: 'Joy' },
  { id: 'hope', label: 'Hope' },
  { id: 'faith', label: 'Faith' },
  { id: 'gratitude', label: 'Gratitude' },
  { id: 'rest', label: 'Rest' },
  { id: 'courage', label: 'Courage' },
]

/**
 * Turns free text into a theme/topic id: "Waiting on God" -> "waiting-on-god".
 * Mirrors the existing topic slugging in devotion.js, shared so both stay one
 * implementation.
 */
export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Draws tonight's theme from the palette, skipping themes used in the most
 * recent devotions (newest first) so the rotation does not repeat on itself.
 * When every theme is recent — a tiny palette, or a week of admin overrides —
 * the exclusions are dropped rather than refusing to pick.
 *
 * @param {object} opts
 * @param {Array<{theme?: string|null}>} [opts.history] devotions, newest first
 * @param {() => number} [opts.random] PRNG returning [0, 1); injectable for tests
 * @param {number} [opts.recentCount] how many recent devotions to avoid repeating
 * @returns {{id: string, label: string}}
 */
export function pickRandomTheme({ history = [], random = Math.random, recentCount = 3 } = {}) {
  const recent = history
    .slice(0, recentCount)
    .map((h) => h?.theme)
    .filter(Boolean)

  const eligible = THEMES.filter((t) => !recent.includes(t.id))
  const pool = eligible.length > 0 ? eligible : THEMES
  return pool[Math.floor(random() * pool.length)]
}