// YouVersion-style verse selection for the Bible reader.
//
// The interaction is a small state machine, not a toolbar toggle:
//
//   - tapping a verse with nothing selected selects it (it becomes the anchor)
//   - tapping another verse selects the whole consecutive range between the
//     anchor and the tapped verse (either direction)
//   - tapping the anchor again clears the selection
//   - tapping inside an existing range (but not the anchor) collapses the
//     selection to that single verse
//
// Pure (no DOM, no state) so the rules are unit-testable with node:test; the
// reader keeps the current { anchor, verses } in React state and feeds it back
// here on every tap.

export function emptySelection() {
  return { anchor: null, verses: new Set() }
}

function span(from, to) {
  const out = new Set()
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  for (let v = lo; v <= hi; v++) out.add(v)
  return out
}

// Verse numbers come from chapter data; no canonical chapter has more than
// 176 verses (Psalm 119 is the largest). This is an exported pure boundary,
// so hostile input (huge finite ints, unsafe ints, non-numbers) must never
// reach span(): the bounds below keep the allocation bounded even for a
// corrupt caller, and the span cap mirrors the server's 300-entry ceiling.
const MAX_VERSE = 1000
const MAX_SPAN = 300
function validVerse(v) {
  return Number.isSafeInteger(v) && v >= 1 && v <= MAX_VERSE
}

/**
 * The selection after the user taps verse `v`. Always returns a new selection
 * (never mutates the input).
 */
export function tapVerse(selection, v) {
  const anchor = selection?.anchor ?? null
  const verses = selection?.verses instanceof Set ? selection.verses : new Set()
  if (!validVerse(v)) return selection ?? emptySelection()
  // A corrupt stored anchor is not a usable reference; start a fresh selection
  // on the tapped verse instead of spanning garbage.
  if (anchor !== null && !validVerse(anchor)) return { anchor: v, verses: new Set([v]) }
  if (anchor === null) return { anchor: v, verses: new Set([v]) }
  if (v === anchor) return emptySelection()
  if (verses.has(v)) return { anchor: v, verses: new Set([v]) }
  // Cap the requested range so span() can never allocate an unbounded set.
  if (Math.abs(anchor - v) + 1 > MAX_SPAN) return selection ?? emptySelection()
  return { anchor, verses: span(anchor, v) }
}

/** True when the selection covers more than one consecutive verse. */
export function isRange(selection) {
  return (selection?.verses?.size ?? 0) > 1
}