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

/**
 * The selection after the user taps verse `v`. Always returns a new selection
 * (never mutates the input).
 */
export function tapVerse(selection, v) {
  const anchor = selection?.anchor ?? null
  const verses = selection?.verses instanceof Set ? selection.verses : new Set()
  // Verse numbers come from chapter data, but this is an exported pure
  // boundary: reject anything that is not a positive integer so span() can
  // never be asked to run off the end (e.g. Infinity).
  if (!Number.isInteger(v) || v < 1) return selection ?? emptySelection()
  if (anchor === null) return { anchor: v, verses: new Set([v]) }
  if (v === anchor) return emptySelection()
  if (verses.has(v)) return { anchor: v, verses: new Set([v]) }
  return { anchor, verses: span(anchor, v) }
}

/** True when the selection covers more than one consecutive verse. */
export function isRange(selection) {
  return (selection?.verses?.size ?? 0) > 1
}