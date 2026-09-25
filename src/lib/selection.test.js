import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptySelection, tapVerse, isRange } from './selection.js'

function toSortedArray(selection) {
  return [...selection.verses].sort((a, b) => a - b)
}

test('first tap selects a single verse and anchors it', () => {
  const next = tapVerse(emptySelection(), 16)
  assert.equal(next.anchor, 16)
  assert.deepEqual(toSortedArray(next), [16])
})

test('second tap extends the consecutive range in either direction', () => {
  const next = tapVerse(tapVerse(emptySelection(), 16), 18)
  assert.equal(next.anchor, 16)
  assert.deepEqual(toSortedArray(next), [16, 17, 18])

  const back = tapVerse(tapVerse(emptySelection(), 18), 15)
  assert.equal(back.anchor, 18)
  assert.deepEqual(toSortedArray(back), [15, 16, 17, 18])
})

test('tapping the anchor again clears the selection', () => {
  const selected = tapVerse(tapVerse(emptySelection(), 16), 18)
  const cleared = tapVerse(selected, 16)
  assert.equal(cleared.anchor, null)
  assert.equal(cleared.verses.size, 0)
})

test('tapping inside an existing range collapses to that single verse', () => {
  const selected = tapVerse(tapVerse(emptySelection(), 16), 18) // 16..18
  const collapsed = tapVerse(selected, 17)
  assert.equal(collapsed.anchor, 17)
  assert.deepEqual(toSortedArray(collapsed), [17])
})

test('a range covers every verse between the anchors, inclusive', () => {
  const next = tapVerse(tapVerse(emptySelection(), 1), 5)
  assert.deepEqual(toSortedArray(next), [1, 2, 3, 4, 5])
  assert.equal(next.verses.size, 5)
})

test('never mutates the input selection', () => {
  const first = tapVerse(emptySelection(), 16)
  const original = new Set(first.verses)
  tapVerse(first, 18)
  tapVerse(first, 16)
  assert.deepEqual([...first.verses], [...original])
  assert.equal(first.anchor, 16)
})

test('isRange distinguishes ranges from single verses', () => {
  assert.ok(!isRange(emptySelection()))
  assert.ok(!isRange(tapVerse(emptySelection(), 16)))
  assert.ok(isRange(tapVerse(tapVerse(emptySelection(), 16), 18)))
})

test('non-finite, zero, or fractional verse numbers are rejected as empty selections', () => {
  // The helper is an exported pure boundary; hostile input must not reach the
  // span loop (Infinity would otherwise run it off the end forever).
  for (const bad of [0, -1, 1.5, Infinity, -Infinity, NaN, '16', null]) {
    const next = tapVerse(emptySelection(), bad)
    assert.equal(next.anchor, null, `anchor for ${String(bad)}`)
    assert.equal(next.verses.size, 0, `verses for ${String(bad)}`)
    // An open selection keeps its existing state when given garbage.
    const range = tapVerse(tapVerse(emptySelection(), 16), 18)
    const after = tapVerse(range, bad)
    assert.equal(after.anchor, 16)
    assert.deepEqual([...after.verses].sort((a, b) => a - b), [16, 17, 18])
  }
})

test('huge finite or unsafe verse numbers never reach span()', () => {
  // Canonical chapters max out at 176 verses (Psalm 119); large-but-finite
  // values must be no-ops so a hostile caller cannot allocate an enormous set.
  const range = tapVerse(tapVerse(emptySelection(), 16), 18)
  for (const huge of [1001, 1_000_000, 1e9, 1e12, Number.MAX_SAFE_INTEGER]) {
    const next = tapVerse(range, huge)
    assert.equal(next.anchor, 16, `anchor for ${huge}`)
    assert.deepEqual([...next.verses].sort((a, b) => a - b), [16, 17, 18], `verses for ${huge}`)
  }
  assert.equal(tapVerse(emptySelection(), 1_000_000).verses.size, 0)
})

test('a malformed stored anchor recovers to a fresh selection on the tapped verse', () => {
  for (const corrupt of [
    { anchor: Infinity, verses: new Set([Infinity]) },
    { anchor: 1_000_000, verses: new Set([1_000_000]) },
    { anchor: -5, verses: new Set([-5]) },
  ]) {
    const next = tapVerse(corrupt, 16)
    assert.equal(next.anchor, 16, `anchor for ${corrupt.anchor}`)
    assert.deepEqual([...next.verses], [16])
  }
})

test('a requested range is capped so span() allocation stays bounded', () => {
  // Exactly at the cap still works…
  const atCap = tapVerse(tapVerse(emptySelection(), 1), 300)
  assert.equal(atCap.verses.size, 300)
  // …but one past it leaves the existing selection untouched.
  const over = tapVerse(tapVerse(emptySelection(), 1), 301)
  assert.equal(over.anchor, 1)
  assert.deepEqual([...over.verses], [1])
})