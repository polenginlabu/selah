// Pure verse-highlight helpers for the Bible reader.
//
// Kept DOM- and Supabase-free so the highlight rules are unit-testable with
// node:test like the other src/lib modules (npm run card:test). Storage and
// account sync live in src/data/highlights.js, which calls back into here.
//
// A highlights map is Record<verseNumber, color> where color is one of the ids
// below. Verse-number keys are always stored as strings so object keys stay
// stable regardless of how the caller passes them; sanitizeHighlights enforces
// that shape at every boundary where a map can enter the reader.
//
// Highlights are per book:chapter:verse-number and intentionally NOT
// translation-scoped: switching versions keeps your highlights, but a version
// that renumbers or bridges verses (MSG, some Psalms) can land a highlight on
// a different text span. Accepted tradeoff, documented here.

export const HIGHLIGHT_COLORS = [
  { id: 'yellow', name: 'Yellow', swatch: '#facc15' },
  { id: 'pink', name: 'Pink', swatch: '#f472b6' },
  { id: 'green', name: 'Green', swatch: '#4ade80' },
  { id: 'blue', name: 'Blue', swatch: '#60a5fa' },
]

export const HIGHLIGHT_KEY_PREFIX = 'bible:highlights'

export function isHighlightColor(color) {
  return typeof color === 'string' && HIGHLIGHT_COLORS.some((c) => c.id === color)
}

export function highlightsKey(book, chapter) {
  return `${HIGHLIGHT_KEY_PREFIX}:${book}:${chapter}`
}

/**
 * Keep only entries that could have been written by the palette: numeric
 * verse keys and whitelisted color values. Applied at every boundary where a
 * map can enter the reader (localStorage read, account row merge), so an
 * arbitrary string can never reach the render path or be persisted back.
 */
export function sanitizeHighlights(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {}
  const safe = {}
  for (const [verse, color] of Object.entries(map)) {
    if (/^(0|[1-9][0-9]*)$/.test(verse) && isHighlightColor(color)) safe[verse] = color
  }
  return safe
}

/**
 * Combine the localStorage copy with the account copy for a chapter. Server
 * wins over local per verse; local-only entries survive; both sides are
 * sanitized, so a stale or hostile row can only ever contribute palette
 * colors. This is last-write-wins per verse, not a durable merge: two devices
 * editing the same chapter between syncs can still overwrite each other, and
 * the reader re-reads its account row on every chapter open to keep that
 * window as small as possible.
 */
export function mergeHighlights(local, server) {
  const merged = sanitizeHighlights(local)
  for (const [verse, color] of Object.entries(sanitizeHighlights(server))) {
    merged[verse] = color
  }
  return merged
}

/**
 * Resolve a chapter's highlights once the account copy arrives.
 *
 * - foreign=true means the localStorage copy was written by a different
 *   account (shared/borrowed device): that copy is dropped entirely so one
 *   user's highlights never leak into or overwrite another's. Only entries
 *   the CURRENT session actually edited survive.
 * - dirty maps verse keys to the value the current session set this chapter
 *   (a color, or null for "removed") before hydration finished. Those edits
 *   always beat the server, so a quick highlight tap during the fetch window
 *   is never silently reverted.
 */
export function hydrateHighlights(local, server, { foreign = false, dirty = new Map() } = {}) {
  const base = foreign ? {} : sanitizeHighlights(local)
  const merged = mergeHighlights(base, server)
  for (const [key, value] of dirty) {
    if (value == null) delete merged[key]
    else merged[key] = value
  }
  return merged
}

/**
 * Apply one color to the given verses. If every verse already carries that
 * color the highlight is toggled off instead. An unknown color removes the
 * highlight (nothing can ever be stored outside the palette).
 */
export function applyColor(map, verses, color) {
  const next = { ...(map ?? {}) }
  const valid = isHighlightColor(color) ? color : null
  const keys = verses.map((v) => String(v))
  const allMatch = keys.length > 0 && keys.every((k) => next[k] === valid)
  for (const key of keys) {
    if (allMatch || !valid) delete next[key]
    else next[key] = valid
  }
  return next
}

/** Remove highlights from the given verses, leaving everything else intact. */
export function removeColors(map, verses) {
  const next = { ...(map ?? {}) }
  for (const key of verses.map((v) => String(v))) delete next[key]
  return next
}