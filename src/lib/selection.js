// Free verse selection for the Bible reader.
//
// Each tap toggles exactly one verse, so any set of verses can be picked,
// adjacent or not (e.g. 3, 7 and 12 without the verses between them):
//
//   - tapping an unselected verse adds it (it becomes the anchor)
//   - tapping a selected verse removes only that verse; the anchor moves to
//     the lowest remaining verse, or clears with the selection
//
// The anchor is only a focus target: the reader returns keyboard focus to it
// when the action sheet closes.
//
// Pure (no DOM, no state) so the rules are unit-testable with node:test; the
// reader keeps the current { anchor, verses } in React state and feeds it back
// here on every tap.

export function emptySelection() {
  return { anchor: null, verses: new Set() }
}

// Verse numbers come from chapter data; no canonical chapter has more than
// 176 verses (Psalm 119 is the largest). This is an exported pure boundary,
// so hostile input (huge finite ints, unsafe ints, non-numbers) is ignored.
const MAX_VERSE = 1000
function validVerse(v) {
  return Number.isSafeInteger(v) && v >= 1 && v <= MAX_VERSE
}

/**
 * The selection after the user taps verse `v`. Always returns a new selection
 * (never mutates the input).
 */
export function tapVerse(selection, v) {
  if (!validVerse(v)) return selection ?? emptySelection()
  const verses = new Set(selection?.verses instanceof Set ? selection.verses : [])
  if (verses.has(v)) {
    verses.delete(v)
    if (!verses.size) return emptySelection()
    return { anchor: Math.min(...verses), verses }
  }
  verses.add(v)
  return { anchor: v, verses }
}

/** True when the selection covers more than one verse. */
export function isRange(selection) {
  return (selection?.verses?.size ?? 0) > 1
}

/**
 * Joins the selected verse rows ({ verse, endVerse?, text }, in chapter order)
 * into one passage. Adjacent verses (bridged rows included) join with a space;
 * a gap between non-adjacent runs is marked with `sep`.
 */
export function joinSelectedText(rows, sep = ' … ') {
  let out = ''
  let prev = null
  for (const row of rows ?? []) {
    if (prev) out += row.verse <= (prev.endVerse ?? prev.verse) + 1 ? ' ' : sep
    out += row.text
    prev = row
  }
  return out
}
